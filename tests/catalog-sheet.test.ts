/**
 * Catalogue Excel rules (pure): reading the table, checking each cell, grouping rows into products, and what an import would
 * do to the catalogue as it is (create / update / unchanged / error), all-or-nothing per product.
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/catalog-sheet.test.ts
 */
import assert from "node:assert/strict";
import { COLUMNS, checkRow, exportTable, parseMoney, planImport, readTable, type ExistingProduct, type ParsedRow, type RowIssue, type SheetContext } from "../src/lib/catalogSheet";
import { resolveVariantPricing } from "../src/lib/pricing";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const context: SheetContext = {
  categories: [
    { id: 1, name: "Curtains", isActive: true, hasMatrix: false },
    { id: 2, name: "Tactus", isActive: true, hasMatrix: true },
    { id: 3, name: "Old", isActive: false, hasMatrix: false },
    { id: 4, name: "Twin", isActive: true, hasMatrix: false },
    { id: 5, name: "twin", isActive: true, hasMatrix: false },
  ],
  gstRates: [0, 5, 18, 40],
  hsnCodes: ["8536", "9403"],
};
const H = COLUMNS.map((c) => c.header);
const table = (...rows: Array<Record<string, string | number>>) => [H, ...rows.map((row) => H.map((h) => row[h] ?? ""))];

// ── reading ──
const read = readTable(table({ "Product Code": "CM-1", "Variant Code": "V1", "Price (incl. GST)": "1,180" }));
assert.deepEqual(read.fileErrors, []);
assert.deepEqual(read.rows.map((r) => [r.row, r.cells]), [[2, { productCode: "CM-1", variantCode: "V1", price: "1,180" }]], "blank cells are absent; the first data row is row 2");
assert.equal(readTable([["product code", "VARIANT   CODE", "Colour"], ["a", "b", "x"]]).ignoredColumns[0], "Colour", "headers match loosely; unknown columns are ignored and reported");
assert.deepEqual(readTable([["product code", "VARIANT   CODE"], ["a", "b"]]).fileErrors, []);
assert.ok(readTable([]).fileErrors[0].includes("empty"));
assert.ok(readTable([["Product Name", "Price (incl. GST)"], ["x", "1"]]).fileErrors.some((e) => e.includes('"Product Code" is missing')));
assert.ok(readTable([["Product Code", "Product Code", "Variant Code"], ["a", "b", "c"]]).fileErrors.some((e) => e.includes("more than once")));
assert.ok(readTable([H]).fileErrors.some((e) => e.includes("no data rows")));
assert.equal(readTable([H, ["", "", ""], H.map(() => "")]).rows.length, 0, "blank rows are skipped");
pass("the table is read by header name (loosely), blank rows skipped, missing / repeated / unknown columns reported");

