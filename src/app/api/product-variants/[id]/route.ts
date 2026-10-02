import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { ProductVariant } from "@/models";
import { requireSession } from "@/lib/api-auth";
import {
  ApiError,
  apiSuccess,
  handleApiError,
  parseNumericId,
  readJsonBody,
} from "@/lib/api-response";
import { updateVariantSchema } from "@/lib/validation/product";
import { findDuplicateVariantCode } from "@/lib/productVariantService";
import { hardDeleteVariant, syncProductPriceFromVariants } from "@/lib/variantDeletion";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/product-variants/[id] Ã¢â‚¬â€ success shape intentionally unchanged. */
export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    await requireSession();

    await connectMongoDB();
    const variantId = parseNumericId(id, "id");

    const variant = await ProductVariant.findById(variantId).populate("product");
    if (!variant) {
      throw new ApiError("NOT_FOUND", "Variant not found.");
    }

    return NextResponse.json(variant);
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/product-variants/[id]" });
  }
}

/**
 * PATCH /api/product-variants/[id]
 *
 * Partial update limited to variantCode, name, price, isActive and sortOrder.
 * automationTier / surfaceFinish are NOT editable here: they are defined by the
 * category master matrix and can only change through a full matrix resync.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    await requireSession();

    await connectMongoDB();
    const variantId = parseNumericId((await context.params).id, "variant id");

    const existingVariant = await ProductVariant.findById(variantId);
    if (!existingVariant) {
      throw new ApiError("NOT_FOUND", "Product variant not found.", { field: "id" });
    }

    const rawBody = await readJsonBody(req);
    const parsed = updateVariantSchema.safeParse(rawBody);
    if (!parsed.success) throw parsed.error;

    const body = parsed.data;
    const data: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      data[key] = value;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError("VALIDATION_ERROR", "No fields were provided to update.");
    }

    // Variant codes must stay unique within the product
    if (typeof data.variantCode === "string") {
      const duplicate = await ProductVariant.findOne({
        productId: existingVariant.productId,
        _id: { $ne: variantId },
      }).select("variantCode code");

      const candidates = [duplicate]
        .filter(Boolean)
        .map((doc) =>
          findDuplicateVariantCode([
            { id: variantId, variantCode: data.variantCode as string },
            {
              id: (doc as { _id: number })._id,
              variantCode: String(
                (doc as { variantCode?: string | null; code?: string | null }).variantCode ??
                  (doc as { code?: string | null }).code ??
                  ""
              ),
            },
          ])
        );

      if (candidates.some(Boolean)) {
        throw new ApiError(
          "DUPLICATE_RECORD",
          `Variant code '${data.variantCode}' is already used by another variant of this product.`,
          { field: "variantCode" }
        );
      }

      data.code = data.variantCode;
    }

    if (typeof data.price === "number") {
      data.price = mongoose.Types.Decimal128.fromString(data.price.toFixed(2));
    }

    if (typeof data.variantCode === "string") {
      const mergedConfig: Record<string, unknown> = { ...(existingVariant.config ?? {}) };
      mergedConfig.variantCode = data.variantCode;
      mergedConfig.code = data.variantCode;
      if (typeof data.name === "string") mergedConfig.name = data.name;
      data.config = mergedConfig;
    } else if (typeof data.name === "string") {
      const mergedConfig: Record<string, unknown> = { ...(existingVariant.config ?? {}) };
      if (data.name) mergedConfig.name = data.name;
      else delete mergedConfig.name;
      data.config = mergedConfig;
    }

    data.updatedAt = new Date();

    const updated = await ProductVariant.findByIdAndUpdate(variantId, { $set: data }, { new: true });
    if (!updated) {
      throw new ApiError("NOT_FOUND", "Product variant not found.", { field: "id" });
    }

    if (data.price !== undefined) {
      await syncProductPriceFromVariants(existingVariant.productId);
    }

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/product-variants/[id]" });
  }
}

/**
 * DELETE /api/product-variants/[id]
 *
 * Thin wrapper over the shared hard-delete flow, so the 404 Ã¢â€ â€™ 409 dependency Ã¢â€ â€™
 * 409 MINIMUM_VARIANT ordering is identical to the product-scoped endpoint.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    // The session is kept so the delete audit field records the actor.
    const authSession = await requireSession();
    await connectMongoDB();
    const variantId = parseNumericId((await context.params).id, "variant id");

    const result = await hardDeleteVariant({
      variantId,
      deletedBy: authSession.user?.email ?? null,
    });

    await syncProductPriceFromVariants(result.productId);

    return apiSuccess({
      message: `Variant '${result.variantLabel}' deleted successfully.`,
      variantId: result.variantId,
      productId: result.productId,
      remainingVariants: result.remainingVariants,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/product-variants/[id]" });
  }
}
