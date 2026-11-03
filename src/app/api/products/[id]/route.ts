import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Product, ProductVariant, ProductVariantHistory, Category } from "@/models";
import { withTransaction } from "@/lib/transaction";
import { getNextSequence } from "@/lib/counter";
import { withPermission, withSession } from "@/lib/api-auth";
import { assertProductImageAllowed, assertProductImagesAllowed } from "@/lib/imageOwnership";
import { coverFields, imagesOf, withLegacyCover, type ProductImage } from "@/lib/productImages";
import { assertAccessoriesAllowed } from "@/lib/productAccessoriesServer";
import {
  ApiError,
  apiSuccess,
  handleApiError,
  parseNumericId,
  readJsonBody,
} from "@/lib/api-response";
import { updateProductSchema } from "@/lib/validation/product";
import { normalizeProduct } from "@/lib/quotationNormalization";
import { applyGstRateToVariants, assertProductTaxAllowed, loadCompanyTaxSettings, type GstApplyResult } from "@/lib/productTax";
import { normalizeProductGstRate } from "@/lib/taxSettings";
import { assertProductSpecs, loadCategorySpecSources } from "@/lib/categorySpecs";
import { redactProductForRole } from "@/lib/variantRedaction";
import { actorFromSession } from "@/lib/softDelete/actor";
import { softDeleteOne } from "@/lib/softDelete/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return await withSession(async ({ role, permissions }) => {
      await connectMongoDB();
      const productId = parseNumericId(id, "product id");

      const product = await Product.findById(productId)
        .populate({
          path: "category",
          populate: {
            path: "parent",
            populate: { path: "parent" },
          },
        })
        .populate({
          path: "variants",
          options: { sort: { sortOrder: 1 } },
        });

      if (!product) {
        throw new ApiError("NOT_FOUND", "Product not found.");
      }
      const normalized = normalizeProduct(product.toObject ? product.toObject() : product);
      return NextResponse.json(redactProductForRole(normalized, role, permissions));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/products/[id]" });
  }
}

