import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Product, ProductVariant, ProductVariantHistory, Category } from "@/models";
import { withTransaction } from "@/lib/transaction";
import { getNextSequence } from "@/lib/counter";
import { requireRole, requireSession } from "@/lib/api-auth";
import {
  ApiError,
  apiSuccess,
  handleApiError,
  parseNumericId,
  readJsonBody,
} from "@/lib/api-response";
import { updateProductSchema } from "@/lib/validation/product";
import { getProductDependencies } from "@/lib/dependencies";
import { normalizeProduct } from "@/lib/quotationNormalization";
import { redactProductForRole } from "@/lib/variantRedaction";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;

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
    return NextResponse.json(redactProductForRole(normalized, role));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/products/[id]" });
  }
}

/**
 * PATCH /api/products/[id]
 *
 * Strictly whitelisted partial update. `variants` is NOT accepted here Ã¢â‚¬â€ the
 * variant matrix is owned by the dedicated variant endpoints, so a product
 * update can never silently wipe or re-create variants.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    // Catalog writes are restricted to Super Admin / Admin.
    await requireRole("super_admin", "admin");

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

    data.updatedAt = new Date();

    const updatedProduct = await withTransaction(async (dbSession) => {
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
      normalizeProduct(updatedProduct?.toObject ? updatedProduct.toObject() : updatedProduct)
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/products/[id]" });
  }
}

/**
 * DELETE /api/products/[id]
 *
 * Hard delete. Blocked with 409 when the product is still referenced by any
 * quotation item; its variants are removed in the same transaction, and every
 * cascaded variant gets the same inert history row a direct variant delete
 * would have written (so a product delete never silently loses the audit trail).
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    // Catalog writes are restricted to Super Admin / Admin. The session is
    // also kept so the soft-delete audit field records the actor.
    const authSession = await requireRole("super_admin", "admin");
    await connectMongoDB();
    const productId = parseNumericId((await context.params).id, "product id");

    const product = await Product.findById(productId);
    if (!product) {
      throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
    }

    const dependencies = await getProductDependencies(productId);

    if (dependencies.quotationItems > 0) {
      throw new ApiError(
        "DEPENDENCY_EXISTS",
        `This product cannot be deleted because it is used in ${dependencies.quotationItems} quotation ${
          dependencies.quotationItems === 1 ? "item" : "items"
        }. Deactivate it instead.`,
        { details: { quotationItemIds: dependencies.quotationItemIds } }
      );
    }

    const deletedBy = authSession.user?.email ?? null;
    const deletedAt = new Date();

    const cascaded = await withTransaction(async (dbSession) => {
      const deleteQuery = Product.findByIdAndDelete(productId);
      if (dbSession) deleteQuery.session(dbSession);
      const deleted = await deleteQuery;
      if (!deleted) {
        throw new ApiError("NOT_FOUND", "Product not found.", { field: "id" });
      }

      // Snapshot the variants BEFORE removing them.
      const variantQuery = ProductVariant.find({ productId });
      if (dbSession) variantQuery.session(dbSession);
      const variants = await variantQuery.lean().exec();

      const historyDocs = variants.map(
        (variant) =>
          new ProductVariantHistory({
            _id: 0, // replaced below with the real sequence
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
          })
      );

      for (const historyDoc of historyDocs) {
        const historyId = await getNextSequence(
          "productVariantHistory",
          ProductVariantHistory,
          dbSession
        );
        historyDoc._id = historyId;
        if (dbSession) {
          await historyDoc.save({ session: dbSession });
        } else {
          await historyDoc.save();
        }
      }

      if (dbSession) {
        await ProductVariant.deleteMany({ productId }, { session: dbSession });
      } else {
        await ProductVariant.deleteMany({ productId });
      }

      return { variantsDeleted: variants.length };
    });

    return apiSuccess({
      productId,
      deletedVariants: cascaded.variantsDeleted,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/products/[id]" });
  }
}
