/**
 * The Import / Export screen end to end (real Chromium, isolated production server, throwaway MongoDB): download the catalogue
 * and the template, upload an edited file, preview (summary, changes, problem rows), download the error report, import, and see a
 * file-level problem explained. At 1280px and 375px with no overflow.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/catalog-import-export.browser.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { chromium } = require(modulePath);
const ExcelJS = require("exceljs");

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
const dec = (v) => Decimal128.fromString(v);
const num = (v) => Number(String(v));
const HEADER = ["Product Code", "Product Name", "Category", "Variant Code", "Variant Name", "Price (incl. GST)", "GST %"];
async function xlsx(rows, headers = HEADER) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

try {
  server = await startIsolatedServer("catimport-ui", [{ _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 }], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 201, companyId: 20, name: "Curtains", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const seed = async () => {
    await db.collection("products").deleteMany({});
    await db.collection("productvariants").deleteMany({});
    await db.collection("pricechangebatches").deleteMany({});
    await db.collection("variantpricechanges").deleteMany({});
    await db.collection("products").insertOne({ _id: 2001, companyId: 20, name: "Curtain Motor", code: "CM-1", type: "curtain", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, gstRate: 18, createdAt: now, updatedAt: now });
    await db.collection("productvariants").insertOne({ _id: 1, companyId: 20, productId: 2001, variantCode: "V1", code: "V1", name: "Standard", config: {}, price: dec("1180.00"), priceWithoutTax: dec("1000.00"), taxPercent: dec("18.00"), cost: dec("900.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now });
  };
  const cookie = await login("ownera@example.com", "admin");
  browser = await chromium.launch({ headless: true });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    await seed();
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    await page.goto(`${baseUrl}/admin/import-export`, { waitUntil: "load" });
    await page.getByTestId("import-note").waitFor();
    assert.ok(await noScroll(), `no horizontal scroll at ${w}px`);
    assert.equal(await page.getByTestId("import-preview").isDisabled(), true, "nothing to preview until a file is chosen");

    // downloads
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-catalogue").click()]);
    assert.match(download.suggestedFilename(), /^catalogue-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(await download.path());
    assert.equal(book.worksheets[0].rowCount, 2, "the export has the header and the one variant");
    const [templateDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-template").click()]);
    assert.equal(templateDownload.suggestedFilename(), "catalogue-import-template.xlsx");

    // a file-level problem is explained
    await page.getByTestId("import-file").setInputFiles({ name: "wrong.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await xlsx([{ "Product Name": "x" }], ["Product Name", "Price (incl. GST)"]) });
    assert.equal(await page.getByTestId("import-filename").innerText(), "wrong.xlsx");
    await page.getByTestId("import-preview").click();
    await page.getByTestId("import-file-errors").waitFor();
    assert.match(await page.getByTestId("import-file-errors").innerText(), /"Product Code" is missing/);
    assert.equal(await page.getByTestId("import-apply").isDisabled(), true, "nothing can be imported from it");

    // something that is not a spreadsheet
    await page.getByTestId("import-file").setInputFiles({ name: "notes.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("just some text") });
    await page.getByTestId("import-preview").click();
    await page.getByTestId("import-error").waitFor();
    assert.match(await page.getByTestId("import-error").innerText(), /not an Excel|not a valid Excel/i);

    // an edited file: a price change, a new variant, a new product, and a bad row
    const edited = await xlsx([
      { "Product Code": "CM-1", "Variant Code": "V1", "Price (incl. GST)": 1299 },
      { "Product Code": "CM-1", "Variant Code": "V2", "Variant Name": "Long", "Price (incl. GST)": 2360 },
      { "Product Code": "BL-1", "Product Name": "Roller Blind", Category: "Curtains", "GST %": 18, "Variant Code": "B1", "Price (incl. GST)": 500 },
      { "Product Code": "BAD-1", "Product Name": "Broken", Category: "Nowhere", "Variant Code": "X1", "Price (incl. GST)": 10 },
    ]);
    await page.getByTestId("import-file").setInputFiles({ name: "edited.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: edited });
    await page.getByTestId("import-preview").click();
    const summary = page.getByTestId("import-summary");
    await summary.waitFor();
    const text = (await summary.innerText()).replace(/\s+/g, " ");
    assert.match(text, /4 rows read/);
    assert.match(text, /1 new product\b/);
    assert.match(text, /1 product to update/);
    assert.match(text, /2 new variants/);
    assert.match(text, /1 variant to update \(1 price change\)/);
    assert.match(text, /1 problem\b/);
    assert.equal(await page.getByTestId("import-preview-row").count(), 3, "the three usable rows are listed (the held-back product is not)");
    assert.match(await page.getByTestId("import-preview-row").first().innerText(), /CM-1[\s\S]*V1[\s\S]*price 1180 → 1299/);
    const issue = page.getByTestId("import-issue");
    assert.equal(await issue.count(), 1);
    assert.match(await issue.first().innerText(), /5[\s\S]*Category[\s\S]*no category called "Nowhere"/);
    assert.ok(await noScroll(), `no horizontal scroll with the preview at ${w}px`);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/import-export-${w}.png`, fullPage: true });
    assert.equal(num((await db.collection("productvariants").findOne({ _id: 1 })).price), 1180, "previewing saves nothing");

    // the error report
    const [report] = await Promise.all([page.waitForEvent("download"), page.getByTestId("import-error-report").click()]);
    assert.equal(report.suggestedFilename(), "catalogue-import-errors.csv");
    const csv = await readFile(await report.path(), "utf8");
    assert.match(csv, /Row,Column,Problem/);
    assert.match(csv, /5,"Category","There is no category called ""Nowhere""\."/, "row, column and problem, quoted for Excel");

    // import
    await page.getByTestId("import-apply").click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const result = page.getByTestId("import-result");
    await result.waitFor();
    const resultText = (await result.innerText()).replace(/\s+/g, " ");
    assert.match(resultText, /1 product created, 1 updated; 2 variants created, 1 updated; 1 price change/);
    assert.match(resultText, /Skipped because of problems: BAD-1/);
    assert.equal(num((await db.collection("productvariants").findOne({ _id: 1 })).price), 1299);
    assert.equal(await db.collection("productvariants").countDocuments({}), 3);
    assert.equal(await db.collection("products").countDocuments({ code: "BL-1" }), 1);
    assert.equal(await db.collection("products").countDocuments({ code: "BAD-1" }), 0);
    assert.equal(await db.collection("pricechangebatches").countDocuments({ kind: "import" }), 1);
    assert.ok(await noScroll(), `no horizontal scroll after the import at ${w}px`);

    // the same file again: nothing left to do
    await page.getByTestId("import-preview").click();
    await page.getByTestId("import-summary").waitFor();
    assert.equal(await page.getByTestId("import-apply").isDisabled(), true, "nothing would change any more");
    await context.close();
  }
  pass("Import / Export: downloads (catalogue, template), file problems explained, a preview with summary, changes and problem rows, a quoted CSV error report, the import itself (skipping the held-back product), and nothing left to do afterwards; at 1280px and 375px with no overflow");

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    await page.goto(`${baseUrl}/admin/products`, { waitUntil: "load" });
    await page.getByRole("link", { name: "Import / Export" }).first().click();
    await page.getByRole("heading", { name: "Import / Export" }).first().waitFor();
    await context.close();
  }
  pass("Import / Export is in the Catalog menu");

  console.log(`\nALL ${count} CATALOGUE IMPORT/EXPORT BROWSER TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
