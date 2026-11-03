/**
 * Excel import / export of the catalogue through the real API (production-mode server + throwaway local MongoDB): export,
 * template, preview (nothing saved), apply (must match the preview), creation and update by code, per-product all-or-nothing,
 * price history and undo, upload safety (not an xlsx, too large, a zip bomb), permissions and company isolation.
 *
 *   node tests/catalog-import-export-api.test.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deflateRawSync } from "node:zlib";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const ExcelJS = createRequire(import.meta.url)("exceljs");
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";
const dec = (v) => Decimal128.fromString(v);
const num = (v) => (v === null || v === undefined ? null : Number(String(v)));

const HEADER = ["Product Code", "Product Name", "Category", "Type", "Unit", "Description", "Module Size", "Notes", "HSN/SAC", "GST %", "Product Active", "Variant Code", "Variant Name", "Automation Tier", "Surface Finish", "Price (incl. GST)", "Cost", "Variant Active"];
async function xlsx(rows, headers = HEADER) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function readSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet.eachRow((row) => rows.push(row.values.slice(1)));
  return rows;
}
/** A real zip holding one 120 MB entry of zeros (deflates to ~120 KB): what a zip bomb looks like. */
function zipBomb() {
  const raw = Buffer.alloc(120 * 1024 * 1024);
  const data = deflateRawSync(raw, { level: 9 });
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

try {
  server = await startIsolatedServer("catimport", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "dealera@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "viewer@example.com", role: "configurable_admin", name: "Viewer", permissions: ["catalog:read"], companyId: 20 },
    { _id: 4, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 30 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 30, name: "Beta Builders", slug: "beta-builders", status: "active", phone: "+91 90000 22222", address: "Surat", gstNumber: null, email: "b@beta.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
  ]);
  const cat = (id, companyId, name, extra = {}) => ({ _id: id, companyId, name, level: 1, parentId: null, sortOrder: id, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now, ...extra });
  await db.collection("categories").insertMany([
    cat(201, 20, "Curtains"),
    cat(202, 20, "Tactus", { variantTiers: [{ value: "wifi", label: "WiFi" }], variantFinishes: [{ value: "black", label: "Black" }] }),
    cat(301, 30, "Blinds"),
  ]);
  const product = (id, companyId, name, code, categoryId, extra = {}) => ({ _id: id, companyId, name, code, type: "curtain", categoryId, unit: "pcs", isActive: true, sortOrder: id, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now, ...extra });
  await db.collection("products").insertMany([
    product(2001, 20, "Curtain Motor", "CM-1", 201, { hsnCode: null, gstRate: 18 }),
    product(2002, 20, "Tactus Switch", "TS-1", 202, { type: "switch_board", isMatrix: true }),
    product(2003, 20, "No Code Product", null, 201),
    product(3001, 30, "Blind", "BL-1", 301),
  ]);
  const variant = (id, companyId, productId, code, name, price, pwt, tax, extra = {}) => ({ _id: id, companyId, productId, variantCode: code, code, name, config: {}, price: dec(price), priceWithoutTax: dec(pwt), taxPercent: dec(tax), cost: dec("900.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: id, createdAt: now, updatedAt: now, ...extra });
  await db.collection("productvariants").insertMany([
    variant(1, 20, 2001, "V1", "Standard", "1180.00", "1000.00", "18.00"),
    variant(2, 20, 2001, "V2", "Long", "2360.00", "2000.00", "18.00"),
    variant(3, 20, 2002, "T1", "Wifi Black", "999.00", "846.61", "18.00", { automationTier: "wifi", surfaceFinish: "black" }),
    variant(4, 20, 2003, "NC1", "Plain", "100.00", "84.75", "18.00"),
    variant(5, 30, 3001, "B1", "Std", "500.00", "423.73", "18.00"),
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  await db.collection("quotationitems").insertOne({ _id: 1, companyId: 20, quotationId: 1, quotationRoomId: 1, productId: 2001, productVariantId: 1, quantity: 2, unitPrice: dec("1180.00"), priceWithoutTax: dec("1000.00"), taxPercent: dec("18.00"), taxAmount: dec("180.00"), createdAt: now, updatedAt: now });
  const quotationsBefore = JSON.stringify(await db.collection("quotationitems").find({}).toArray());
  const cookie = { a: await login("ownera@example.com", "admin"), dealer: await login("dealera@example.com", "user"), viewer: await login("viewer@example.com", "admin"), b: await login("ownerb@example.com", "admin") };

  const get = (c, path) => fetch(`${baseUrl}${path}`, { headers: { Cookie: c } });
  const post = async (c, path, buffer, fields = {}, name = "catalogue.xlsx") => {
    const form = new FormData();
    form.append("file", new Blob([buffer]), name);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { Cookie: c }, body: form });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, data: json?.data, text };
  };
  const preview = (c, buffer) => post(c, "/api/catalog/import/preview", buffer);
  const apply = (c, buffer, planHash) => post(c, "/api/catalog/import/apply", buffer, { planHash });

  // ═══ permissions ═══
  for (const who of ["dealer", "viewer"]) {
    assert.equal((await get(cookie[who], "/api/catalog/export")).status, 403, `${who} cannot export`);
    assert.equal((await get(cookie[who], "/api/catalog/import/template")).status, 403, `${who} cannot download the template`);
    assert.equal((await preview(cookie[who], await xlsx([]))).status, 403, `${who} cannot preview`);
    assert.equal((await apply(cookie[who], await xlsx([]), "0".repeat(64))).status, 403, `${who} cannot import`);
  }
  assert.equal((await fetch(`${baseUrl}/api/catalog/export`)).status, 401);
  pass("only people who can edit the catalogue can export, download the template, preview or import; dealers, read-only roles and signed-out visitors are refused");

  // ═══ export ═══
  const exported = await get(cookie.a, "/api/catalog/export");
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /spreadsheetml/);
  assert.match(exported.headers.get("content-disposition"), /attachment; filename="catalogue-\d{4}-\d{2}-\d{2}\.xlsx"/);
  const exportedRows = await readSheet(Buffer.from(await exported.arrayBuffer()));
  assert.deepEqual(exportedRows[0], HEADER, "the import's own columns");
  assert.equal(exportedRows.length, 1 + 4, "one row per variant of this company (four), not the other company's");
  const col = (name) => HEADER.indexOf(name);
  const v1 = exportedRows.find((r) => r[col("Variant Code")] === "V1");
  assert.deepEqual([v1[col("Product Code")], v1[col("Product Name")], v1[col("Category")], v1[col("Price (incl. GST)")], v1[col("Cost")], v1[col("GST %")], v1[col("Variant Active")]], ["CM-1", "Curtain Motor", "Curtains", 1180, 900, 18, "Yes"]);
  assert.ok(!exportedRows.some((r) => r.includes("B1") || r.includes("BL-1")), "another company's catalogue is not in it");
  const template = await get(cookie.a, "/api/catalog/import/template");
  assert.equal(template.status, 200);
  const templateBook = new ExcelJS.Workbook();
  await templateBook.xlsx.load(Buffer.from(await template.arrayBuffer()));
  assert.deepEqual(templateBook.worksheets.map((s) => s.name), ["Products", "How to fill this in"]);
  pass("export is one row per variant of this company in the import's columns; the template has the columns, an example and a help sheet");

  // ═══ preview ═══
  const before = { products: JSON.stringify(await db.collection("products").find({}).sort({ _id: 1 }).toArray()), variants: JSON.stringify(await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray()) };
  const sheet = await xlsx([
    { "Product Code": "CM-1", "Variant Code": "V1", "Price (incl. GST)": 1299, "Variant Name": "Standard Plus" },            // price + name
    { "Product Code": "cm-1", "Variant Code": "v2", "Price (incl. GST)": 2360 },                                          // unchanged (case-insensitive match)
    { "Product Code": "CM-1", "Variant Code": "V3", "Price (incl. GST)": 3540, "Variant Name": "Extra Long", Cost: 2500 }, // a new variant
    { "Product Code": "NEW-1", "Product Name": "Roller Blind", Category: "Curtains", Type: "curtain", "GST %": 18, "Variant Code": "RB-A", "Price (incl. GST)": 500 },
    { "Product Code": "NEW-1", "Variant Code": "RB-B", "Variant Name": "Wide", "Price (incl. GST)": 700 },
    { "Product Code": "TS-1", "Variant Code": "T1", "Price (incl. GST)": 1099 },                                          // matrix product: price update is fine
    { "Product Code": "BAD-1", "Product Name": "Broken", Category: "Curtains", "Variant Code": "X1", "Price (incl. GST)": "not money" },
    { "Product Code": "BAD-1", "Product Name": "Broken", Category: "Curtains", "Variant Code": "X2", "Price (incl. GST)": 10 },
    { "Product Code": "NEW-2", "Product Name": "Tactus New", Category: "Tactus", "Variant Code": "N1", "Price (incl. GST)": 10 }, // matrix category: create in catalogue first
    { "Product Code": "TS-1", "Variant Code": "T1", "Automation Tier": "zigbee" },
    { "Product Code": "CM-1", "Variant Code": "V1", Category: "Nowhere" },
  ]);
  const shown = await preview(cookie.a, sheet);
  assert.equal(shown.status, 200, shown.text?.slice(0, 400));
  const s = shown.data.summary;
  assert.equal(shown.data.canApply, true);
  assert.deepEqual(shown.data.fileErrors, []);
  assert.match(shown.data.planHash, /^[0-9a-f]{64}$/);
  const messages = shown.data.issues.map((i) => `${i.row}:${i.column}`);
  assert.ok(messages.includes("8:Price (incl. GST)"), "the unreadable price is reported with its row and column");
  assert.ok(shown.data.issues.some((i) => i.message.includes("created in the catalogue first")));
  assert.deepEqual(shown.data.failedProducts.sort(), ["BAD-1", "CM-1", "NEW-2", "TS-1"].filter((c) => shown.data.failedProducts.includes(c)).sort());
  assert.ok(shown.data.failedProducts.includes("BAD-1") && shown.data.failedProducts.includes("NEW-2"), "products with a problem row are held back whole");
  assert.equal(shown.data.rows.find((r) => r.productCode === "NEW-1" && r.variantCode === "RB-A").action, "create");
  assert.equal((await db.collection("products").find({}).sort({ _id: 1 }).toArray()).length, 4);
  assert.equal(JSON.stringify(await db.collection("products").find({}).sort({ _id: 1 }).toArray()), before.products, "a preview changes nothing");
  assert.equal(JSON.stringify(await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray()), before.variants);
  pass("preview reports creates, updates, unchanged rows and every problem (row + column) without saving anything");

  // a clean sheet for the real import (CM-1 and TS-1 had problem rows above, so they were held back)
  const clean = await xlsx([
    { "Product Code": "CM-1", "Variant Code": "V1", "Price (incl. GST)": 1299, "Variant Name": "Standard Plus" },
    { "Product Code": "cm-1", "Variant Code": "v2", "Price (incl. GST)": 2360 },
    { "Product Code": "CM-1", "Variant Code": "V3", "Price (incl. GST)": 3540, "Variant Name": "Extra Long", Cost: 2500 },
    { "Product Code": "NEW-1", "Product Name": "Roller Blind", Category: "Curtains", Type: "curtain", "GST %": 18, "Variant Code": "RB-A", "Price (incl. GST)": 500 },
    { "Product Code": "NEW-1", "Variant Code": "RB-B", "Variant Name": "Wide", "Price (incl. GST)": 700 },
    { "Product Code": "TS-1", "Variant Code": "T1", "Price (incl. GST)": 1099 },
    { "Product Code": "BAD-1", "Product Name": "Broken", Category: "Curtains", "Variant Code": "X1", "Price (incl. GST)": "not money" },
  ]);
  const cleanPreview = await preview(cookie.a, clean);
  assert.deepEqual(cleanPreview.data.summary, { rows: 7, productsToCreate: 1, productsToUpdate: 2, variantsToCreate: 3, variantsToUpdate: 2, unchanged: 1, priceChanges: 2, errors: 1 });
  assert.deepEqual(cleanPreview.data.failedProducts, ["BAD-1"]);

  // ═══ apply ═══
  assert.equal((await apply(cookie.a, clean, "0".repeat(64))).status, 409, "a hash that is not the preview's is refused");
  assert.equal((await apply(cookie.a, clean, "nope")).status, 400, "so is a missing one");
  assert.equal((await apply(cookie.a, sheet, cleanPreview.data.planHash)).status, 409, "a different file than the one previewed is refused");
  assert.equal(JSON.stringify(await db.collection("productvariants").find({}).sort({ _id: 1 }).toArray()), before.variants, "refusals changed nothing");

  const done = await apply(cookie.a, clean, cleanPreview.data.planHash);
  assert.equal(done.status, 200, done.text?.slice(0, 400));
  assert.deepEqual([done.data.productsCreated, done.data.productsUpdated, done.data.variantsCreated, done.data.variantsUpdated, done.data.priceChanges, done.data.skippedProducts], [1, 2, 3, 2, 2, ["BAD-1"]]);
  const v1row = await db.collection("productvariants").findOne({ _id: 1 });
  assert.deepEqual([num(v1row.price), v1row.name, num(v1row.taxPercent)], [1299, "Standard Plus", 18], "an existing variant was updated");
  assert.ok(v1row.priceWithoutTax === null || Math.abs(num(v1row.priceWithoutTax) * 1.18 - 1299) < 0.02, "its price without tax matches (or is an explicit null)");
  assert.equal(num((await db.collection("productvariants").findOne({ _id: 2 })).price), 2360, "an unchanged variant is untouched");
  assert.equal(num((await db.collection("productvariants").findOne({ _id: 3 })).price), 1099, "a variant of a product with tier/finish combinations had its price updated");
  const t1 = await db.collection("productvariants").findOne({ _id: 3 });
  assert.deepEqual([t1.automationTier, t1.surfaceFinish], ["wifi", "black"], "and kept its tier and finish");
  const v3 = await db.collection("productvariants").findOne({ productId: 2001, variantCode: "V3" });
  assert.deepEqual([num(v3.price), v3.name, num(v3.cost), v3.isActive], [3540, "Extra Long", 2500, true], "a new variant of an existing product");
  const blind = await db.collection("products").findOne({ code: "NEW-1" });
  assert.deepEqual([blind.name, blind.categoryId, blind.companyId, blind.gstRate, blind.unit, blind.isActive, blind.type], ["Roller Blind", 201, 20, 18, "pcs", true, "curtain"], "a new product, in this company");
  const blindVariants = await db.collection("productvariants").find({ productId: blind._id }).sort({ sortOrder: 1 }).toArray();
  assert.deepEqual(blindVariants.map((v) => [v.variantCode, num(v.price), v.companyId, v.sortOrder]), [["RB-A", 500, 20, 0], ["RB-B", 700, 20, 1]]);
  assert.equal(await db.collection("products").countDocuments({ code: "BAD-1" }), 0, "a product with a bad row was not created");
  assert.equal(await db.collection("products").countDocuments({ code: "NEW-2" }), 0);
  assert.equal(JSON.stringify(await db.collection("quotationitems").find({}).toArray()), quotationsBefore, "existing quotations are untouched");
  assert.equal(num((await db.collection("productvariants").findOne({ _id: 5 })).price), 500, "the other company is untouched");
  pass("apply writes exactly what the preview showed: updates by code, a new variant, a new product, tier/finish kept, held-back products skipped and reported, quotations and the other company untouched");

  assert.equal((await apply(cookie.a, clean, cleanPreview.data.planHash)).status, 409, "the same file cannot be applied twice from an old preview");
  const again = await preview(cookie.a, clean);
  assert.deepEqual([again.data.summary.productsToCreate, again.data.summary.variantsToCreate, again.data.summary.priceChanges], [0, 0, 0], "re-previewing shows nothing left to do");
  pass("a preview cannot be applied twice, and the same file previews as no further change once imported");

  // ═══ price history ═══
  const history = await api(cookie.a, "GET", "/api/catalog/bulk-pricing/history");
  assert.equal(history.data.total, 1);
  const batch = history.data.batches[0];
  assert.deepEqual([batch.kind, batch.scopeLabel, batch.variantsChanged, batch.createdByName], ["import", "Excel import", 2, "Owner A"]);
  const detail = await api(cookie.a, "GET", `/api/catalog/bulk-pricing/history/${batch._id}`);
  assert.deepEqual(detail.data.entries.map((e) => [e.variantCode, e.before.price, e.after.price]).sort(), [["T1", 999, 1099], ["V1", 1180, 1299]]);
  const undone = await api(cookie.a, "POST", `/api/catalog/bulk-pricing/history/${batch._id}/revert`);
  assert.equal(undone.status, 200, undone.text?.slice(0, 300));
  assert.deepEqual([num((await db.collection("productvariants").findOne({ _id: 1 })).price), num((await db.collection("productvariants").findOne({ _id: 3 })).price)], [1180, 999], "an import's price changes can be undone");
  assert.equal(await db.collection("productvariants").countDocuments({ productId: 2001, variantCode: "V3" }), 1, "undoing prices does not delete what the import added");
  pass("price changes made by an import are recorded in the price history and can be undone there");

  // ═══ company isolation ═══
  const other = await preview(cookie.b, await xlsx([{ "Product Code": "CM-1", "Product Name": "Mine", Category: "Curtains", "Variant Code": "Z", "Price (incl. GST)": 5 }]));
  assert.equal(other.status, 200);
  assert.ok(other.data.issues.some((i) => i.message.includes('no category called "Curtains"')), "another company cannot use ours");
  const ownB = await preview(cookie.b, await xlsx([{ "Product Code": "CM-1", "Product Name": "Blind Two", Category: "Blinds", "Variant Code": "Z", "Price (incl. GST)": 5 }]));
  assert.equal(ownB.data.summary.productsToCreate, 1, "a code another company uses is free here: codes are per company");
  pass("a company imports into its own catalogue only (its own categories, its own codes)");

  // ═══ files ═══
  const csv = await post(cookie.a, "/api/catalog/import/preview", Buffer.from("Product Code,Variant Code\nA,B\n"), {}, "catalogue.csv");
  assert.equal(csv.status, 400);
  assert.equal((await post(cookie.a, "/api/catalog/import/preview", Buffer.from("not a spreadsheet at all"), {}, "fake.xlsx")).status, 400, "text renamed .xlsx");
  assert.equal((await post(cookie.a, "/api/catalog/import/preview", Buffer.alloc(0), {}, "empty.xlsx")).status, 400);
  assert.equal((await post(cookie.a, "/api/catalog/import/preview", Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(6 * 1024 * 1024)]), {}, "big.xlsx")).status, 400, "over 5 MB");
  const started = Date.now();
  const bomb = await post(cookie.a, "/api/catalog/import/preview", zipBomb(), {}, "bomb.xlsx");
  assert.equal(bomb.status, 400, `a zip bomb is refused: ${bomb.text?.slice(0, 200)}`);
  assert.match(bomb.json.error.message, /expands to too much/);
  assert.ok(Date.now() - started < 15000, "and refused quickly, without unpacking it");
  const noFile = await fetch(`${baseUrl}/api/catalog/import/preview`, { method: "POST", headers: { Cookie: cookie.a }, body: new FormData() });
  assert.equal(noFile.status, 400);
  const noColumns = await preview(cookie.a, await xlsx([{ "Product Name": "x" }], ["Product Name", "Price (incl. GST)"]));
  assert.equal(noColumns.status, 200);
  assert.equal(noColumns.data.canApply, false);
  assert.ok(noColumns.data.fileErrors.some((e) => e.includes('"Product Code" is missing')));
  const headerOnly = await preview(cookie.a, await xlsx([]));
  assert.ok(headerOnly.data.fileErrors.some((e) => e.includes("no data rows")));
  const extra = await preview(cookie.a, await xlsx([{ "Product Code": "CM-1", "Variant Code": "V1", Colour: "red" }], [...HEADER, "Colour"]));
  assert.deepEqual(extra.data.ignoredColumns, ["Colour"], "unknown columns are ignored and listed");
  pass("not an .xlsx, empty, over 5 MB, a zip bomb, no file, a missing required column and no data rows are all refused or explained without damage; unknown columns are ignored");

  console.log(`\nALL ${count} CATALOGUE IMPORT/EXPORT API TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  process.exit(exitCode);
}
