import { connectMongoDB } from "@/lib/mongodb";
import { Category, Product } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { categorySubtreeIds, loadCategorySpecSources } from "@/lib/categorySpecs";
import { categoryChain, normalizeSpecFields, specFieldsForCategory, type CategorySpecSource, type SpecField } from "@/lib/productSpecs";
import { categorySpecFieldsSchema } from "@/lib/validation/productSpecs";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** How many products in the category's subtree have a value for each key. */
async function valueCounts(subtree: number[], keys: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(keys.map(async (key) => {
    counts[key] = await Product.countDocuments({ categoryId: { $in: subtree }, [`specs.${key}`]: { $exists: true } });
  }));
  return counts;
}

function loadCategory(sources: CategorySpecSource[], categoryId: number): CategorySpecSource {
  const category = sources.find((row) => row.id === categoryId);
  if (!category) throw new ApiError("NOT_FOUND", "Category not found.", { field: "id" });
  return category;
}

/**
 * GET /api/categories/[id]/spec-fields
 *
 * The category's own specification fields, the fields it inherits from the categories above it, and how many
 * products (in this category and below) have a value for each.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withPermission("categories:read", async (actor) => {
      requireActiveCompany(actor);
      await connectMongoDB();
      const categoryId = parseNumericId((await context.params).id, "category id");
      const sources = await loadCategorySpecSources();
      const category = loadCategory(sources, categoryId);
      const fields = normalizeSpecFields(category.specFields);
      const inherited = specFieldsForCategory(category.parentId, sources);
      const usage = await valueCounts(categorySubtreeIds(categoryId, sources), fields.map((field) => field.key));
      return apiSuccess({ id: categoryId, name: category.name ?? null, fields, inherited, usage });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/categories/[id]/spec-fields" });
  }
}

/**
 * PUT /api/categories/[id]/spec-fields
 *
 * Replaces the category's own fields (order = display order). A key cannot repeat one defined above or below this
 * category. A field's type cannot change, and a dropdown option cannot be removed, while products use it. A removed
 * field's values stay on the products (hidden) until a product is next saved. Nothing about the products changes here.
 */
export async function PUT(req: Request, context: RouteContext) {
  try {
    return await withPermission("categories:manage", async (actor) => {
      requireActiveCompany(actor);
      const parsed = categorySpecFieldsSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError("VALIDATION_ERROR", issue?.message ?? "Invalid specification fields.", {
          field: issue?.path.length ? `specFields.${issue.path.slice(1).join(".")}` : "specFields",
          details: { issues: parsed.error.issues },
        });
      }
      const next: SpecField[] = parsed.data.fields;
      await connectMongoDB();
      const categoryId = parseNumericId((await context.params).id, "category id");
      const sources = await loadCategorySpecSources();
      const category = loadCategory(sources, categoryId);
      const subtree = categorySubtreeIds(categoryId, sources);

      // Keys are unique along every chain the category is part of.
      const elsewhere = new Map<string, string>();
      for (const row of [...categoryChain(category.parentId, sources), ...sources.filter((row) => row.id !== categoryId && subtree.includes(row.id))]) {
        for (const field of normalizeSpecFields(row.specFields)) elsewhere.set(field.key, row.name ?? "another category");
      }
      const clash = next.find((field) => elsewhere.has(field.key));
      if (clash) {
        throw new ApiError("VALIDATION_ERROR", `"${clash.label}" uses a key already defined by ${elsewhere.get(clash.key)}.`, { field: "specFields" });
      }

      // Changes that would make stored values invalid are refused while products use them.
      const current = normalizeSpecFields(category.specFields);
      for (const before of current) {
        const after = next.find((field) => field.key === before.key);
        if (!after) continue;
        if (after.type !== before.type) {
          const used = (await valueCounts(subtree, [before.key]))[before.key];
          if (used > 0) throw new ApiError("CONFLICT", `"${before.label}" has values on ${used} product${used === 1 ? "" : "s"}, so its type cannot change.`, { field: "specFields" });
        }
        const removedOptions = before.type === "select" && after.type === "select" ? before.options.filter((option) => !after.options.includes(option)) : [];
        if (removedOptions.length > 0) {
          const used = await Product.countDocuments({ categoryId: { $in: subtree }, [`specs.${before.key}`]: { $in: removedOptions } });
          if (used > 0) throw new ApiError("CONFLICT", `${used} product${used === 1 ? " uses" : "s use"} "${removedOptions.join('", "')}" for "${before.label}", so it cannot be removed.`, { field: "specFields" });
        }
      }

      await Category.updateOne({ _id: categoryId }, { $set: { specFields: next } });
      const removed = current.filter((field) => !next.some((row) => row.key === field.key)).map((field) => field.key);
      return apiSuccess({ id: categoryId, fields: next, hiddenValues: removed.length > 0 ? await valueCounts(subtree, removed) : {} });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PUT /api/categories/[id]/spec-fields" });
  }
}
