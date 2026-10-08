import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Product, ProductVariant } from "@/models";
import { requireRole } from "@/lib/api-auth";
import {
  ApiError,
  apiSuccess,
  handleApiError,
  parseNumericId,
  readJsonBody,
} from "@/lib/api-response";
import { bulkVariantUpdateSchema, addVariantSchema } from "@/lib/validation/product";
import { findDuplicateVariantCode, serializeVariant } from "@/lib/productVariantService";
import { addVariantToProduct } from "@/lib/variantMatrix";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/variants
 * Returns all variants for a specific product. Shape intentionally unchanged.
 */
export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    // Variant management (including raw cost/price rows) is Super Admin / Admin
    // only. No dealer-facing screen calls this endpoint.
    await requireRole("super_admin", "admin");

    await connectMongoDB();
    const productId = parseNumericId(id, "id");

    const product = await Product.findById(productId);
    if (!product) {
      throw new ApiError("NOT_FOUND", "Product not found.");
    }

    const variants = await ProductVariant.find({ productId }).sort({ sortOrder: 1, _id: 1 });
    return NextResponse.json(variants.map((v) => serializeVariant(v.toObject())));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/products/[id]/variants" });
  }
}

/**
 * POST /api/products/[id]/variants
 *
 * Adds ONE valid category-matrix combination that was never added to this
 * product. Existing variants are never touched.
 *
 * Rejected with 409 DUPLICATE_RECORD when:
 *   - a live variant already covers that combination
 *   - the variant code is already used inside this product
 *
 * Rejected with 400 VALIDATION_ERROR when the combination is not part of the
 * product's category matrix, or when the code/price is invalid.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");

    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const parsed = addVariantSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) throw parsed.error;

    const {
      automationTier,
      surfaceFinish,
      variantCode,
      name,
      price,
      priceWithoutTax,
      taxPercent,
      cost,
      purchaseTaxPercent,
    } = parsed.data;

    const created = await addVariantToProduct({
      productId,
      automationTier,
      surfaceFinish,
      variantCode,
      name,
      price,
      priceWithoutTax,
      taxPercent,
      cost,
      purchaseTaxPercent,
    });

    return apiSuccess(
      {
        message: `Variant "${variantCode}" added.`,
        variant: serializeVariant(created.toObject()),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/products/[id]/variants" });
  }
}

/**
 * PATCH /api/products/[id]/variants
 *
 * Bulk variant editing. Only `variantCode` and `price` may change:
 * automationTier, surfaceFinish, productId, isActive and sortOrder are defined
 * by the category matrix and are not editable here.
 *
 * Variant codes are required and unique WITHIN the product (case-insensitive).
 * No MongoDB unique index is used Ã¢â‚¬â€ this is application-level validation only.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");

    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const product = await Product.findById(productId);
    if (!product) {
      throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
    }

    const rawBody = await readJsonBody(req);
    const parsed = bulkVariantUpdateSchema.safeParse(rawBody);
    if (!parsed.success) throw parsed.error;

    const incoming = parsed.data.variants;

    // Every supplied id must exist and belong to this product
    const variantIds = incoming.map((variant) => variant.id);
    if (new Set(variantIds).size !== variantIds.length) {
      throw new ApiError("DUPLICATE_RECORD", "The same variant was submitted more than once.", {
        field: "variants",
      });
    }

    const existingVariants = await ProductVariant.find({ _id: { $in: variantIds }, productId });
    if (existingVariants.length !== variantIds.length) {
      throw new ApiError(
        "NOT_FOUND",
        "One or more variants do not belong to this product. Refresh and try again.",
        { field: "variants" }
      );
    }

    // Case-insensitive uniqueness across the product's FINAL set of codes,
    // including the variants that were not part of this payload.
    const submittedIds = new Set(variantIds);
    const untouched = await ProductVariant.find({ productId, _id: { $nin: [...submittedIds] } })
      .select("variantCode")
      .lean();

    const finalCodes = [
      ...incoming.map((variant) => ({ id: variant.id, variantCode: variant.variantCode })),
      ...untouched.map((variant) => ({
        id: (variant as { _id: number })._id,
        variantCode: String((variant as { variantCode?: string | null }).variantCode ?? ""),
      })),
    ];

    const duplicate = findDuplicateVariantCode(finalCodes);
    // Only reject when a variant involved in the clash is part of THIS payload;
    // pre-existing duplicates among untouched rows must not block an edit.
    if (
      duplicate &&
      (submittedIds.has(duplicate.id ?? -1) || submittedIds.has(duplicate.firstId ?? -1))
    ) {
      throw new ApiError(
        "DUPLICATE_RECORD",
        `Variant code '${duplicate.variantCode}' is already used by another variant of this product.`,
        { field: "variants" }
      );
    }

    const bulkOps = incoming.map((variant) => {
      const updateFields: Record<string, unknown> = {
        variantCode: variant.variantCode,
        code: variant.variantCode, // kept in sync for legacy readers
        "config.variantCode": variant.variantCode,
        price: mongoose.Types.Decimal128.fromString(variant.price.toFixed(2)),
        priceWithoutTax: mongoose.Types.Decimal128.fromString(variant.priceWithoutTax.toFixed(2)),
        taxPercent: mongoose.Types.Decimal128.fromString(variant.taxPercent.toFixed(2)),
        cost: mongoose.Types.Decimal128.fromString(variant.cost.toFixed(2)),
        purchaseTaxPercent: mongoose.Types.Decimal128.fromString(variant.purchaseTaxPercent.toFixed(2)),
        updatedAt: new Date(),
      };
      if (variant.name !== undefined) {
        updateFields.name = variant.name;
      }
      if (variant.automationTier !== undefined) {
        updateFields.automationTier = variant.automationTier;
      }
      if (variant.surfaceFinish !== undefined) {
        updateFields.surfaceFinish = variant.surfaceFinish;
      }
      if (variant.isActive !== undefined) {
        updateFields.isActive = variant.isActive;
      }
      if (variant.sortOrder !== undefined) {
        updateFields.sortOrder = variant.sortOrder;
      }
      return {
        updateOne: {
          filter: { _id: variant.id, productId },
          update: { $set: updateFields },
        },
      };
    });

    await ProductVariant.bulkWrite(bulkOps);

    const updatedVariants = await ProductVariant.find({ productId }).sort({ sortOrder: 1, _id: 1 });

    return apiSuccess({
      message: `Updated ${incoming.length} variant${incoming.length === 1 ? "" : "s"} successfully.`,
      variants: updatedVariants.map((v) => serializeVariant(v.toObject())),
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/products/[id]/variants" });
  }
}
