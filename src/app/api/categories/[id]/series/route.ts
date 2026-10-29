import { connectMongoDB } from "@/lib/mongodb";
import { Category } from "@/models";
import { withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { assertImageManageable } from "@/lib/imageOwnership";
import { normalizeSeries } from "@/lib/productSeries";
import { categorySeriesSchema } from "@/lib/validation/productSeries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/categories/[id]/series
 *
 * Marks one of the company's TOP-LEVEL categories as a product series and sets its description, image and whether the
 * quotation document shows it. Only the keys sent change. The category is looked up through the tenant-scoped model,
 * so another company's category is simply "not found"; the image must be one this company uploaded (its own product
 * folder), checked before saving. Nothing else about the category or its products changes.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withPermission("categories:manage", async ({ companyId }) => {
      if (companyId === null) {
        throw new ApiError("FORBIDDEN", "Choose a company with \"Act as company\" to edit its product series.");
      }
      await connectMongoDB();
      const categoryId = parseNumericId((await context.params).id, "category id");
      const category = await Category.findById(categoryId).select("level parentId series").lean();
      if (!category) throw new ApiError("NOT_FOUND", "Category not found.", { field: "id" });
      if (category.level !== 1 || category.parentId !== null) {
        throw new ApiError("VALIDATION_ERROR", "Only a top-level category can be a product series.", { field: "id" });
      }

      const parsed = categorySeriesSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError("VALIDATION_ERROR", issue?.message ?? "Invalid series settings.", {
          field: issue?.path.length ? `series.${issue.path.join(".")}` : undefined,
          details: { issues: parsed.error.issues },
        });
      }
      const input = parsed.data;

      // The complete block is written in one update: the saved values, with only the keys that were sent replaced.
      const next = normalizeSeries(category.series);
      if (input.enabled !== undefined) next.enabled = input.enabled;
      if (input.description !== undefined) next.description = input.description;
      if (input.showOnPdf !== undefined) next.showOnPdf = input.showOnPdf;
      if (input.image === null) {
        next.imageUrl = null;
        next.imagePublicId = null;
      } else if (input.image) {
        // Only an image this company uploaded, and the URL must be that image.
        await assertImageManageable(input.image.publicId, companyId);
        if (!input.image.url.includes(`/${input.image.publicId}`)) {
          throw new ApiError("VALIDATION_ERROR", "The series image does not match the uploaded file.", { field: "series.image" });
        }
        next.imageUrl = input.image.url;
        next.imagePublicId = input.image.publicId;
      }

      const updated = await Category.findByIdAndUpdate(categoryId, { $set: { series: next } }, { new: true }).select("name series").lean();
      if (!updated) throw new ApiError("NOT_FOUND", "Category not found.", { field: "id" });
      return apiSuccess({ id: categoryId, name: updated.name, series: normalizeSeries(updated.series) });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/categories/[id]/series" });
  }
}