/**
 * PATCH /api/products/[id]
 *
 * Strictly whitelisted partial update. `variants` is NOT accepted here — the
 * variant matrix is owned by the dedicated variant endpoints, so a product
 * update can never silently wipe or re-create variants.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    // Catalog writes are restricted via catalog:edit capability.
    return await withPermission("catalog:edit", async ({ companyId }) => {
    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const existingProduct = await Product.findById(productId);
    if (!existingProduct) {
      throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
    }

    const rawBody = await readJsonBody(req);

    // Reject a "variants" key explicitly (and first) so the failure is
    // actionable instead of a generic strict-mode error. The variant matrix is
    // owned by the dedicated variant endpoints and is never writable here.
    if (
      typeof rawBody === "object" &&
      rawBody !== null &&
      "variants" in (rawBody as Record<string, unknown>)
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Variants cannot be changed through this endpoint. Use the Edit Variants flow instead.",
        { field: "variants" }
      );
    }

    const parsed = updateProductSchema.safeParse(rawBody);
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

    // Suggested accessories (when sent) replace the product's list; they must be this company's own products.
    if (data.accessoryIds !== undefined) data.accessoryIds = await assertAccessoriesAllowed(data.accessoryIds, productId);

    // The gallery (up to six pictures, cover first) replaces the product's pictures; the older single-image fields always
    // follow its first picture. A client that still sends only the single image moves the cover of the gallery instead.
    const currentImages = imagesOf(existingProduct);
    if (data.images !== undefined) {
      if (companyId === null) {
        throw new ApiError("FORBIDDEN", "A company context is required to change product images.");
      }
      await assertProductImagesAllowed(data.images as ProductImage[], companyId, currentImages);
      Object.assign(data, coverFields(data.images as ProductImage[]));
    } else if (data.imageUrl !== undefined || data.imagePublicId !== undefined) {
      const nextUrl = (data.imageUrl !== undefined ? data.imageUrl : existingProduct.imageUrl ?? null) as string | null;
      const nextPublicId = (data.imagePublicId !== undefined ? data.imagePublicId : nextUrl === (existingProduct.imageUrl ?? null) ? existingProduct.imagePublicId ?? null : null) as string | null;
      data.images = withLegacyCover(currentImages, { imageUrl: nextUrl, imagePublicId: nextPublicId });
    }

    // Replacing the image may only point at an asset this company owns; an
    // unchanged value (including a legacy asset already on the product) is fine.
    if (data.imagePublicId !== undefined) {
      if (companyId === null) {
        throw new ApiError("FORBIDDEN", "A company context is required to change a product image.");
      }
      await assertProductImageAllowed(data.imagePublicId as string | null, companyId, existingProduct.imagePublicId);
    }

    // Category change must point at an existing, active category. Tier/finish on
    // the product are legacy and always derived from the category, never edited.
    if (data.categoryId !== undefined) {
      const targetCategoryId = data.categoryId as number;
      if (!targetCategoryId) {
        throw new ApiError("REQUIRED_FIELD", "Category is required.", { field: "categoryId" });
      }

      const category = await Category.findById(targetCategoryId);
      if (!category) {
        throw new ApiError("NOT_FOUND", "The selected category does not exist.", {
          field: "categoryId",
        });
      }
      if (!category.isActive) {
        throw new ApiError("CONFLICT", "The selected category is inactive.", {
          field: "categoryId",
        });
      }

      if (targetCategoryId !== existingProduct.categoryId) {
        data.automationTier = null;
        data.surfaceFinish = null;
      }
    }

    // Application-level product code uniqueness (no DB unique index on purpose)
    if (typeof data.code === "string" && data.code) {
      const codeOwner = await Product.findOne({ code: data.code, _id: { $ne: productId } })
        .select("_id")
        .lean();
      if (codeOwner) {
        throw new ApiError("DUPLICATE_RECORD", `Product code '${data.code}' is already in use.`, {
          field: "code",
        });
      }
    }

    // HSN/SAC code and GST rate come from the company's own lists (a value the product already has stays accepted).
    if (data.hsnCode !== undefined || data.gstRate !== undefined) {
      if (companyId === null) {
        throw new ApiError("FORBIDDEN", "A company context is required to change a product's tax details.");
      }
      assertProductTaxAllowed(
        await loadCompanyTaxSettings(companyId),
        { hsnCode: data.hsnCode as string | null | undefined, gstRate: data.gstRate as number | null | undefined },
        { hsnCode: existingProduct.hsnCode, gstRate: existingProduct.gstRate }
      );
    }
    // Specification values (when sent) replace the product's, checked against its (new) category's fields.
    if (data.specs !== undefined) {
      const targetCategoryId = (data.categoryId as number | undefined) ?? existingProduct.categoryId;
      data.specs = targetCategoryId === null ? {} : assertProductSpecs(targetCategoryId, await loadCategorySpecSources(), data.specs ?? {});
    }

    // Only a CHANGED rate re-splits the variants' GST-inclusive prices; the prices themselves never change.
    const newGstRate = typeof data.gstRate === "number" && data.gstRate !== normalizeProductGstRate(existingProduct.gstRate) ? data.gstRate : null;
    let taxChange: GstApplyResult | null = null;

    data.updatedAt = new Date();

    const updatedProduct = await withTransaction(async (dbSession) => {
      // Variants first: it refuses before writing anything if a price could not be kept.
      if (newGstRate !== null) {
        taxChange = await applyGstRateToVariants([productId], newGstRate, dbSession);
      }

      const updateQuery = Product.findByIdAndUpdate(productId, { $set: data }, { new: true });
      if (dbSession) updateQuery.session(dbSession);
      const updated = await updateQuery;

      if (!updated) {
        throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
      }

      let query = Product.findById(productId);
      if (dbSession) query = query.session(dbSession);
      return await query.populate({
        path: "variants",
        options: { sort: { sortOrder: 1 } },
      });
    });

    return apiSuccess(
      normalizeProduct(updatedProduct?.toObject ? updatedProduct.toObject() : updatedProduct),
      taxChange ? { meta: { taxChange } } : undefined
    );
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/products/[id]" });
  }
}

/**
 * DELETE /api/products/[id]
 *
 * Soft delete. Always succeeds — the product and its variants are never
 * destroyed, so an existing quotation item keeps resolving them exactly as
 * before (pricing, GST, PDF output and dealer earnings are untouched, since
 * none of that reads through the live-only default scope). The only effect
 * is that the product stops being offered for a NEW quotation item, enforced
 * at quotation-item creation, not here.
 *
 * Variants are cascaded (soft-deleted, never physically removed) in the same
 * step. The pre-existing ProductVariantHistory snapshot is STILL written
 * first, exactly as a hard delete would have — the "Edit Variants" matrix
 * screen's own, separate restore-from-history flow (`variantMatrix.ts`,
 * untouched by this phase) depends on that row to tell a removed combination
 * apart from one that was never added; it is unaffected by whether the
 * underlying ProductVariant row was hard- or soft-deleted.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    // Soft-deleting products is guarded by catalog:delete capability.
    return await withPermission("catalog:delete", async ({ session }) => {
    const actor = actorFromSession(session);
    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const product = await Product.findById(productId);
    if (!product) {
      throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
    }

    const deletedBy = session.user?.email ?? null;
    const deletedAt = new Date();

    const variants = await ProductVariant.find({ productId }).lean();
    await withTransaction(async (dbSession) => {
      for (const variant of variants) {
        const historyId = await getNextSequence("productVariantHistory", ProductVariantHistory, dbSession);
        const historyDoc = new ProductVariantHistory({
          _id: historyId,
          variantId: variant._id,
          productId,
          productCode: product.code ?? null,
          variantCode: variant.variantCode ?? null,
          name: variant.name ?? null,
          code: variant.code ?? null,
          automationTier: variant.automationTier ?? null,
          surfaceFinish: variant.surfaceFinish ?? null,
          config: variant.config ?? {},
          price: variant.price ?? null,
          isActive: variant.isActive ?? true,
          sortOrder: variant.sortOrder ?? 0,
          reason: "product_hard_delete",
          deletedBy,
          deletedAt,
        });
        if (dbSession) await historyDoc.save({ session: dbSession });
        else await historyDoc.save();
      }
    });

    await softDeleteOne({
      model: Product,
      entityType: "product",
      id: productId,
      actor,
      label: product.name,
      cascade: [{ entityType: "productVariant", model: ProductVariant, foreignField: "productId" }],
    });

    return apiSuccess({
      productId,
      deletedVariants: variants.length,
    });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/products/[id]" });
  }
}
