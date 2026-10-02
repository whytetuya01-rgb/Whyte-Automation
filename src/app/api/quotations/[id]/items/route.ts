import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem, Product } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createQuotationItemSchema, parseQuotationId } from "@/lib/validation/quotation";

type RouteContext = { params: Promise<{ id: string }> };

/** Session required: adding items to a quotation is a business operation. */

interface VariantLike {
  id?: number;
  _id?: number;
  config?: Record<string, string> | null;
  automationTier?: string | null;
  surfaceFinish?: string | null;
  price?: unknown;
}

/**
 * Build a human-readable label from a variant config object.
 * Works for any number of dimensions.
 * Examples: "WiFi + Glass", "Zigbee", "Metal", null (for empty/flat config)
 */
function buildVariantLabel(config: Record<string, string>): string | null {
  const parts = Object.values(config).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((v) => v.charAt(0).toUpperCase() + v.slice(1)).join(" + ");
}

/**
 * Check if a variant matches a target configuration object.
 * Handles top-level automationTier/surfaceFinish, config aliases, and case-insensitivity.
 */
function variantMatchesConfig(
  v: VariantLike,
  targetConfig: Record<string, string>
): boolean {
  const vc = (v.config as Record<string, string>) ?? {};
  return Object.entries(targetConfig).every(([key, expectedVal]) => {
    const exp = String(expectedVal).trim().toLowerCase();
    if (!exp) return true;

    if (vc[key] && String(vc[key]).trim().toLowerCase() === exp) return true;

    const isTier = /^(series|tier|automationtier|automation)$/i.test(key);
    if (isTier) {
      if (v.automationTier && v.automationTier.trim().toLowerCase() === exp) return true;
      if (vc.series && String(vc.series).trim().toLowerCase() === exp) return true;
      if (vc.tier && String(vc.tier).trim().toLowerCase() === exp) return true;
      if (vc.automationTier && String(vc.automationTier).trim().toLowerCase() === exp) return true;
    }

    const isFinish = /^(finish|surfacefinish|surface)$/i.test(key);
    if (isFinish) {
      if (v.surfaceFinish && v.surfaceFinish.trim().toLowerCase() === exp) return true;
      if (vc.finish && String(vc.finish).trim().toLowerCase() === exp) return true;
      if (vc.surfaceFinish && String(vc.surfaceFinish).trim().toLowerCase() === exp) return true;
    }

    for (const [k, val] of Object.entries(vc)) {
      if (k.toLowerCase() === key.toLowerCase() && String(val).trim().toLowerCase() === exp) {
        return true;
      }
    }

    return false;
  });
}

