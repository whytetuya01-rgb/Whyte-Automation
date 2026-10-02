import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Product, ProductVariant } from "@/models";
import { requireSession } from "@/lib/api-auth";
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
    await requireSession();

    await connectMongoDB();
    const productId = parseNumericId(id, "id");

    const product = await Product.findById(productId);
    if (!product) {
      throw new ApiError("NOT_FOUND", "Product not found.");
    }

    const variants = await ProductVariant.find({ productId }).sort({ sortOrder: 1, _id: 1 });
    return NextResponse.json(variants);
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
    await requireSession();

    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const parsed = addVariantSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) throw parsed.error;

    const { automationTier, surfaceFinish, variantCode, price } = parsed.data;

    const created = await addVariantToProduct({
      productId,
      automationTier,
      surfaceFinish,
      variantCode,
      price,
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
    await requireSession();

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

    const bulkOps = incoming.map((variant) => ({
      updateOne: {
        filter: { _id: variant.id, productId },
        update: {
          $set: {
            variantCode: variant.variantCode,
            code: variant.variantCode, // kept in sync for legacy readers
            "config.variantCode": variant.variantCode,
            price: mongoose.Types.Decimal128.fromString(variant.price.toFixed(2)),
            updatedAt: new Date(),
          },
        },
      },
    }));

    await ProductVariant.bulkWrite(bulkOps);

    // Keep the derived Product.price in step with the cheapest active variant
    const cheapest = await ProductVariant.find({ productId, isActive: true })
      .sort({ price: 1 })
      .select("price")
      .lean();
    const firstPrice = (cheapest[0] as { price?: unknown } | undefined)?.price;
    if (firstPrice !== undefined && firstPrice !== null) {
      await Product.updateOne(
        { _id: productId },
        { $set: { price: mongoose.Types.Decimal128.fromString(String(firstPrice)), updatedAt: new Date() } }
      );
    }

    const updatedVariants = await ProductVariant.find({ productId }).sort({ sortOrder: 1, _id: 1 });

    return apiSuccess({
      message: `Updated ${incoming.length} variant${incoming.length === 1 ? "" : "s"} successfully.`,
      variants: updatedVariants,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/products/[id]/variants" });
  }
}
