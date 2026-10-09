import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Category, Product } from "@/models";
import { normalizeProducts } from "@/lib/quotationNormalization";
import { redactProductsForRole } from "@/lib/variantRedaction";
import { buildEditorCatalog, getEditorCatalog } from "@/lib/editorCatalog";
import { filterProductCatalog, type FilterOptions } from "@/lib/productFiltering";
import { buildVariantLabel, findVariant, normalizeProductDimensions } from "@/lib/variant-dimension";
import type { EditorCatalogProduct, EditorCatalogVariant, Product as FullProduct, ProductVariant } from "@/types";

/**
 * READ-ONLY. Phase 4.1 parity check for the quotation editor's catalog DTO.
 *
 * For the real catalog, compares what `getEditorCatalog()` now ships against
 * what the page shipped before (populate -> normalizeProducts -> redact):
 *   A. every field the editor reads is equal, per product and per variant, in order
 *   B. nothing outside the DTO whitelist is present; cost / tax breakdown never are
 *   C. the real filterProductCatalog gives identical results on both shapes for a
 *      large battery of category / tier / finish / type / search combinations
 *   D. the variant picker helpers (dimensions, findVariant, labels) agree
 *   E. hand-built edge cases (config-derived tier, no tier/finish, stored names and
 *      codes, flat products, dangling category, Decimal128 vs string prices)
 */

const PRODUCT_KEYS = [
  "id", "name", "code", "description", "type", "categoryId", "automationTier", "surfaceFinish",
  "price", "imageUrl", "moduleSize", "isActive", "isMatrix", "matrixDimensions", "category", "variants",
];
const VARIANT_KEYS = ["id", "automationTier", "surfaceFinish", "name", "price", "isActive", "code", "variantCode"];
const FORBIDDEN_VARIANT_KEYS = ["cost", "purchaseTaxPercent", "priceWithoutTax", "taxPercent", "taxAmount", "productId", "tierLabel", "finishLabel", "sortOrder", "config"];

const mismatches: string[] = [];
const note = (message: string) => {
  if (mismatches.length < 25) mismatches.push(message);
  else if (mismatches.length === 25) mismatches.push("... more mismatches omitted");
};
let comparisons = 0;
const same = (label: string, a: unknown, b: unknown) => {
  comparisons++;
  if (JSON.stringify(a) !== JSON.stringify(b)) note(`${label}: legacy=${JSON.stringify(a)} new=${JSON.stringify(b)}`);
};

function compareCatalogs(label: string, legacy: FullProduct[], next: EditorCatalogProduct[]) {
  same(`${label}: product count`, legacy.length, next.length);
  same(`${label}: product id order`, legacy.map((p) => p.id), next.map((p) => p.id));
  const byId = new Map(next.map((p) => [p.id, p]));
  for (const lp of legacy) {
    const np = byId.get(lp.id);
    if (!np) { note(`${label}: product ${lp.id} missing from new catalog`); continue; }
    const key = `${label}: product ${lp.id}`;
    for (const field of ["name", "code", "description", "type", "categoryId", "automationTier", "surfaceFinish", "price", "imageUrl", "moduleSize", "isActive", "isMatrix", "matrixDimensions"] as const) {
      same(`${key}.${field}`, lp[field] ?? null, np[field] ?? null);
    }
    same(`${key}.category.name`, lp.category?.name ?? null, np.category?.name ?? null);
    same(`${key}.category.id`, lp.category ? lp.categoryId : null, np.category?.id ?? null);

    for (const k of Object.keys(np)) if (!PRODUCT_KEYS.includes(k)) note(`${key}: unexpected key ${k}`);
    const lv = lp.variants ?? [];
    const nv = np.variants ?? [];
    same(`${key}: variant id order`, lv.map((v) => v.id), nv.map((v) => v.id));
    nv.forEach((variant, i) => {
      const l = lv[i];
      if (!l) return;
      const vk = `${key} variant ${variant.id}`;
      for (const field of ["automationTier", "surfaceFinish", "name", "price", "isActive"] as const) {
        same(`${vk}.${field}`, l[field] ?? null, variant[field] ?? null);
      }
      same(`${vk}.code`, l.code || undefined, variant.code);
      same(`${vk}.variantCode`, l.variantCode || undefined, variant.variantCode);
      for (const k of Object.keys(variant)) if (!VARIANT_KEYS.includes(k)) note(`${vk}: unexpected key ${k}`);
      for (const k of FORBIDDEN_VARIANT_KEYS) if (k in variant) note(`${vk}: forbidden key ${k} present`);
    });
  }
}

