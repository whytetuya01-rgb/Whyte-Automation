import { assertQuotationEditable } from "@/lib/quotationRevisionService";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem, Product } from "@/models";
import { getNextSequence, reserveSequenceBlock } from "@/lib/counter";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import {
  createQuotationItemSchema,
  bulkCreateQuotationItemsSchema,
  parseQuotationId,
} from "@/lib/validation/quotation";
import { normalizeQuotationItem } from "@/lib/quotationNormalization";
import { redactQuotationItemForRole } from "@/lib/variantRedaction";
import { resolveStoredVariantPricing } from "@/lib/pricing";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import { canModifyQuotation } from "@/lib/quotationAccess";
import { withTransaction } from "@/lib/transaction";

type RouteContext = { params: Promise<{ id: string }> };

/** Session required: adding items to a quotation is a business operation. */

interface VariantLike {
  id?: number;
  _id?: number;
  config?: Record<string, string> | null;
  automationTier?: string | null;
  surfaceFinish?: string | null;
  price?: unknown;
  priceWithoutTax?: unknown;
  taxPercent?: unknown;
  cost?: unknown;
  purchaseTaxPercent?: unknown;
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

/**
 * Bulk Device Addition Handler:
 * Atomically validates, prices, sequence-allocates, and inserts a batch of items.
 */
async function handleBulkAddItems({
  rawBody,
  quotationId,
  role,
  userId,
  permissions,
}: {
  rawBody: unknown;
  quotationId: string;
  role: string;
  userId: number;
  permissions?: string[];
}) {
  const body = bulkCreateQuotationItemsSchema.parse(rawBody);
  const itemsToCreate = body.items;

  // 1. Validate quotation & permissions
  const quotation = await Quotation.findById(quotationId)
    .select("_id status revision dealerId assignedSalesId createdBy defaultTier defaultFinish")
    .lean();
  if (!quotation) {
    throw new ApiError("NOT_FOUND", "Quotation not found.");
  }
  assertQuotationEditable(quotation);
  if (!canModifyQuotation(role, userId, quotation, permissions)) {
    throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
  }

  // 2. Validate all rooms belong to this quotation
  const roomIds = Array.from(
    new Set(
      itemsToCreate
        .map((it) => it.quotationRoomId ?? body.quotationRoomId)
        .filter((id): id is number => typeof id === "number" && id > 0)
    )
  );
  if (roomIds.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "A target room is required for every item.");
  }
  const validRooms = await QuotationRoom.find({
    _id: { $in: roomIds },
    quotationId,
  })
    .select("_id")
    .lean();
  const validRoomIds = new Set(validRooms.map((r) => Number(r._id)));
  for (const it of itemsToCreate) {
    const rId = it.quotationRoomId ?? body.quotationRoomId;
    if (!rId || !validRoomIds.has(rId)) {
      throw new ApiError("NOT_FOUND", `Room #${rId} not found for this quotation.`, {
        field: "quotationRoomId",
      });
    }
  }

  // 3. Batch fetch all products with active variants
  const productIds = Array.from(new Set(itemsToCreate.map((it) => it.productId)));
  const products = await Product.find({
    _id: { $in: productIds },
  }).populate({
    path: "variants",
    match: { isActive: true },
    options: { sort: { sortOrder: 1 } },
  });
  const productMap = new Map(products.map((p) => [Number(p.id ?? p._id), p]));

  // 4. Validate and resolve pricing for each item
  interface ResolvedBatchItem {
    roomTargetId: number;
    productId: number;
    product: any;
    itemVariant: VariantLike;
    variantPricing: { price: number; priceWithoutTax: number; taxPercent: number; taxAmount: number };
    variantLabel: string | null;
    resolvedConfig: Record<string, string> | null;
    quantity: number;
    sbNumber: string | null;
    notes: string | null;
    sortOrder: number;
  }

  const resolvedItems: ResolvedBatchItem[] = [];

