/**
 * Requirement #10 end to end (real Chromium, isolated production server, throwaway local MongoDB): the rendered
 * quotation document never presents the 18% line as GST (it is the company's own charge, product prices already
 * include GST) and its amount is unchanged; another company rewords every remaining fixed text, sets its header label,
 * hides the watermark and adds the Project Overview page without any Whyte text or image; Whyte's own document keeps
 * its standard pages.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/document-pdf-complete.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";
import { png } from "./helpers/imageFixtures.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
const GST_WORDS = /\bC\s*GST\b|\bS\s*GST\b|\bIGST\b|UTGST|Tax Summary|Taxable amount/;

try {
  server = await startIsolatedServer("doc-complete", [
    { _id: 1, email: "whytedealer@example.com", role: "dealer", name: "Whyte Dealer", discountAllocationPercent: 10, companyId: 1 },
    { _id: 2, email: "acmedealer@example.com", role: "dealer", name: "Acme Dealer", companyName: "Acme Dealer Co", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "acmeowner@example.com", role: "company_owner", name: "Acme Owner", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 1, name: "Whyte Automations", slug: "whyte-automations", status: "active", phone: "9898234336", address: "Gandhinagar", gstNumber: null, email: "sales@whyte.co.in", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "12 Main Street, Ahmedabad", gstNumber: null, email: "hello@acme.example", logoUrl: "https://logos.test/acme.png", tagline: "Smart homes, simply", createdAt: now, updatedAt: now },
  ]);
  for (const [cid, base] of [[1, 100], [20, 200]]) {
    await db.collection("categories").insertOne({ _id: base + 1, companyId: cid, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
    await db.collection("products").insertOne({ _id: base + 1, companyId: cid, name: "Smart Switch", code: `P-${base}`, type: "switch_board", categoryId: base + 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
    await db.collection("productvariants").insertOne({ _id: base + 1, companyId: cid, productId: base + 1, variantCode: `V-${base}`, config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("847.46"), taxPercent: Decimal128.fromString("18.00"), cost: Decimal128.fromString("0.00"), purchaseTaxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });

  const dealers = { whyte: await login("whytedealer@example.com", "user"), acme: await login("acmedealer@example.com", "user") };
  const owner = await login("acmeowner@example.com", "admin");
  const makeQuotation = async (cookie, base, name) => {
    const created = await api(cookie, "POST", "/api/quotations", { clientName: name, houseTypeId: base + 1 });
    assert.equal(created.status, 201, created.text?.slice(0, 160));
    const id = created.data.id ?? created.data._id;
    const room = (await api(cookie, "GET", `/api/quotations/${id}`)).data.rooms[0];
    const item = await api(cookie, "POST", `/api/quotations/${id}/items`, { quotationRoomId: room.id, productId: base + 1, productVariantId: base + 1, quantity: 2 });
    assert.equal(item.status, 201, item.text?.slice(0, 160));
    return id;
  };
  const whyteQ = await makeQuotation(dealers.whyte, 100, "Whyte Client");
  const acmeQ = await makeQuotation(dealers.acme, 200, "Acme Client");

  browser = await chromium.launch({ headless: true });
  const documentOf = async (cookie, id) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("https://logos.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png(120, 40, [30, 60, 115, 255]) }));
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`${baseUrl}/quotation/${id}/preview`, { waitUntil: "domcontentloaded" });
    await page.locator(".proposal-page").first().waitFor();
    await page.waitForTimeout(1500);
    const pages = await page.locator(".proposal-page").evaluateAll((els) => els.map((el) => el.innerText));
    const html = await page.locator(".proposal-page").evaluateAll((els) => els.map((el) => el.innerHTML).join("\n"));
    const watermarks = await page.locator('.proposal-page [aria-hidden="true"] > span[style*="rotate(-18deg)"]').count();
    await context.close();
    return { pages, text: pages.join("\n"), html, watermarks };
  };
  /** The charge amount shown must be 18% of the net subtotal shown: the same arithmetic as before. */
  const amounts = (text) => [...text.matchAll(/₹\s?([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, "")));

  // ── Whyte: standard pages, the 18% shown as its own charge, amounts unchanged ──
  const whyteDoc = await documentOf(dealers.whyte, whyteQ);
  assert.ok(!GST_WORDS.test(whyteDoc.text), `no GST wording for the 18% line (found: ${GST_WORDS.exec(whyteDoc.text)?.[0]})`);
  assert.match(whyteDoc.text, /Service & Integration Charges \(18%\)/i);
  assert.match(whyteDoc.text, /All product prices are inclusive of GST\./);
  assert.match(whyteDoc.text, /Additional Charges/i);
  assert.match(whyteDoc.text, /Your Project Overview/i, "Whyte's standard pages still include the overview");
  assert.match(whyteDoc.text, /Tactus/i, "with Whyte's own Tactus block");
  const money = amounts(whyteDoc.text);
  assert.ok(money.includes(2000), `subtotal 2 × ₹1,000 shown (${money.join(", ")})`);
  const net = 2000 - (money.includes(200) ? 200 : 0);
  assert.ok(money.includes(Math.round(net * 0.18 * 100) / 100) && money.includes(Math.round(net * 1.18 * 100) / 100), `charge ${net * 0.18} and grand total ${net * 1.18} unchanged (${money.join(", ")})`);
  assert.ok(whyteDoc.watermarks > 0, "the watermark is on by default");
  pass("Whyte's document: the 18% line reads 'Service & Integration Charges (18%)' with the GST-inclusive note, no CGST/SGST/IGST wording, same amounts; standard overview and watermark kept");

  // ── Acme rewords everything, adds the overview page, hides the watermark ──
  const saved = await api(owner, "PATCH", "/api/company", {
    documentSettings: {
      introPages: "none",
      overviewPage: true,
      showWatermark: false,
      headerLabel: "Acme Smart Living",
      socialLinks: { linkedin: "https://www.linkedin.com/company/acme-homes" },
      labels: {
        serviceCharge: "Installation & Support",
        pricesIncludeGst: "Prices include GST at applicable rates.",
        taxSummary: "Project Charges",
        deviceSingular: "unit",
        devicePlural: "units",
        connectWith: "Follow",
        pageLabel: "Pg.",
        pageOf: "/",
        overviewTitle: "Scope of Your Project",
        dealerLabel: "Your Installer",
        scopeTitle: "What We Will Deliver",
      },
    },
  });
  assert.equal(saved.status, 200, saved.text?.slice(0, 200));
  for (const bad of [{ watermarkText: "X".repeat(15) }, { showWatermark: "no" }, { labels: { serviceCharge: "Y".repeat(51) } }]) {
    assert.equal((await api(owner, "PATCH", "/api/company", { documentSettings: bad })).status, 400, JSON.stringify(bad));
  }
  const acmeDoc = await documentOf(dealers.acme, acmeQ);
  for (const expected of [/Installation & Support \(18%\)/, /Prices include GST at applicable rates\./, /Project Charges/i, /Scope of Your Project/i, /Your Installer/i, /What We Will Deliver/i, /Acme Dealer Co/, /2 units/i, /Pg\. 1 \/ \d+/, /Acme Smart Living/i, /Follow Acme Homes/i]) {
    assert.match(acmeDoc.text, expected);
  }
  assert.ok(!GST_WORDS.test(acmeDoc.text), "no GST wording");
  assert.ok(!/whyte|tactus/i.test(acmeDoc.text) && !/whyte/i.test(acmeDoc.html.replace(/alt="[^"]*"/g, "")), "no Whyte text, link or image (the overview uses no Whyte picture)");
  assert.equal(acmeDoc.watermarks, 0, "the watermark is hidden");
  assert.ok(!/\bpink-|#ef4370/.test(acmeDoc.html), "no fixed pink: the tints follow the company's accent");
  pass("another company rewords the charge line, overview headings, device/page/connect wording and header label, adds the Project Overview page, hides the watermark, with no Whyte text, image or pink; bad settings are refused");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-2000)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