function toDecimal128(price: unknown): mongoose.Types.Decimal128 {
  if (typeof price === "number") {
    return mongoose.Types.Decimal128.fromString(price.toFixed(2));
  }
  if (typeof price === "string") {
    return mongoose.Types.Decimal128.fromString(Number(price).toFixed(2));
  }
  const maybeDecimal = price as { _bsontype?: string } | null | undefined;
  if (maybeDecimal?._bsontype === "Decimal128") {
    return price as mongoose.Types.Decimal128;
  }
  return mongoose.Types.Decimal128.fromString(String(price ?? "0.00"));
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    const { id } = await context.params;
    const quotationId = parseQuotationId(id);

    await connectMongoDB();

    const quotation = await Quotation.findById(quotationId).select("_id status dealerId").lean();
    if (!quotation) {
      throw new ApiError("NOT_FOUND", "Quotation not found.");
    }
    if (quotation.status === "approved" || quotation.status === "delivered") {
      throw new ApiError(
        "FORBIDDEN",
        `Quotation is ${quotation.status} and locked. Please clone it to make revisions.`
      );
    }
    if (role === "dealer" && quotation.dealerId !== userId) {
      throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
    }

    const body = createQuotationItemSchema.parse(await readJsonBody(req));
    const { quotationRoomId, productId, productVariantId, variantConfig, quantity, sbNumber, notes } =
      body;

    // The room must belong to THIS quotation, otherwise a caller could attach an
    // item to any room in the system by guessing an id.
    const room = await QuotationRoom.findOne({ _id: quotationRoomId, quotationId });
    if (!room) {
      throw new ApiError("NOT_FOUND", "Room not found for this quotation.", {
        field: "quotationRoomId",
      });
    }

    const product = await Product.findById(productId).populate({
      path: "variants",
      match: { isActive: true },
      options: { sort: { sortOrder: 1 } },
    });

    if (!product) {
      throw new ApiError("NOT_FOUND", "Product not found.", { field: "productId" });
    }
    if (!product.isActive) {
      throw new ApiError("VALIDATION_ERROR", "This product is no longer available.", {
        field: "productId",
      });
    }

    const prodJson = (typeof product.toJSON === "function" ? product.toJSON() : product) as {
      variants?: VariantLike[];
    };
    const variants = Array.isArray(prodJson.variants) ? prodJson.variants : [];

    if (variants.length === 0) {
      throw new ApiError("VALIDATION_ERROR", "This product has no pricing variants configured.", {
        field: "productId",
      });
    }

    // Resolve which variant to use
    let selectedVariant: VariantLike | undefined;

    if (productVariantId) {
      selectedVariant = variants.find((v) => (v.id ?? v._id) === productVariantId);
      if (!selectedVariant) {
        throw new ApiError("VALIDATION_ERROR", "The selected variant is unavailable.", {
          field: "productVariantId",
        });
      }
    } else if (variantConfig && Object.keys(variantConfig).length > 0) {
      selectedVariant = variants.find((v) => variantMatchesConfig(v, variantConfig));
      if (!selectedVariant) {
        throw new ApiError("VALIDATION_ERROR", "No variant matches the selected configuration.", {
          field: "variantConfig",
        });
      }
    } else if (variants.length === 1) {
      selectedVariant = variants[0];
    } else {
      const quotation = await Quotation.findById(quotationId, { defaultTier: 1, defaultFinish: 1 });

      if (quotation?.defaultTier || quotation?.defaultFinish) {
        const defaults: Record<string, string> = {};
        if (quotation.defaultTier) defaults.series = quotation.defaultTier;
        if (quotation.defaultFinish) defaults.finish = quotation.defaultFinish;

        selectedVariant = variants.find((v) => variantMatchesConfig(v, defaults));
      }

      if (!selectedVariant) {
        // 422: the request is valid but the client must choose a variant first.
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Multiple variants are available — please choose one.",
              field: "productVariantId",
              details: {
                requiresPicker: true,
                variants: variants.map((v) => ({
                  id: v.id ?? v._id,
                  config: v.config,
                  automationTier: v.automationTier,
                  surfaceFinish: v.surfaceFinish,
                  price: v.price,
                  label: buildVariantLabel(v.config ?? {}),
                })),
              },
            },
          },
          { status: 422 }
        );
      }
    }

    const resolvedConfig = selectedVariant.config ?? {};
    const variantLabel =
      buildVariantLabel(resolvedConfig) ??
      (selectedVariant.automationTier || selectedVariant.surfaceFinish
        ? [selectedVariant.automationTier, selectedVariant.surfaceFinish]
            .filter(Boolean)
            .map((s) => (s as string).charAt(0).toUpperCase() + (s as string).slice(1))
            .join(" + ") || null
        : null);

    const nextItemId = await getNextSequence("quotationItem", QuotationItem);

    // The unit price always comes from the resolved variant, never from the client.
    await QuotationItem.create({
      _id: nextItemId,
      quotationRoomId,
      productId,
      productVariantId: selectedVariant.id ?? selectedVariant._id,
      quantity: Math.max(1, quantity ?? 1),
      unitPrice: toDecimal128(selectedVariant.price),
      variantLabel,
      variantConfig: Object.keys(resolvedConfig).length > 0 ? resolvedConfig : null,
      sbNumber: sbNumber ?? null,
      notes: notes ?? null,
      sortOrder: 0,
    });

    const populatedItem = await QuotationItem.findById(nextItemId)
      .populate({
        path: "product",
        populate: { path: "variants", match: { isActive: true } },
      })
      .populate({ path: "productVariant" });

    return apiSuccess(populatedItem, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/items" });
  }
}