  for (const it of itemsToCreate) {
    const roomTargetId = (it.quotationRoomId ?? body.quotationRoomId)!;
    const product = productMap.get(it.productId);
    if (!product) {
      throw new ApiError("NOT_FOUND", `Product #${it.productId} not found.`, { field: "productId" });
    }
    if (!product.isActive) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Product "${product.name}" is no longer available.`,
        { field: "productId" }
      );
    }

    const prodJson = (typeof product.toJSON === "function" ? product.toJSON() : product) as {
      variants?: VariantLike[];
    };
    const variants = Array.isArray(prodJson.variants) ? prodJson.variants : [];
    if (variants.length === 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Product "${product.name}" has no pricing variants configured.`,
        { field: "productId" }
      );
    }

    let itemVariant: VariantLike | undefined;
    if (it.productVariantId) {
      itemVariant = variants.find((v) => (v.id ?? v._id) === it.productVariantId);
      if (!itemVariant) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `Selected variant is unavailable for "${product.name}".`,
          { field: "productVariantId" }
        );
      }
    } else if (it.variantConfig && Object.keys(it.variantConfig).length > 0) {
      itemVariant = variants.find((v) => variantMatchesConfig(v, it.variantConfig!));
      if (!itemVariant) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `No variant matches configuration for "${product.name}".`,
          { field: "variantConfig" }
        );
      }
    } else if (variants.length === 1) {
      itemVariant = variants[0];
    } else {
      if (quotation.defaultTier || quotation.defaultFinish) {
        const defaults: Record<string, string> = {};
        if (quotation.defaultTier) defaults.series = quotation.defaultTier;
        if (quotation.defaultFinish) defaults.finish = quotation.defaultFinish;
        itemVariant = variants.find((v) => variantMatchesConfig(v, defaults));
      }
      if (!itemVariant) {
        itemVariant = variants[0];
      }
    }

    const tier = itemVariant.automationTier;
    const finish = itemVariant.surfaceFinish;
    const tierLbl = formatTierLabel(tier);
    const finishLbl = formatFinishLabel(finish);
    const variantLabel =
      tierLbl || finishLbl
        ? [tierLbl, finishLbl].filter(Boolean).join(" + ")
        : buildVariantLabel(itemVariant.config ?? {}) ?? null;

    const variantPricing = resolveStoredVariantPricing(itemVariant);
    const resolvedConfig =
      it.variantConfig && Object.keys(it.variantConfig).length > 0
        ? it.variantConfig
        : itemVariant.config ?? null;

    resolvedItems.push({
      roomTargetId,
      productId: it.productId,
      product,
      itemVariant,
      variantPricing,
      variantLabel,
      resolvedConfig: resolvedConfig && Object.keys(resolvedConfig).length > 0 ? resolvedConfig : null,
      quantity: Math.max(1, it.quantity ?? 1),
      sbNumber: it.sbNumber ?? null,
      notes: it.notes ?? null,
      sortOrder: it.sortOrder ?? 0,
    });
  }

  // 5. Reserve sequence block & atomically insert documents within transaction
  const { allocatedIds, createdArray } = await withTransaction(async (session) => {
    const allocatedIds = await reserveSequenceBlock(
      "quotationItem",
      resolvedItems.length,
      QuotationItem,
      session
    );

    const docsToInsert = resolvedItems.map((item, idx) => ({
      _id: allocatedIds[idx],
      quotationRoomId: item.roomTargetId,
      productId: item.productId,
      productVariantId: item.itemVariant.id ?? item.itemVariant._id,
      quantity: item.quantity,
      unitPrice: mongoose.Types.Decimal128.fromString(item.variantPricing.price.toFixed(2)),
      priceWithoutTax: mongoose.Types.Decimal128.fromString(item.variantPricing.priceWithoutTax.toFixed(2)),
      taxPercent: mongoose.Types.Decimal128.fromString(item.variantPricing.taxPercent.toFixed(2)),
      taxAmount: mongoose.Types.Decimal128.fromString(item.variantPricing.taxAmount.toFixed(2)),
      variantLabel: item.variantLabel,
      variantConfig: item.resolvedConfig,
      sbNumber: item.sbNumber,
      notes: item.notes,
      sortOrder: item.sortOrder,
    }));

    const createdDocs = await QuotationItem.create(docsToInsert, { session });
    const createdArray = Array.isArray(createdDocs) ? createdDocs : [createdDocs];
    return { allocatedIds, createdArray };
  });

  // 7. Shape response items in memory with zero extra queries
  const responseItems = createdArray.map((doc, idx) => {
    const raw = doc?.toObject ? doc.toObject() : doc;
    const resolved = resolvedItems[idx];
    const plainItem = {
      ...raw,
      id: allocatedIds[idx],
      product: {
        id: Number(resolved.product.id ?? resolved.product._id),
        _id: Number(resolved.product.id ?? resolved.product._id),
        name: resolved.product.name,
        code: resolved.product.code,
        type: resolved.product.type,
        imageUrl: resolved.product.imageUrl,
        imagePublicId: resolved.product.imagePublicId,
        categoryId: resolved.product.categoryId,
        moduleSize: resolved.product.moduleSize,
        surfaceFinish: resolved.product.surfaceFinish,
        automationTier: resolved.product.automationTier,
        notes: resolved.product.notes,
        specs: resolved.product.specs,
        isDeleted: resolved.product.isDeleted === true,
      },
      productVariant: resolved.itemVariant
        ? {
            id: Number(resolved.itemVariant.id ?? resolved.itemVariant._id),
            _id: Number(resolved.itemVariant.id ?? resolved.itemVariant._id),
            surfaceFinish: resolved.itemVariant.surfaceFinish ?? null,
            automationTier: resolved.itemVariant.automationTier ?? null,
            isDeleted: (resolved.itemVariant as any).isDeleted === true,
          }
        : null,
    };
    return redactQuotationItemForRole(normalizeQuotationItem(plainItem), role, permissions);
  });

  return apiSuccess(responseItems, { status: 201 });
}

