import { Category } from "@/models";
import { ApiError } from "@/lib/api-response";
import { specFieldsForCategory, validateSpecValues, type CategorySpecSource, type ProductSpecs } from "@/lib/productSpecs";

/**
 * Server side of product specifications (#3, batch 3): the acting company's categories with their fields (through the
 * tenant-scoped model), and checking a product's values against the fields of its category.
 */

export async function loadCategorySpecSources(): Promise<CategorySpecSource[]> {
  const rows = await Category.find({}).select("parentId name specFields").lean();
  return rows.map((row) => ({ id: Number(row._id), parentId: row.parentId ?? null, name: row.name, specFields: row.specFields }));
}

/** The product's values checked against its category's fields (inherited ones included); the first problem is reported. */
export function assertProductSpecs(categoryId: number, sources: ReadonlyArray<CategorySpecSource>, input: unknown): ProductSpecs {
  const { values, errors } = validateSpecValues(specFieldsForCategory(categoryId, sources), input);
  if (errors.length > 0) {
    throw new ApiError("VALIDATION_ERROR", errors[0].message, { field: errors[0].key ? `specs.${errors[0].key}` : "specs", details: { issues: errors } });
  }
  return values;
}

/** A category and every category below it. */
export function categorySubtreeIds(categoryId: number, sources: ReadonlyArray<CategorySpecSource>): number[] {
  const ids = [categoryId];
  for (let index = 0; index < ids.length; index += 1) {
    for (const row of sources) if (row.parentId === ids[index] && !ids.includes(row.id)) ids.push(row.id);
  }
  return ids;
}
