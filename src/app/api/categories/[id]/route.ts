import { connectMongoDB } from "@/lib/mongodb";
import { Category } from "@/models";
import { requireRole } from "@/lib/api-auth";
import {
  ApiError,
  apiSuccess,
  handleApiError,
  parseNumericId,
  readJsonBody,
} from "@/lib/api-response";
import { getCategoryDependencies } from "@/lib/dependencies";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");

    await connectMongoDB();
    const catId = parseNumericId((await context.params).id, "category id");

    const existing = await Category.findById(catId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Category not found.", { field: "id" });
    }

    const body = await readJsonBody(req);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ApiError("VALIDATION_ERROR", "Invalid request body.");
    }
    const record = body as Record<string, unknown>;

    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) {
      throw new ApiError("REQUIRED_FIELD", "Category name is required.", { field: "name" });
    }

    const updateData: Record<string, unknown> = { name };

    // Stored exactly as submitted Ã¢â‚¬â€ this endpoint never reshapes category master
    // data. Omitted axes are left untouched.
    if (Array.isArray(record.variantTiers)) {
      updateData.variantTiers = record.variantTiers;
    }
    if (Array.isArray(record.variantFinishes)) {
      updateData.variantFinishes = record.variantFinishes;
    }

    // Application-level sibling name uniqueness (no DB unique index on purpose)
    const sibling = await Category.findOne({
      parentId: existing.parentId,
      name,
      _id: { $ne: catId },
    })
      .select("_id")
      .lean();
    if (sibling) {
      throw new ApiError("DUPLICATE_RECORD", `A category named '${name}' already exists here.`, {
        field: "name",
      });
    }

    const category = await Category.findByIdAndUpdate(catId, { $set: updateData }, { new: true });
    if (!category) {
      throw new ApiError("NOT_FOUND", "Category not found.", { field: "id" });
    }

    return apiSuccess(category);
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/categories/[id]" });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    await requireRole("super_admin", "admin");

    await connectMongoDB();
    const catId = parseNumericId((await context.params).id, "category id");

    // 404 before any dependency reasoning
    const existing = await Category.findById(catId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Category not found.", { field: "id" });
    }

    const dependencies = await getCategoryDependencies(catId);

    if (dependencies.childCategories > 0) {
      throw new ApiError(
        "DEPENDENCY_EXISTS",
        `Cannot delete: this category has ${dependencies.childCategories} subcategor${
          dependencies.childCategories === 1 ? "y" : "ies"
        }. Delete them first.`,
        { field: "id" }
      );
    }

    if (dependencies.activeProducts > 0) {
      throw new ApiError(
        "DEPENDENCY_EXISTS",
        `Cannot delete: ${dependencies.activeProducts} active product${
          dependencies.activeProducts === 1 ? "" : "s"
        } use this category.`,
        { field: "id" }
      );
    }

    const deleted = await Category.findByIdAndDelete(catId);
    if (!deleted) {
      throw new ApiError("NOT_FOUND", "Category not found.", { field: "id" });
    }

    return apiSuccess({ categoryId: catId });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/categories/[id]" });
  }
}