export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const { id } = await context.params;
      const quotationId = parseQuotationId(id);

      await connectMongoDB();

      const rawBody = await readJsonBody(req);

      // Handle Bulk Device Addition if `items` array is provided
      if (rawBody && typeof rawBody === "object" && Array.isArray((rawBody as any).items)) {
        return await handleBulkAddItems({
          rawBody,
          quotationId,
          role,
          userId,
          permissions,
        });
      }

      // Single item addition: parse schema
      const body = createQuotationItemSchema.parse(rawBody);
      const { quotationRoomId, productId, productVariantId, variantConfig, quantity, sbNumber, notes } =
        body;

      // Phase C Optimization: Execute Quotation, Room, and Product queries in parallel.
      // Quotation projection includes defaultTier and defaultFinish, eliminating the redundant second lookup.
      const [quotation, room, product] = await Promise.all([
        Quotation.findById(quotationId)
          .select("_id status revision dealerId assignedSalesId createdBy defaultTier defaultFinish")
          .lean(),
        QuotationRoom.findOne({ _id: quotationRoomId, quotationId }).select("_id").lean(),
        Product.findById(productId).populate({
          path: "variants",
          match: { isActive: true },
          options: { sort: { sortOrder: 1 } },
        }),
      ]);

      if (!quotation) {
        throw new ApiError("NOT_FOUND", "Quotation not found.");
      }
      assertQuotationEditable(quotation);
      if (!canModifyQuotation(role, userId, quotation, permissions)) {
        throw new ApiError("FORBIDDEN", "You do not have permission to modify this quotation.");
      }

      // The room must belong to THIS quotation, otherwise a caller could attach an
      // item to any room in the system by guessing an id.
      if (!room) {
        throw new ApiError("NOT_FOUND", "Room not found for this quotation.", {
          field: "quotationRoomId",
        });
      }

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
        // Use defaultTier / defaultFinish already projected from the initial quotation lookup
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

      const tier = selectedVariant.automationTier;
      const finish = selectedVariant.surfaceFinish;
      const tierLbl = formatTierLabel(tier);
      const finishLbl = formatFinishLabel(finish);
      const variantLabel =
        tierLbl || finishLbl
          ? [tierLbl, finishLbl].filter(Boolean).join(" + ")
          : buildVariantLabel(selectedVariant.config ?? {}) ?? null;

      const nextItemId = await getNextSequence("quotationItem", QuotationItem);

      const variantPricing = resolveStoredVariantPricing(selectedVariant);

      const resolvedConfig =
        variantConfig && Object.keys(variantConfig).length > 0
          ? variantConfig
          : selectedVariant.config ?? null;

      // The unit price and tax snapshot always come from the resolved variant, never from the client.
      const createdItem = await QuotationItem.create({
        _id: nextItemId,
        quotationRoomId,
        productId,
        productVariantId: selectedVariant.id ?? selectedVariant._id,
        quantity: Math.max(1, quantity ?? 1),
        unitPrice: mongoose.Types.Decimal128.fromString(variantPricing.price.toFixed(2)),
        priceWithoutTax: mongoose.Types.Decimal128.fromString(variantPricing.priceWithoutTax.toFixed(2)),
        taxPercent: mongoose.Types.Decimal128.fromString(variantPricing.taxPercent.toFixed(2)),
        taxAmount: mongoose.Types.Decimal128.fromString(variantPricing.taxAmount.toFixed(2)),
        variantLabel,
        variantConfig: resolvedConfig && Object.keys(resolvedConfig).length > 0 ? resolvedConfig : null,
        sbNumber: sbNumber ?? null,
        notes: notes ?? null,
        sortOrder: body.sortOrder ?? 0,
      });

      // Phase C Optimization: Construct plain populated item directly from in-memory documents.
      // Eliminates 3 redundant DB roundtrips (QuotationItem.findById + Product populate + ProductVariant populate).
      const plainDoc = createdItem?.toObject ? createdItem.toObject() : createdItem;
      const plainItem = {
        ...plainDoc,
        id: nextItemId,
        product: {
          id: Number(product.id ?? product._id),
          _id: Number(product.id ?? product._id),
          name: product.name,
          code: product.code,
          type: product.type,
          imageUrl: product.imageUrl,
          imagePublicId: product.imagePublicId,
          categoryId: product.categoryId,
          moduleSize: product.moduleSize,
          surfaceFinish: product.surfaceFinish,
          automationTier: product.automationTier,
          notes: product.notes,
          specs: product.specs,
          isDeleted: product.isDeleted === true,
        },
        productVariant: selectedVariant
          ? {
              id: Number(selectedVariant.id ?? selectedVariant._id),
              _id: Number(selectedVariant.id ?? selectedVariant._id),
              surfaceFinish: selectedVariant.surfaceFinish ?? null,
              automationTier: selectedVariant.automationTier ?? null,
              isDeleted: (selectedVariant as any).isDeleted === true,
            }
          : null,
      };

      return apiSuccess(
        redactQuotationItemForRole(normalizeQuotationItem(plainItem), role, permissions),
        { status: 201 }
      );
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/items" });
  }
}
