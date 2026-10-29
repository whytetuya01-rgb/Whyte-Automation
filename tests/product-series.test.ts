/**
 * Product series (#3, batch 1): top-level categories marked as a series, with description, image and "show on PDF".
 * Pure helpers (normalisation, category -> series mapping, which series the document shows), validation, and static
 * guards that the API is tenant-scoped, top-level only and image-ownership checked.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/product-series.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_SERIES, SERIES_LIMITS, SERIES_PER_PAGE, buildCategoryRootMap, normalizeSeries, seriesForDocument, type CompanySeriesCatalog } from "../src/lib/productSeries";
import { categorySeriesSchema } from "../src/lib/validation/productSeries";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

function main() {
  // ── normalisation ──
  assert.deepEqual(normalizeSeries(undefined), EMPTY_SERIES, "a category never marked has no series");
  assert.deepEqual(normalizeSeries({ enabled: true, description: "  Glass touch  ", imageUrl: "https://res.cloudinary.com/x/a.png", imagePublicId: "p", showOnPdf: true }), { enabled: true, description: "Glass touch", imageUrl: "https://res.cloudinary.com/x/a.png", imagePublicId: "p", showOnPdf: true });
  assert.equal(normalizeSeries({ enabled: true, imageUrl: "javascript:alert(1)", imagePublicId: "p" }).imageUrl, null, "only https images");
  assert.equal(normalizeSeries({ enabled: "yes" }).enabled, false, "only a real true enables");
  assert.equal(normalizeSeries({ description: "x".repeat(900) }).description?.length, SERIES_LIMITS.description);
  const edited = normalizeSeries(undefined);
  edited.enabled = true;
  edited.showOnPdf = true;
  assert.deepEqual(normalizeSeries(null), EMPTY_SERIES, "editing one category's series never changes the default for the next");
  assert.ok(Object.isFrozen(EMPTY_SERIES), "the shared default cannot be mutated");
  pass("stored series are read back safely (absent = not a series, https images only, bounded description, fresh object)");

  // ── category -> series ──
  const rootOf = buildCategoryRootMap([
    { id: 1, parentId: null }, // Tactus (series)
    { id: 2, parentId: 1 }, // Tactus > Switches
    { id: 3, parentId: 2 }, // Tactus > Switches > 2-module
    { id: 4, parentId: null }, // Accessories (type group)
    { id: 5, parentId: 99 }, // parent unknown: treated as its own top
    { id: 6, parentId: 7 },
    { id: 7, parentId: 6 }, // a cycle never loops
  ]);
  assert.deepEqual([rootOf["1"], rootOf["2"], rootOf["3"], rootOf["4"], rootOf["5"]], [1, 1, 1, 4, 5]);
  assert.ok(rootOf["6"] === 6 || rootOf["6"] === 7, "a cycle stops");
  pass("every category maps to its top-level category at any depth; unknown parents and cycles stop safely");

  // ── which series the document shows ──
  const catalog: CompanySeriesCatalog = {
    series: [
      { id: 1, name: "Tactus", description: "Glass touch", imageUrl: null },
      { id: 8, name: "Retro Series", description: null, imageUrl: null },
    ],
    rootOf: { ...rootOf, "8": 8, "9": 8 },
  };
  const items = [{ product: { categoryId: 9 } }, { product: { categoryId: 3 } }, { product: { categoryId: 4 } }, { product: { categoryId: 2 } }, { product: null }, { product: { categoryId: null } }];
  assert.deepEqual(seriesForDocument(items, catalog).map((s) => s.name), ["Retro Series", "Tactus"], "used series once each, in first-use order; type groups and unmarked categories never");
  assert.deepEqual(seriesForDocument(items, null), [], "no catalog (offline / platform) shows nothing");
  assert.deepEqual(seriesForDocument([{ product: { categoryId: 4 } }], catalog), [], "a quotation without series products shows none");
  assert.equal(SERIES_PER_PAGE, 3);
  pass("the document shows only the series its products belong to (enabled + show on PDF), each once, in order");

  // ── validation ──
  assert.equal(categorySeriesSchema.safeParse({ enabled: true, description: "Line 1\nLine 2", showOnPdf: true, image: { url: "https://res.cloudinary.com/d/image/upload/v1/whyte/companies/1/products/a.png", publicId: "whyte/companies/1/products/a" } }).success, true);
  assert.equal(categorySeriesSchema.safeParse({ image: null, description: "" }).success, true, "null / blank clear");
  for (const bad of [{}, { enabled: "yes" }, { description: "x".repeat(SERIES_LIMITS.description + 1) }, { description: "bad\u0007char" }, { image: { url: "http://insecure/a.png", publicId: "a" } }, { image: { url: "https://x/a.png" } }, { showOnPdf: 1 }, { companyId: 2 }, { enabled: true, extra: 1 }]) {
    assert.equal(categorySeriesSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  pass("series settings are validated strictly (types, bounded description, https image, no unknown keys, not empty)");

  // ── static guards ──
  const patch = read("src", "app", "api", "categories", "[id]", "series", "route.ts");
  assert.ok(/withPermission\("categories:manage"/.test(patch) && /companyId === null/.test(patch), "category managers of a real company only");
  assert.ok(/category\.level !== 1 \|\| category\.parentId !== null/.test(patch), "top-level categories only");
  assert.ok(/assertImageManageable\(input\.image\.publicId, companyId\)/.test(patch) && /includes\(`\/\$\{input\.image\.publicId\}`\)/.test(patch), "the image must be the company's own upload, and the URL that image");
  assert.ok(!/body\.companyId|input\.companyId|searchParams/.test(patch), "the company never comes from the request");
  const get = read("src", "app", "api", "catalog", "series", "route.ts");
  assert.ok(/withSession\(/.test(get) && /companyId === null\) return NextResponse\.json\(empty\)/.test(get), "readable by anyone signed in to a company; platform context gets nothing");
  const model = read("src", "models", "Category.ts");
  assert.ok(/series: \{\s*type: new Schema/.test(model) && /default: undefined/.test(model) && /tenantScopePlugin\(CategorySchema\)/.test(model), "an optional block on the tenant-scoped model: no migration");
  pass("static guards: tenant-scoped model, permission-checked, top-level only, own images only, company never from the request");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