function resultSignature(results: ReturnType<typeof filterProductCatalog>) {
  return results.map((r) => ({
    p: r.product.id,
    v: r.eligibleVariants.map((v) => v.id),
    min: r.minPrice,
    max: r.maxPrice,
    exact: r.exactVariant?.id ?? null,
  }));
}

function pickerSignature(product: EditorCatalogProduct | FullProduct) {
  const active = (product.variants ?? []).filter((v) => v && v.isActive) as EditorCatalogVariant[];
  const dims = normalizeProductDimensions(product as EditorCatalogProduct, active);
  const combos: Array<Record<string, string>> = [];
  if (dims.length === 1) for (const a of dims[0].options) combos.push({ [dims[0].key]: a });
  else if (dims.length >= 2) for (const a of dims[0].options) for (const b of dims[1].options) combos.push({ [dims[0].key]: a, [dims[1].key]: b });
  return {
    dims,
    found: combos.map((c) => findVariant(active, c)?.id ?? null),
    labels: active.map((v) => buildVariantLabel(v)),
  };
}

async function main() {
  await connectMongoDB();

  // ---- real catalog --------------------------------------------------------
  const legacyDocs = await Product.find({ isActive: true })
    .sort({ sortOrder: 1, createdAt: -1 })
    .populate({ path: "category" })
    .populate({ path: "variants", match: { isActive: true }, options: { sort: { sortOrder: 1 } } })
    .lean({ virtuals: true, getters: true });
  const legacyFor = (role: string) => redactProductsForRole(normalizeProducts(legacyDocs), role) as FullProduct[];
  const legacyDealer = legacyFor("dealer");
  const legacyAdmin = legacyFor("admin");
  const next = await getEditorCatalog();

  const variantTotal = next.reduce((n, p) => n + (p.variants?.length ?? 0), 0);
  console.log(`catalog: ${next.length} products, ${variantTotal} variants (legacy: ${legacyDealer.length} products, ${legacyDealer.reduce((n, p) => n + (p.variants?.length ?? 0), 0)} variants)`);

  compareCatalogs("dealer", legacyDealer, next);
  compareCatalogs("admin", legacyAdmin, next);

  // ---- filter battery ------------------------------------------------------
  const categories = await Category.find({}).lean();
  const tierOptions = new Map<string, string>();
  const finishOptions = new Map<string, string>();
  for (const c of categories as unknown as Array<{ variantTiers?: Array<{ value: string; label: string }>; variantFinishes?: Array<{ value: string; label: string }> }>) {
    for (const t of c.variantTiers ?? []) tierOptions.set(t.value, t.label);
    for (const f of c.variantFinishes ?? []) finishOptions.set(f.value, f.label);
  }
  const configuredTiers = [...tierOptions].map(([value, label]) => ({ value, label }));
  const configuredFinishes = [...finishOptions].map(([value, label]) => ({ value, label }));
  const categoryIds: Array<number | null> = [null, ...new Set(next.map((p) => p.categoryId).filter((c): c is number => c !== null))];
  const tiers = ["all", "", ...configuredTiers.map((t) => t.value), ...configuredTiers.map((t) => t.label), "nope"];
  const finishes = ["all", "", ...configuredFinishes.map((f) => f.value), ...configuredFinishes.map((f) => f.label), "nope"];
  const types = ["all", ...new Set(next.map((p) => p.type))];
  const searches = ["", "touch", "curtain", "switch", "wifi", "glass", "remote", "acrylic", "  TOUCH  ", next[0]?.code ?? "x", next[3]?.name.slice(0, 5) ?? "x", "zzz-no-such"];
  let filterCases = 0;
  let nonEmptyFilterCases = 0;
  for (const categoryId of categoryIds) for (const automationTier of tiers) for (const surfaceFinish of finishes) for (const productType of types) for (const search of searches) {
    const options: FilterOptions = {
      categoryId, automationTier, surfaceFinish, productType, search, configuredTiers, configuredFinishes,
      hasCategoryTiers: configuredTiers.length > 0, hasCategoryFinishes: configuredFinishes.length > 0,
    };
    const a = resultSignature(filterProductCatalog(legacyDealer as unknown as EditorCatalogProduct[], options));
    const b = resultSignature(filterProductCatalog(next, options));
    filterCases++;
    if (a.length > 0) nonEmptyFilterCases++;
    same(`filter ${JSON.stringify({ categoryId, automationTier, surfaceFinish, productType, search })}`, a, b);
  }
  console.log(`filter battery: ${filterCases} combinations compared (${nonEmptyFilterCases} with at least one matching product)`);
  if (nonEmptyFilterCases < 100) note(`filter battery is not exercising enough matches (${nonEmptyFilterCases})`);

  // ---- variant picker helpers ----------------------------------------------
  const legacyById = new Map(legacyDealer.map((p) => [p.id, p]));
  for (const p of next) same(`picker product ${p.id}`, pickerSignature(legacyById.get(p.id) as FullProduct), pickerSignature(p));
  console.log(`variant picker helpers: ${next.length} products compared`);

  // ---- hand-built edge cases ----------------------------------------------
  const D = (s: string) => mongoose.Types.Decimal128.fromString(s);
  const rawProducts = [
    { _id: 9001, name: "Matrix A", code: "MA", description: "d", type: "switch_board", categoryId: 1, price: D("100.00"), imageUrl: "u", moduleSize: "2M", isActive: true, isMatrix: true, matrixDimensions: [{ key: "series", label: "Series", options: ["remote", "wifi"] }, { key: "finish", label: "Finish", options: ["acrylic", "glass"] }], sortOrder: 1 },
    { _id: 9002, name: "Legacy config only", code: null, description: null, type: "accessory", categoryId: 1, price: D("5.00"), isActive: true, isMatrix: false, matrixDimensions: null, sortOrder: 2 },
    { _id: 9003, name: "Untiered", type: "other", categoryId: null, isActive: true, isMatrix: false, matrixDimensions: null, sortOrder: 3 },
    { _id: 9004, name: "Flat, no variants", type: "vdp", categoryId: 2, price: D("2499"), isActive: true, isMatrix: false, matrixDimensions: null, sortOrder: 4 },
    { _id: 9005, name: "Dangling category", type: "curtain", categoryId: 99, isActive: true, isMatrix: false, matrixDimensions: null, automationTier: " wifi ", surfaceFinish: "glass", sortOrder: 5 },
    { _id: 9006, name: "Stored names", type: "smart_lock", categoryId: 2, isActive: true, isMatrix: false, matrixDimensions: null, sortOrder: 6 },
  ];
  const rawVariants = [
    { _id: 1, productId: 9001, automationTier: "remote", surfaceFinish: "acrylic", price: D("118.00"), priceWithoutTax: D("100.00"), taxPercent: D("18.00"), isActive: true },
    { _id: 2, productId: 9001, automationTier: "wifi", surfaceFinish: "glass", price: D("999.00"), priceWithoutTax: D("847.46"), taxPercent: D("18.00"), isActive: true },
    { _id: 3, productId: 9001, automationTier: "wifi", surfaceFinish: "acrylic", price: D("236.00"), isActive: true },
    { _id: 4, productId: 9002, automationTier: null, surfaceFinish: null, config: { series: "zigbee", finish: "glass", other: "x" }, price: D("59.00"), priceWithoutTax: D("50.00"), taxPercent: D("18.00"), isActive: true },
    { _id: 5, productId: 9003, price: D("10.00"), priceWithoutTax: D("8.47"), taxPercent: D("18.00"), isActive: true },
    { _id: 6, productId: 9006, name: "Custom label", code: "SKU-1", variantCode: "VC-1", automationTier: "remote", surfaceFinish: null, price: D("1.00"), priceWithoutTax: D("1.00"), taxPercent: D("0.00"), isActive: true },
    { _id: 7, productId: 9006, name: "  ", code: "", variantCode: "VC-2", automationTier: "", surfaceFinish: "glass", price: D("2.00"), priceWithoutTax: D("2.00"), taxPercent: D("5.00"), isActive: true },
    { _id: 8, productId: 777, automationTier: "remote", price: D("1.00"), isActive: true }, // variant of a product that is not in the catalog
  ];
  const rawCategories = [{ _id: 1, name: "Tactus" }, { _id: 2, name: "Accessories" }];
  const asStrings = <T extends Record<string, unknown>>(doc: T) =>
    Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, v instanceof mongoose.Types.Decimal128 ? v.toString() : v]));
  const legacyEdge = normalizeProducts(
    rawProducts.map((p) => ({
      ...asStrings(p),
      category: rawCategories.find((c) => c._id === p.categoryId) ?? null,
      variants: rawVariants.filter((v) => v.productId === p._id).map(asStrings),
    }))
  ) as FullProduct[];
  const nextEdge = buildEditorCatalog({
    products: rawProducts,
    variants: rawVariants as unknown as Parameters<typeof buildEditorCatalog>[0]["variants"],
    categories: rawCategories,
  });
  compareCatalogs("edge", legacyEdge, nextEdge);
  same("edge: orphan variant is not attached to any product", nextEdge.reduce((n, p) => n + (p.variants?.length ?? 0), 0), 7);
  same("edge: dangling category => no category object", nextEdge.find((p) => p.id === 9005)?.category ?? null, null);
  same("edge: empty code/variantCode omitted", Object.keys(nextEdge.find((p) => p.id === 9006)?.variants?.[1] ?? {}).sort(), ["automationTier", "id", "isActive", "name", "price", "surfaceFinish", "variantCode"]);
  console.log("edge cases compared");

  const ids = (nextEdge.find((p) => p.id === 9001)?.variants ?? []).map((v: EditorCatalogVariant) => v as ProductVariant).map((v) => v.id);
  same("edge: matrix variant order preserved", ids, [1, 2, 3]);

  // ---- negative control: the comparator must notice a corrupted catalog ----
  const corrupted: EditorCatalogProduct[] = next.map((p, i) =>
    i === 0 && p.variants?.[0]
      ? { ...p, category: undefined, variants: [{ ...p.variants[0], price: "0.00" }, ...p.variants.slice(1)] }
      : p
  );
  const before = mismatches.length;
  compareCatalogs("negative-control", legacyDealer, corrupted);
  const detected = mismatches.length - before;
  mismatches.length = before;
  if (detected < 2) note(`negative control failed: only ${detected} difference(s) detected in a deliberately corrupted catalog`);
  else console.log(`negative control: comparator caught ${detected} difference(s) in a deliberately corrupted catalog`);

  console.log(`\n${comparisons} comparisons`);
  if (mismatches.length > 0) {
    console.log(`PARITY FAILED: ${mismatches.length} mismatch(es):`);
    for (const m of mismatches) console.log("  - " + m);
    process.exit(1);
  }
  console.log("PARITY OK: 0 mismatches.");
  process.exit(0);
}

main().catch((error) => {
  console.error("verify-editor-catalog failed:", error);
  process.exit(1);
});
