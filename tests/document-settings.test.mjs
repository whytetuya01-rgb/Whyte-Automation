/**
 * Quotation document content settings through the real API (production-mode server + throwaway local MongoDB):
 * saving and validating `documentSettings`, the default-company-only standard intro pages, tenant isolation
 * (Company A / B, dealers, anonymous users, Super Admin on the platform vs acting as a company) and the page
 * footer's social links per company.
 *
 *   node tests/document-settings.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

const WHYTE_LINKEDIN = "linkedin.com/company/whyte-automations-pvt.-ltd";

try {
  server = await startIsolatedServer("doc-settings", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "whyteowner@example.com", role: "company_owner", name: "Whyte Owner", companyId: 1 },
    { _id: 3, email: "acmeowner@example.com", role: "company_owner", name: "Acme Owner", companyId: 20 },
    { _id: 4, email: "betaowner@example.com", role: "company_owner", name: "Beta Owner", companyId: 30 },
    { _id: 5, email: "dealer@example.com", role: "dealer", name: "Dealer", companyId: 20 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  const company = (id, slug, name) => ({ _id: id, name, slug, status: "active", phone: "1111111111", address: "Street 1", gstNumber: null, email: `${slug}@example.com`, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("companies").insertMany([
    company(1, "whyte-automations", "Whyte Automations"),
    company(20, "acme-homes", "Acme Homes"),
    company(30, "beta-builders", "Beta Builders"),
  ]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 10 });
  const cookie = {
    super: await login("super@example.com", "admin"),
    whyte: await login("whyteowner@example.com", "admin"),
    acme: await login("acmeowner@example.com", "admin"),
    beta: await login("betaowner@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
  };
  const stored = (id) => db.collection("companies").findOne({ _id: id });
  const patch = async (c, body) => {
    const res = await fetch(`${baseUrl}/api/company`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, json };
  };
  const footerHtml = async (c) => (await fetch(`${baseUrl}/admin/dashboard`, { headers: { Cookie: c } })).text();

  // ── save + read back ──
  const settings = {
    legalName: "Acme Homes Private Limited",
    website: "https://www.acme.example/",
    footerText: "www.acme.example",
    automationType: "Acme Smart Living",
    socialLinks: { linkedin: "https://www.linkedin.com/company/acme-homes", instagram: "https://www.instagram.com/acme_homes", youtube: "", facebook: null },
    introPages: "custom",
    aboutTitle: "About Acme",
    aboutBody: "We design smart homes.",
    aboutHighlights: [{ title: "Warranty", text: "Five years" }],
  };
  const saved = await patch(cookie.acme, { documentSettings: settings });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const acme = await stored(20);
  assert.equal(acme.documentSettings.legalName, "Acme Homes Private Limited");
  assert.equal(acme.documentSettings.socialLinks.youtube, null, "a blank link is stored as cleared");
  assert.equal(acme.documentSettings.introPages, "custom");
  assert.deepEqual(acme.documentSettings.aboutHighlights, [{ title: "Warranty", text: "Five years" }]);
  const readBack = await (await fetch(`${baseUrl}/api/company`, { headers: { Cookie: cookie.acme } })).json();
  assert.equal(readBack._id, 20);
  assert.equal(readBack.documentSettings.website, "https://www.acme.example/");
  pass("a company owner saves document content and reads it back");

  const replaced = await patch(cookie.acme, { documentSettings: { introPages: "none" } });
  assert.equal(replaced.status, 200);
  assert.deepEqual(Object.keys((await stored(20)).documentSettings), ["introPages"], "a save replaces the whole settings object (the form always sends everything)");
  await patch(cookie.acme, { documentSettings: settings });
  pass("each save replaces the settings object; nothing stale lingers");

  // ── validation ──
  const before = JSON.stringify((await stored(20)).documentSettings);
  for (const [label, body] of [
    ["http website", { website: "http://acme.example" }],
    ["javascript website", { website: "javascript:alert(1)" }],
    ["wrong-network social link", { socialLinks: { linkedin: "https://evil.example/in" } }],
    ["unknown social network", { socialLinks: { tiktok: "https://tiktok.com/@a" } }],
    ["too long legal name", { legalName: "x".repeat(161) }],
    ["control characters", { legalName: "a\u0000b" }],
    ["too many highlights", { aboutHighlights: Array.from({ length: 5 }, () => ({ title: "t", text: "x" })) }],
    ["bad intro mode", { introPages: "fancy" }],
    ["unknown key", { companyId: 30 }],
    ["wrong type", { legalName: 42 }],
  ]) {
    const res = await patch(cookie.acme, { documentSettings: body });
    assert.equal(res.status, 400, `${label} -> ${res.status} ${JSON.stringify(res.json)}`);
  }
  assert.equal(JSON.stringify((await stored(20)).documentSettings), before, "rejected requests change nothing");
  pass("unsafe URLs, wrong-network links, oversized or malformed values and unknown keys are rejected without changing anything");

  // ── standard intro pages: default company only ──
  const std = await patch(cookie.acme, { documentSettings: { introPages: "standard" } });
  assert.equal(std.status, 400);
  assert.equal(std.json.error.field, "documentSettings.introPages");
  assert.equal(JSON.stringify((await stored(20)).documentSettings), before);
  assert.equal((await patch(cookie.whyte, { documentSettings: { introPages: "standard" } })).status, 200);
  assert.equal((await stored(1)).documentSettings.introPages, "standard");
  pass("only the default company can choose the standard Whyte intro pages (enforced by the API)");

  // ── tenant isolation ──
  const betaBefore = JSON.stringify(await stored(30));
  const hijack = await patch(cookie.acme, { documentSettings: { legalName: "Hijacked" }, companyId: 30, id: 30 });
  assert.equal(hijack.status, 200);
  assert.equal(JSON.stringify(await stored(30)), betaBefore, "a client-supplied companyId never reaches Company B");
  assert.equal((await stored(20)).documentSettings.legalName, "Hijacked", "the caller's own company is the one changed");
  await patch(cookie.acme, { documentSettings: settings });
  assert.equal((await patch(null, { documentSettings: { legalName: "x" } })).status, 401, "anonymous");
  assert.equal((await patch(cookie.dealer, { documentSettings: { legalName: "x" } })).status, 403, "a dealer cannot change company content");
  assert.equal((await patch(cookie.super, { documentSettings: { legalName: "x" } })).status, 403, "a Super Admin on the platform changes no company");
  const readBeta = await (await fetch(`${baseUrl}/api/company`, { headers: { Cookie: cookie.beta } })).json();
  assert.equal(readBeta._id, 30);
  assert.equal(readBeta.documentSettings, undefined, "Company B does not see Company A's settings");
  pass("Company A cannot change or read Company B's content; dealers and anonymous users cannot write; client company ids are ignored");

  const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie.super }, body: JSON.stringify({ companyId: 30, reason: "doc settings test" }) });
  assert.equal(act.status, 200);
  const acting = [cookie.super, ...act.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ");
  const acmeNow = JSON.stringify((await stored(20)).documentSettings);
  const actSave = await patch(acting, { documentSettings: { legalName: "Beta Builders Pvt Ltd" }, companyId: 20 });
  assert.equal(actSave.status, 200, JSON.stringify(actSave.json));
  assert.equal((await stored(30)).documentSettings.legalName, "Beta Builders Pvt Ltd", "acting as Company B changes Company B");
  assert.equal(JSON.stringify((await stored(20)).documentSettings), acmeNow, "and never Company A");
  pass("a Super Admin acting as Company B changes only Company B's content");

  // ── page footer: each company shows only its own social links ──
  const [whyteHtml, acmeHtml, betaHtml, superHtml] = await Promise.all([footerHtml(cookie.whyte), footerHtml(cookie.acme), footerHtml(cookie.beta), footerHtml(cookie.super)]);
  assert.ok(acmeHtml.includes("linkedin.com/company/acme-homes") && acmeHtml.includes("instagram.com/acme_homes"), "Acme's footer shows Acme's links");
  assert.ok(!acmeHtml.includes(WHYTE_LINKEDIN) && !acmeHtml.includes("whyte_intelligent_spaces"), "and none of Whyte's");
  assert.ok(!acmeHtml.includes("youtube.com") && !acmeHtml.includes("facebook.com"), "links that were left blank are not shown");
  assert.ok(!betaHtml.includes("linkedin.com") && !betaHtml.includes("instagram.com") && !betaHtml.includes(WHYTE_LINKEDIN), "a company with no links shows no social icons (and not Whyte's)");
  assert.ok(whyteHtml.includes(WHYTE_LINKEDIN), "the default company keeps its links");
  assert.ok(superHtml.includes(WHYTE_LINKEDIN), "the platform context carries the platform's own links");
  pass("the page footer shows each company's own social links only (none for a company without any)");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