// ── cells ──
assert.deepEqual([parseMoney("1180"), parseMoney("₹1,180.50"), parseMoney("Rs. 99"), parseMoney("0"), parseMoney("12.345"), parseMoney("-5"), parseMoney("abc"), parseMoney("1e3"), parseMoney("")], [1180, 1180.5, 99, 0, null, null, null, null, null]);
const check = (cells: Record<string, string>, row = 2) => checkRow({ row, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v])) as never }, context);
const ok = check({ productCode: "CM-1", variantCode: "V1", productName: "Motor", category: " curtains ", type: "Smart Lock", gstRate: "18%", productActive: "yes", variantActive: "No", price: "₹1,180", cost: "900", hsnCode: "8536" });
assert.deepEqual(ok.issues, []);
assert.deepEqual([ok.parsed?.categoryId, ok.parsed?.type, ok.parsed?.gstRate, ok.parsed?.productActive, ok.parsed?.variantActive, ok.parsed?.price, ok.parsed?.cost, ok.parsed?.hsnCode], [1, "smart_lock", 18, true, false, 1180, 900, "8536"]);
for (const [cells, column, fragment] of [
  [{ variantCode: "V1" }, "Product Code", "required"],
  [{ productCode: "A" }, "Variant Code", "required"],
  [{ productCode: "A", variantCode: "bad;code" }, "Variant Code", "Use letters"],
  [{ productCode: "A", variantCode: "V", category: "Nope" }, "Category", "no category"],
  [{ productCode: "A", variantCode: "V", category: "Twin" }, "Category", "More than one"],
  [{ productCode: "A", variantCode: "V", category: "Old" }, "Category", "inactive"],
  [{ productCode: "A", variantCode: "V", type: "gadget" }, "Type", "must be one of"],
  [{ productCode: "A", variantCode: "V", hsnCode: "0000" }, "HSN/SAC", "not in your"],
  [{ productCode: "A", variantCode: "V", gstRate: "12" }, "GST %", "allowed rates"],
  [{ productCode: "A", variantCode: "V", productActive: "maybe" }, "Product Active", "Yes or No"],
  [{ productCode: "A", variantCode: "V", price: "12.345" }, "Price (incl. GST)", "two decimals"],
  [{ productCode: "A", variantCode: "V", cost: "-1" }, "Cost", "two decimals"],
  [{ productCode: "A", variantCode: "V", productName: "x".repeat(201) }, "Product Name", "Too long"],
] as const) {
  const result = check(cells as Record<string, string>);
  assert.ok(result.issues.some((i) => i.column === column && i.message.includes(fragment)), `${column}: ${fragment} -> ${JSON.stringify(result.issues)}`);
  assert.equal(result.parsed, null, "a row with a problem is not used");
  assert.ok(result.issues.every((i) => i.row === 2));
}
pass("each cell is checked (category by name and active, type, HSN/GST against the company's lists, Yes/No, money to two decimals, lengths) with a plain message");

// ── planning ──
const existing: ExistingProduct[] = [
  {
    id: 10, code: "CM-1", name: "Curtain Motor", categoryId: 1, type: "curtain", unit: "pcs", description: "Quiet", moduleSize: null, notes: null, hsnCode: "8536", gstRate: 18, isActive: true,
    variants: [
      { id: 100, variantCode: "V1", name: "Standard", price: 1180, cost: 900, taxPercent: 18, isActive: true, tier: null, finish: null },
      { id: 101, variantCode: "V2", name: "Long", price: 2360, cost: 1800, taxPercent: 18, isActive: true, tier: null, finish: null },
    ],
  },
  {
    id: 20, code: "TS-1", name: "Tactus Switch", categoryId: 2, type: "switch_board", unit: "pcs", description: null, moduleSize: "4M", notes: null, hsnCode: null, gstRate: null, isActive: true,
    variants: [{ id: 200, variantCode: "T1", name: "Wifi Black", price: 999, cost: 0, taxPercent: 18, isActive: true, tier: "wifi", finish: "black" }],
  },
];
const parse = (...cells: Array<Record<string, string>>): { rows: ParsedRow[]; issues: RowIssue[] } => {
  const rows: ParsedRow[] = [];
  const issues: RowIssue[] = [];
  cells.forEach((cell, i) => {
    const r = checkRow({ row: i + 2, cells: cell as never }, context);
    if (r.parsed) rows.push(r.parsed);
    issues.push(...r.issues);
  });
  return { rows, issues };
};
const plan = (...cells: Array<Record<string, string>>) => {
  const { rows, issues } = parse(...cells);
  return planImport(rows, existing, context, issues, cells.length);
};

// unchanged
const unchanged = plan({ productCode: "CM-1", variantCode: "V1", productName: "Curtain Motor", price: "1180", cost: "900" }, { productCode: "cm-1", variantCode: "v2", price: "2360" });
assert.deepEqual(unchanged.summary, { rows: 2, productsToCreate: 0, productsToUpdate: 0, variantsToCreate: 0, variantsToUpdate: 0, unchanged: 2, priceChanges: 0, errors: 0 }, "the same data changes nothing; codes match regardless of case");
// a blank cell leaves things alone
const blank = plan({ productCode: "CM-1", variantCode: "V1" });
assert.equal(blank.summary.unchanged, 1, "blank cells never clear anything");

