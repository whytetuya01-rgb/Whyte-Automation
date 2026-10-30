/**
 * Category-driven product specifications (#3, batch 3): field normalisation, inheritance down the category tree,
 * value validation (text / number + unit / dropdown), display resolution for the picker and the PDF (with the
 * reserved variant override), strict field-list validation, and static guards on the routes.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/product-specs.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenCategoryTree, formatSpecValue, normalizeProductSpecs, normalizeSpecFields, resolveItemSpecs, specFieldsForCategory, specKeyFromLabel, validateSpecValues, type SpecField } from "../src/lib/productSpecs";
import { categorySpecFieldsSchema } from "../src/lib/validation/productSpecs";
import { updateProductSchema } from "../src/lib/validation/product";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");
const field = (over: Partial<SpecField> & { key: string; label: string }): SpecField => ({ type: "text", unit: null, options: [], required: false, showInPicker: false, showOnPdf: false, scope: "product", ...over });

function main() {
  // normalisation
  assert.deepEqual(normalizeSpecFields(undefined), []);
  const stored = normalizeSpecFields([
    { key: "load", label: "  Load  ", type: "number", unit: " A ", showOnPdf: true },
    { key: "load", label: "Dup", type: "text" },
    { key: "Bad Key", label: "x", type: "text" },
    { key: "glass", label: "Glass", type: "select", options: ["Black", "Black", " White ", ""], unit: "mm" },
    { key: "empty", label: "Empty select", type: "select", options: [] },
    { key: "weird", label: "Weird", type: "date" },
  ]);
  assert.deepEqual(stored.map((f) => [f.key, f.label, f.type, f.unit, f.options]), [["load", "Load", "number", "A", []], ["glass", "Glass", "select", null, ["Black", "White"]]]);
  assert.equal(specKeyFromLabel("Load Current (A)"), "load_current_a");
  assert.equal(specKeyFromLabel("2 gang", ["f_2_gang"]), "f_2_gang_2");
  assert.ok(/^[a-z][a-z0-9_]*$/.test(specKeyFromLabel("   ")));
  pass("stored fields read back safely (valid, unique keys; dropdown needs options; unit only for text/number); keys derive from labels");

  // inheritance
  const tree = [
    { id: 1, name: "Tactus", specFields: [field({ key: "warranty", label: "Warranty", unit: "years" })], children: [{ id: 2, name: "Switches", specFields: [field({ key: "load", label: "Load", type: "number", unit: "A" })], children: [{ id: 3, name: "2 module", children: [] }] }] },
    { id: 4, name: "Accessories", children: [] },
  ];
  const rows = flattenCategoryTree(tree);
  assert.deepEqual(rows.map((r) => [r.id, r.parentId]), [[1, null], [2, 1], [3, 2], [4, null]]);
  assert.deepEqual(specFieldsForCategory(3, rows).map((f) => [f.key, f.categoryName]), [["warranty", "Tactus"], ["load", "Switches"]], "a sub-category's product fills in the fields above it, top first");
  assert.deepEqual(specFieldsForCategory(4, rows), []);
  assert.deepEqual(specFieldsForCategory(null, rows), []);
  assert.equal(specFieldsForCategory(99, rows).length, 0);
  assert.equal(specFieldsForCategory(1, [{ id: 1, parentId: 1, specFields: tree[0].specFields }]).length, 1, "a cycle stops");
  pass("fields are inherited down the category tree; other branches, no category and cycles are safe");

  // values
  const fields = [
    field({ key: "load", label: "Load", type: "number", unit: "A", required: true }),
    field({ key: "glass", label: "Glass", type: "select", options: ["Black", "White"] }),
    field({ key: "note", label: "Note" }),
  ];
  let r = validateSpecValues(fields, { load: "10", glass: "Black", note: "  Two   words " });
  assert.deepEqual([r.errors.length, r.values], [0, { load: 10, glass: "Black", note: "Two words" }]);
  r = validateSpecValues(fields, { load: 2.5, glass: "", note: null });
  assert.deepEqual([r.errors.length, r.values], [0, { load: 2.5 }], "blank values are not stored");
  for (const bad of [{}, { load: "abc" }, { load: 1.23456 }, { load: 10, glass: "Red" }, { load: 10, other: "x" }, { load: 10, note: "x".repeat(201) }, { load: 10, note: "a\u0007b" }, { load: 10, glass: 5 }]) {
    assert.ok(validateSpecValues(fields, bad).errors.length > 0, JSON.stringify(bad));
  }
  assert.ok(validateSpecValues(fields, [1]).errors.length > 0);
  assert.equal(validateSpecValues([], undefined).errors.length, 0);
  pass("values validated: number (4 decimals), dropdown option, text length, required, unknown keys; blanks dropped");

  // display
  const shown = [
    field({ key: "load", label: "Load", type: "number", unit: "A", showInPicker: true, showOnPdf: true }),
    field({ key: "glass", label: "Glass", type: "select", options: ["Black"], showOnPdf: true }),
    field({ key: "note", label: "Note", showInPicker: true }),
  ];
  const specs = { load: 10, glass: "Black", note: "x", stale: "gone" };
  assert.deepEqual(resolveItemSpecs(shown, specs, undefined, "picker").map((s) => s.text), ["10 A", "x"]);
  assert.deepEqual(resolveItemSpecs(shown, specs, undefined, "pdf").map((s) => [s.label, s.text]), [["Load", "10 A"], ["Glass", "Black"]]);
  assert.equal(resolveItemSpecs(shown, specs).length, 3, "removed fields' stale values are never shown");
  assert.deepEqual(resolveItemSpecs(shown, specs, { load: 16 }, "pdf")[0].text, "16 A", "a variant value (future) overrides the product's");
  assert.equal(resolveItemSpecs(shown, { glass: "Red" }, undefined, "pdf").length, 0, "a value no longer among the options is hidden");
  assert.equal(formatSpecValue({ type: "number", unit: "W" }, 0.5), "0.5 W");
  assert.deepEqual(normalizeProductSpecs({ a: 1, b: " x ", c: NaN, Bad: 2, d: {} }), { a: 1, b: "x" });
  pass("picker and PDF show only their fields in field order, with units; stale or invalid values hidden; variant override reserved");

  // schema
  const ok = categorySpecFieldsSchema.safeParse({ fields: [{ key: "load", label: "Load", type: "number", unit: "A", showOnPdf: true }, { key: "glass", label: "Glass", type: "select", options: ["Black", "White"] }] });
  assert.ok(ok.success && ok.data.fields[0].scope === "product" && ok.data.fields[1].unit === null);
  const bads = [
    { fields: [{ key: "a", label: "A", type: "select" }] },
    { fields: [{ key: "a", label: "A", type: "text", options: ["x"] }] },
    { fields: [{ key: "a", label: "A", type: "select", options: ["x", "X"] }] },
    { fields: [{ key: "a", label: "A", type: "text" }, { key: "a", label: "B", type: "text" }] },
    { fields: [{ key: "a", label: "Same", type: "text" }, { key: "b", label: "same", type: "text" }] },
    { fields: [{ key: "A", label: "A", type: "text" }] },
    { fields: [{ key: "a", label: "A", type: "text", scope: "variant" }] },
    { fields: [{ key: "a", label: "A", type: "date" }] },
    { fields: Array.from({ length: 31 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, type: "text" })) },
    { fields: [], companyId: 2 },
  ];
  for (const bad of bads) assert.equal(categorySpecFieldsSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
  assert.ok(categorySpecFieldsSchema.safeParse({ fields: [] }).success, "clearing all fields is allowed");
  assert.ok(updateProductSchema.safeParse({ specs: { load: 5 } }).success && updateProductSchema.safeParse({ specs: null }).success);
  assert.ok(!updateProductSchema.safeParse({ specs: "x" }).success);
  pass("field lists validated strictly (types, options, unique keys and names, limits, no unknown keys)");

  // guards
  const fieldsRoute = read("src", "app", "api", "categories", "[id]", "spec-fields", "route.ts");
  assert.ok(/withPermission\("categories:manage"/.test(fieldsRoute) && /withPermission\("categories:read"/.test(fieldsRoute) && (fieldsRoute.match(/requireActiveCompany\(actor\)/g) ?? []).length === 2);
  assert.ok(/its type cannot change/.test(fieldsRoute) && /cannot be removed/.test(fieldsRoute), "in-use types and options are protected");
  assert.ok(!/body\.companyId|searchParams/.test(fieldsRoute));
  const catalog = read("src", "app", "api", "catalog", "spec-fields", "route.ts");
  assert.ok(/withSession\(/.test(catalog) && /companyId === null\) return NextResponse\.json\(\{ categories: \[\] \}\)/.test(catalog) && /showOnPdf/.test(catalog));
  assert.ok(/assertProductSpecs\(categoryId/.test(read("src", "app", "api", "products", "route.ts")) && /assertProductSpecs\(targetCategoryId/.test(read("src", "app", "api", "products", "[id]", "route.ts")));
  assert.ok(/specFields: \{\s*type: \[/.test(read("src", "models", "Category.ts")) && /specs: \{ type: mongoose\.Schema\.Types\.Mixed, default: undefined \}/.test(read("src", "models", "Product.ts")), "optional fields on the models: no migration");
  pass("static guards: tenant-scoped, permission-checked, in-use protection, products validated against their category, no migration");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
