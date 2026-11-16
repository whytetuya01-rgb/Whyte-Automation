/**
 * Browser check of the Document Content tab and the quotation document it drives (real Chromium against an isolated
 * production server): the editor's live preview, inline validation, saving, and what the actual quotation document
 * shows for the default company (its existing Whyte text) versus another company (its own details, no Whyte text).
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/document-content.browser.mjs
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

try {
  server = await startIsolatedServer("doc-content", [
    { _id: 1, email: "whytedealer@example.com", role: "dealer", name: "Whyte Dealer", discountAllocationPercent: 10, companyId: 1 },
    { _id: 2, email: "acmedealer@example.com", role: "dealer", name: "Acme Dealer", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "acmeowner@example.com", role: "company_owner", name: "Acme Owner", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 1, name: "Whyte Automations", slug: "whyte-automations", status: "active", phone: "9898234336", address: "Gandhinagar", gstNumber: null, email: "sales@whyte.co.in", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "12 Main Street, Ahmedabad", gstNumber: null, email: "hello@acme.example", logoUrl: "https://logos.test/acme.png", tagline: "Homes that think", createdAt: now, updatedAt: now },
  ]);
  for (const [cid, base] of [[1, 100], [20, 200]]) {
    await db.collection("categories").insertOne({ _id: base + 1, companyId: cid, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
    await db.collection("products").insertOne({ _id: base + 1, companyId: cid, name: "Smart Switch", code: `P-${base}`, type: "switch_board", categoryId: base + 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
    await db.collection("productvariants").insertOne({ _id: base + 1, companyId: cid, productId: base + 1, variantCode: `V-${base}`, config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
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
  const open = async (cookie) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("https://logos.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png(120, 40, [30, 60, 115, 255]) }));
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
    }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };
  const documentText = async (cookie, id) => {
    const { page, context } = await open(cookie);
    await page.goto(`${baseUrl}/quotation/${id}/preview`, { waitUntil: "domcontentloaded" });
    await page.locator(".proposal-page").first().waitFor();
    await page.waitForTimeout(1500);
    const pages = await page.locator(".proposal-page").evaluateAll((els) => els.map((el) => el.innerText));
    const html = await page.locator(".proposal-page").evaluateAll((els) => els.map((el) => el.innerHTML).join("\n"));
    await context.close();
    return { pages, text: pages.join("\n"), html };
  };

  // ── before any customisation ──
  const whyteDoc = await documentText(dealers.whyte, whyteQ);
  assert.match(whyteDoc.text, /About Whyte Automations/);
  assert.match(whyteDoc.text, /Whyte Automations Private Limited/);
  assert.match(whyteDoc.text, /sales@whyte\.co\.in/);
  assert.match(whyteDoc.text, /www\.whyte\.co\.in/);
  assert.match(whyteDoc.text, /Connect with Whyte/i);
  assert.ok(whyteDoc.html.includes("linkedin.com/company/whyte-automations-pvt.-ltd"));
  assert.ok(whyteDoc.pages.length >= 4, "the default company keeps cover + About + Overview + project pages");
  pass("the default company's quotation document is unchanged (Whyte text, links, About and Overview pages)");

  const acmeBefore = await documentText(dealers.acme, acmeQ);
  assert.ok(!/whyte/i.test(acmeBefore.text), `another company's document contains no Whyte text (found: ${/whyte/i.exec(acmeBefore.text)?.[0]})`);
  assert.ok(!/whyte/i.test(acmeBefore.html.replace(/alt="[^"]*"/g, "")), "nor does its markup (links, images)");
  assert.match(acmeBefore.text, /Acme Homes/);
  assert.match(acmeBefore.text, /hello@acme\.example/);
  assert.match(acmeBefore.text, /\+91 90000 11111/);
  assert.match(acmeBefore.text, /12 Main Street, Ahmedabad/);
  assert.ok(acmeBefore.html.includes('alt="Acme Homes logo"'), "its own logo is on the cover");
  assert.doesNotMatch(acmeBefore.text, /Connect with/i, "no social links, so no 'Connect with' row");
  assert.equal(acmeBefore.pages.length, whyteDoc.pages.length - 2, "no Whyte About / Overview pages for another company");
  pass("another company's document shows its own name, logo and contact details, and nothing of Whyte's");

  // ── the Document Content tab ──
  const { page } = await open(owner);
  await page.goto(`${baseUrl}/admin/company`, { waitUntil: "load" });
  await page.getByRole("tab", { name: "Document & Social Links" }).click();
  await page.locator('[data-testid="document-content-editor"]').waitFor();
  const preview = page.locator('[data-testid="document-live-preview"]');
  assert.equal(await page.getByRole("radio", { name: /Standard Whyte pages/ }).count(), 0, "the Whyte standard pages are not offered to another company");
  assert.equal(await preview.getByText(/Connect with/i).count(), 0);
  assert.ok(!/whyte/i.test(await preview.innerText()), "the preview shows no Whyte text");
  assert.equal(await page.getByRole("button", { name: "Save Document Content" }).isDisabled(), true);

  await page.getByLabel("Legal name on the document").fill("Acme Homes Private Limited");
  await page.getByLabel("Website").fill("https://www.acme.example/");
  await page.getByLabel("Footer text (every page)").fill("www.acme.example");
  await page.getByLabel("LinkedIn").fill("https://www.linkedin.com/company/acme-homes");
  await page.getByLabel("Instagram").fill("https://www.instagram.com/acme_homes");
  assert.match(await preview.innerText(), /Acme Homes Private Limited/);
  assert.match(await preview.innerText(), /https:\/\/www\.acme\.example\//);
  assert.match(await preview.innerText(), /Connect with Acme Homes/i);
  assert.match(await preview.innerText(), /www\.acme\.example/);
  assert.equal(await preview.locator('a[href*="linkedin.com/company/acme-homes"]').count(), 1);
  assert.equal(await preview.locator('a[href*="instagram.com/acme_homes"]').count(), 1);
  pass("the Document Content preview updates as you type (legal name, website, footer, social links)");

  await page.getByLabel("Website").fill("http://not-secure.example");
  await page.getByRole("button", { name: "Save Document Content" }).click();
  await page.locator("text=Website must start with https://").waitFor();
  assert.equal((await db.collection("companies").findOne({ _id: 20 })).documentSettings, undefined, "an invalid value is not saved");
  await page.getByLabel("Website").fill("https://www.acme.example/");
  await page.getByLabel("YouTube").fill("https://evil.example/x");
  await page.getByRole("button", { name: "Save Document Content" }).click();
  await page.locator("text=Enter a full https:// YouTube address.").waitFor();
  await page.getByLabel("YouTube").fill("");
  pass("invalid or wrong-network links are flagged on the field and nothing is saved");

  await page.getByRole("radio", { name: /Custom About page/ }).click();
  await page.getByRole("button", { name: "Save Document Content" }).click();
  await page.locator("text=Write the About text").waitFor();
  await page.getByLabel("About title").fill("Who is Acme");
  await page.getByLabel("About text").fill("We design smart homes for modern families.");
  await page.getByRole("button", { name: "Add highlight" }).click();
  await page.getByLabel("Highlight 1 title").fill("Warranty");
  await page.getByLabel("Highlight 1 description").fill("Five years on everything");
  assert.match(await preview.innerText(), /Who is Acme/);
  assert.match(await preview.innerText(), /Five years on everything/);

  await page.getByRole("button", { name: "Cancel changes" }).click();
  assert.equal(await page.getByLabel("Website").inputValue(), "", "Cancel returns to what is saved");
  assert.ok(!/Who is Acme/.test(await preview.innerText()));
  // redo and save
  await page.getByLabel("Legal name on the document").fill("Acme Homes Private Limited");
  await page.getByLabel("Website").fill("https://www.acme.example/");
  await page.getByLabel("Footer text (every page)").fill("www.acme.example");
  await page.getByLabel("LinkedIn").fill("https://www.linkedin.com/company/acme-homes");
  await page.getByRole("radio", { name: /Custom About page/ }).click();
  await page.getByLabel("About title").fill("Who is Acme");
  await page.getByLabel("About text").fill("We design smart homes for modern families.");
  await page.getByRole("button", { name: "Add highlight" }).click();
  await page.getByLabel("Highlight 1 title").fill("Warranty");
  await page.getByLabel("Highlight 1 description").fill("Five years on everything");
  await page.getByRole("button", { name: "Save Document Content" }).click();
  await page.locator("text=Your quotation documents and page footer use the new content.").first().waitFor();
  const savedSettings = (await db.collection("companies").findOne({ _id: 20 })).documentSettings;
  assert.equal(savedSettings.legalName, "Acme Homes Private Limited");
  assert.equal(savedSettings.introPages, "custom");
  assert.deepEqual(savedSettings.aboutHighlights, [{ title: "Warranty", text: "Five years on everything" }]);
  assert.equal(await page.getByRole("button", { name: "Save Document Content" }).isDisabled(), true, "saved: nothing left to save");
  // the real page footer shows the new social link without a manual reload
  await page.waitForFunction(() => Boolean(document.querySelector('footer a[href*="linkedin.com/company/acme-homes"]')), null, { timeout: 15000 });
  pass("Cancel restores the saved state; saving stores the content and the page footer updates without a reload");

  // ── the real quotation document now uses it ──
  const acmeAfter = await documentText(dealers.acme, acmeQ);
  assert.match(acmeAfter.text, /Acme Homes Private Limited/);
  assert.match(acmeAfter.text, /www\.acme\.example/);
  assert.match(acmeAfter.text, /Who is Acme/);
  assert.match(acmeAfter.text, /Five years on everything/);
  assert.match(acmeAfter.text, /Connect with Acme Homes/i);
  assert.ok(acmeAfter.html.includes("linkedin.com/company/acme-homes"));
  assert.ok(!/whyte/i.test(acmeAfter.text), "still no Whyte text");
  assert.equal(acmeAfter.pages.length, acmeBefore.pages.length + 1, "the custom About page is added");
  const whyteAfter = await documentText(dealers.whyte, whyteQ);
  assert.equal(whyteAfter.pages.length, whyteDoc.pages.length);
  assert.match(whyteAfter.text, /Whyte Automations Private Limited/);
  assert.ok(!/acme/i.test(whyteAfter.text), "Acme's content never appears in the default company's document");
  pass("the quotation document shows the company's saved content (custom About page, contact card, links) and no other company's");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