// updates
const upd = plan({ productCode: "CM-1", variantCode: "V1", productName: "Curtain Motor Pro", price: "1299", cost: "950", variantName: "Std", variantActive: "No", unit: "set" });
assert.equal(upd.issues.length, 0);
const p = upd.products[0];
assert.deepEqual([p.action, p.productId, p.set], ["update", 10, { name: "Curtain Motor Pro", unit: "set" }]);
assert.deepEqual(p.variants[0].set, { name: "Std", cost: 950, isActive: false });
assert.deepEqual([p.variants[0].price?.before, p.variants[0].price?.after, p.variants[0].price?.taxPercent], [1180, 1299, 18]);
assert.ok(p.variants[0].changes.some((c) => c.includes("price 1180 → 1299")));
assert.deepEqual([upd.summary.productsToUpdate, upd.summary.variantsToUpdate, upd.summary.priceChanges], [1, 1, 1]);
pass("matching by product and variant code (case-insensitive); only the cells that differ become changes; blank cells change nothing");

// a GST rate change re-splits every variant (prices kept)
const rate = plan({ productCode: "CM-1", variantCode: "V1", gstRate: "5" });
assert.equal(rate.issues.length, 0);
assert.equal(rate.products[0].gstRateChanges, true);
assert.deepEqual(rate.products[0].variants.map((v) => [v.action, v.price?.after, v.price?.taxPercent]), [["update", 1180, 5]], "the price stays; only the split moves");
for (const v of rate.products[0].variants) assert.equal(resolveVariantPricing({ price: v.price?.after, priceWithoutTax: v.price?.priceWithoutTax ?? undefined, taxPercent: v.price?.taxPercent }).price, v.price?.after);
pass("a new GST rate keeps the price and re-splits it exactly");

// creates
const created = plan(
  { productCode: "NEW-1", variantCode: "A", productName: "Blind", category: "Curtains", price: "500", gstRate: "18", type: "curtain" },
  { productCode: "NEW-1", variantCode: "B", price: "700", variantName: "Wide" },
  { productCode: "CM-1", variantCode: "V3", price: "3000" }
);
assert.deepEqual(created.issues, []);
assert.deepEqual(created.summary, { rows: 3, productsToCreate: 1, productsToUpdate: 1, variantsToCreate: 3, variantsToUpdate: 0, unchanged: 0, priceChanges: 0, errors: 0 });
const blind = created.products.find((x) => x.code === "NEW-1");
assert.deepEqual([blind?.create?.name, blind?.create?.categoryId, blind?.create?.unit, blind?.create?.type, blind?.create?.gstRate], ["Blind", 1, "pcs", "curtain", 18], "defaults: unit pcs");
assert.deepEqual(blind?.variants.map((v) => [v.variantCode, v.create?.name, v.price?.after, v.price?.taxPercent]), [["A", "Standard", 500, 18], ["B", "Wide", 700, 18]]);
assert.equal(created.products.find((x) => x.code === "CM-1")?.variants[0].action, "create", "a new variant can be added to an existing flat product");
pass("new products and new variants are created (defaults filled), in categories without tier/finish combinations");

// errors: all or nothing per product
const bad = plan(
  { productCode: "NEW-2", variantCode: "A", productName: "Good", category: "Curtains", price: "100" },
  { productCode: "NEW-2", variantCode: "B", price: "oops" },
  { productCode: "CM-1", variantCode: "V1", price: "1500" }
);
assert.equal(bad.products.length, 1, "the product with a bad row is held back entirely");
assert.equal(bad.products[0].code, "CM-1");
assert.deepEqual(bad.failedProducts, ["NEW-2"]);
assert.deepEqual(bad.issues.map((i) => [i.row, i.column]), [[3, "Price (incl. GST)"]]);
assert.equal(bad.summary.errors, 1);
const dup = plan({ productCode: "CM-1", variantCode: "V1", price: "1" }, { productCode: "CM-1", variantCode: "v1", price: "2" });
assert.deepEqual([dup.products.length, dup.failedProducts, dup.issues[0]?.row], [0, ["CM-1"], 3], "a variant listed twice holds back its product");
assert.ok(dup.issues[0].message.includes("row 2"));
const conflict = plan({ productCode: "CM-1", variantCode: "V1", productName: "A" }, { productCode: "CM-1", variantCode: "V2", productName: "B" });
assert.ok(conflict.issues[0].message.includes("Differs from another row") && conflict.failedProducts.includes("CM-1"));
const newBad = plan({ productCode: "N", variantCode: "A", price: "5" });
assert.deepEqual(newBad.issues.map((i) => i.column).sort(), ["Category", "Product Name"], "a new product needs a name and a category");
assert.ok(plan({ productCode: "N", variantCode: "A", productName: "x", category: "Curtains" }).issues.some((i) => i.column === "Price (incl. GST)"), "and a new variant needs a price");
pass("one bad row holds back its whole product (and only that product); duplicates, conflicting product details and missing required values are reported with row and column");

// matrix categories and protected fields
const matrixNew = plan({ productCode: "N2", variantCode: "A", productName: "x", category: "Tactus", price: "100" });
assert.ok(matrixNew.issues[0].message.includes("created in the catalogue first"));
const matrixVariant = plan({ productCode: "TS-1", variantCode: "T9", price: "100" });
assert.ok(matrixVariant.issues[0].message.includes("Edit Variants"));
const tier = plan({ productCode: "TS-1", variantCode: "T1", tier: "zigbee" });
assert.ok(tier.issues[0].message.includes("cannot be changed by import"));
assert.equal(plan({ productCode: "TS-1", variantCode: "T1", tier: "wifi", finish: "black", price: "1099" }).issues.length, 0, "stating the same tier and finish is fine");
assert.equal(plan({ productCode: "TS-1", variantCode: "T1", price: "1099" }).products[0].variants[0].price?.after, 1099, "prices of matrix products can be updated");
assert.ok(plan({ productCode: "CM-1", variantCode: "V1", category: "Tactus" }).issues[0].message.includes("done in the catalogue"), "moving a product into a matrix category is refused");
pass("products in categories with tier/finish combinations can be updated (prices, names) but not created or given new variants, and an existing variant's tier/finish is never changed");

// an unreadable price cannot be kept
const noPrice = planImport([{ row: 2, productCode: "CM-1", variantCode: "V1", gstRate: 5 }], [{ ...existing[0], variants: [{ ...existing[0].variants[0], price: null }] }], context);
assert.ok(noPrice.issues[0].message.includes("no readable price"));
pass("a variant with no readable price cannot be re-split and is reported");

// ── export ──
const exported = exportTable(
  [{ code: "CM-1", name: "Curtain Motor", categoryName: "Curtains", type: "curtain", unit: "pcs", description: null, moduleSize: null, notes: null, hsnCode: "8536", gstRate: 18, isActive: true, variants: [{ variantCode: "V1", name: "Standard", tier: null, finish: null, price: 1180, cost: 900, isActive: false }] }],
  { includeCost: true }
);
assert.deepEqual(exported[0], H);
assert.deepEqual(exported[1].slice(0, 3), ["CM-1", "Curtain Motor", "Curtains"]);
assert.deepEqual([exported[1][H.indexOf("Price (incl. GST)")], exported[1][H.indexOf("Cost")], exported[1][H.indexOf("Variant Active")], exported[1][H.indexOf("Product Active")]], [1180, 900, "No", "Yes"]);
const noCost = exportTable([{ code: "A", name: "n", categoryName: null, type: "other", unit: "pcs", description: null, moduleSize: null, notes: null, hsnCode: null, gstRate: null, isActive: true, variants: [{ variantCode: "V", name: null, tier: null, finish: null, price: 1, cost: 5, isActive: true }] }], { includeCost: false });
assert.ok(!noCost[0].includes("Cost") && !noCost[1].includes(5), "costs are left out for people who may not see them");
// a round trip: what is exported reads back as no change
const reread = readTable(exported as unknown[][]);
const back = reread.rows.map((r) => checkRow(r, context).parsed).filter((x): x is ParsedRow => x !== null);
assert.equal(planImport(back, existing, context, [], reread.rows.length).summary.errors, 0);
assert.equal(planImport(back, existing, context).summary.variantsToUpdate, 1, "only the variant the sheet changed (it said Variant Active = No) would update");
pass("export is one row per variant in the import's own columns; costs are left out when not allowed; an exported sheet reads back cleanly");

console.log(`\nALL ${count} CATALOGUE SHEET TESTS PASSED!`);
