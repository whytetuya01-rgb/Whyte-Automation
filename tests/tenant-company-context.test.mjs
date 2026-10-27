/**
 * Company context over real HTTP (isolated production server + throwaway local Mongo): the footer, the quotation page's
 * company details, Super Admin platform / "Act as company" behaviour, cross-company quotation access, and that theme /
 * company writes stay scoped to the authenticated company. Companion to tests/tenant-company-context.test.ts.
 *
 *   node tests/tenant-company-context.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

const strip = (html) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/**
 * The company name printed in the site footer ("© 2026 <name>. All rights reserved."). The dealer layout renders it in
 * the HTML; the admin panel layout hands the footer to a client wrapper that only paints after mount, so there it is
 * read from the serialized server payload (the footer element's children: ..., "<name>", ". All rights reserved.").
 */
const footerName = (html) => {
  const matches = [...strip(html).matchAll(/©\s*\d{4}\s*(.+?)\.\s*All rights reserved/g)];
  if (matches.length) return matches[matches.length - 1][1].trim();
  // Inside the flight payload the strings sit in a JS string literal, so the quotes are usually backslash-escaped.
  const payload = [...html.matchAll(/\\?"([^"\\]*)\\?",\s*\\?"\. All rights reserved\./g)];
  return payload.length ? payload[payload.length - 1][1].trim() : null;
};

try {
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "super2@example.com", role: "super_admin", name: "Super Two" },
    { _id: 3, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 4, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
    { _id: 5, email: "admin_b@example.com", role: "admin", name: "Admin B", companyId: 20 },
    { _id: 6, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", companyId: 20 },
  ];
  server = await startIsolatedServer("tenant-company-ctx", USERS, { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  const company = (id, name, extra) => ({
    _id: id, name, slug: `company-${id}`, status: "active", isDeleted: false, createdAt: now, updatedAt: now, logoUrl: null, ...extra,
  });
  // A pending-review company and a soft-deleted one are inserted FIRST: that is what an unfiltered findOne() returned.
  await db.collection("companies").insertMany([
    company(5, "Pending Leak Co", { status: "pending", registrationStatus: "pending_review", phone: "5", email: "leak@pending.example", address: "x", gstNumber: "LEAK-PENDING", tagline: null }),
    company(6, "Deleted Leak Co", { isDeleted: true, phone: "6", email: "leak@deleted.example", address: "x", gstNumber: "LEAK-DELETED", tagline: null }),
    company(10, "Alpha Automation", { phone: "+91 90000 10000", email: "alpha@alpha.example", address: "1 Alpha Street", gstNumber: "27AAAAA0000A1Z5", tagline: "Alpha tagline", theme: "whyte-rose" }),
    company(20, "Beta Builders", { phone: "+91 80000 20000", email: "beta@beta.example", address: "2 Beta Street", gstNumber: "29BBBBB0000B1Z5", tagline: "Beta tagline", theme: "whyte-rose" }),
  ]);
  const quotation = (id, extra) => ({ _id: id, quotationNumber: id, clientName: `Client ${id}`, status: "draft", isDeleted: false, createdAt: now, updatedAt: now, ...extra });
  await db.collection("quotations").insertMany([
    quotation("q_a", { companyId: 10, dealerId: 4, createdBy: "4" }),
    quotation("q_b", { companyId: 20, dealerId: 6, createdBy: "6" }),
    quotation("q_missing", { dealerId: 4, createdBy: "4" }),
    quotation("q_null", { companyId: null, dealerId: 4, createdBy: "4" }),
    quotation("q_unknown", { companyId: 999, dealerId: 4, createdBy: "4" }),
  ]);

  const c = {
    super: await login("super@example.com", "admin"),
    super2: await login("super2@example.com", "admin"),
    adminA: await login("admin_a@example.com", "admin"),
    dealerA: await login("dealer_a@example.com", "user"),
    adminB: await login("admin_b@example.com", "admin"),
    dealerB: await login("dealer_b@example.com", "user"),
  };
  const page = async (cookie, path) => {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
    return { status: res.status, html: await res.text(), location: res.headers.get("location") };
  };
  const NEUTRAL = "Whyte Automations";
  const LEAKS = ["Pending Leak Co", "Deleted Leak Co", "LEAK-PENDING", "LEAK-DELETED", "leak@pending.example", "leak@deleted.example"];

  // 1 + 2. Each company's users get their own footer (app layout for dealers, admin panel layout for admins).
  for (const [who, path, name] of [["dealerA", "/", "Alpha Automation"], ["adminA", "/admin/company", "Alpha Automation"], ["dealerB", "/", "Beta Builders"], ["adminB", "/admin/company", "Beta Builders"]]) {
    const res = await page(c[who], path);
    assert.equal(res.status, 200, `${who} ${path}`);
    assert.equal(footerName(res.html), name, `${who} footer`);
    for (const leak of LEAKS) assert.ok(!res.html.includes(leak), `${who} ${path} must not contain ${leak}`);
  }
  const alpha = await page(c.dealerA, "/");
  assert.ok(strip(alpha.html).includes("alpha@alpha.example") && !strip(alpha.html).includes("beta@beta.example"), "Company A footer contact is A's only");
  const beta = await page(c.dealerB, "/");
  assert.ok(strip(beta.html).includes("beta@beta.example") && !strip(beta.html).includes("alpha@alpha.example"), "Company B footer contact is B's only");
  pass("Company A and Company B users each get their own footer name and contact details (app layout and admin panel layout)");

  // 3. No session -> no company data at all.
  const anon = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.ok([302, 307].includes(anon.status), `anonymous request is redirected, got ${anon.status}`);
  assert.ok(!(await anon.text()).includes("Alpha Automation"));
  pass("no session: redirected to login, no company details rendered");

  // 4. Super Admin platform context: the neutral footer, never an arbitrary company.
  const platform = await page(c.super, "/admin/company");
  assert.equal(platform.status, 200);
  assert.equal(footerName(platform.html), NEUTRAL);
  pass("Super Admin in platform context gets the neutral footer");

  // 5. Valid "Act as company B" grant -> Company B's footer; exit -> neutral again.
  const startActAs = async (cookie, body) => {
    const res = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
    const pairs = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((x) => x.split(";")[0]);
    return { status: res.status, cookie: pairs.find((p) => p.startsWith("whyte_act_as=")) };
  };
  const grantB = await startActAs(c.super, { companyId: 20, reason: "tenant company context test" });
  assert.ok([200, 201].includes(grantB.status), `act-as start -> ${grantB.status}`);
  assert.ok(grantB.cookie, "act-as cookie issued");
  const actingAsB = await page(`${c.super}; ${grantB.cookie}`, "/admin/company");
  assert.equal(footerName(actingAsB.html), "Beta Builders");
  for (const leak of [...LEAKS, "Alpha Automation"]) assert.ok(!strip(actingAsB.html).includes(`© ${new Date().getFullYear()} ${leak}`), `acting as B must not show ${leak} in the footer`);
  pass("Super Admin with a valid Act-as-Company-B grant gets Company B's footer");

  // 6. Invalid / expired / someone else's / forged grants never select a company.
  const forged = await page(`${c.super}; whyte_act_as=not-a-real-grant`, "/admin/company");
  assert.equal(footerName(forged.html), NEUTRAL, "forged cookie");
  const otherSuper = await page(`${c.super2}; ${grantB.cookie}`, "/admin/company");
  assert.equal(footerName(otherSuper.html), NEUTRAL, "another Super Admin presenting the grant");
  const adminWithGrant = await page(`${c.adminA}; ${grantB.cookie}`, "/admin/company");
  assert.equal(footerName(adminWithGrant.html), "Alpha Automation", "a company admin presenting a Super Admin grant stays in their own company");
  await db.collection("platformaccesslogs").updateMany({}, { $set: { endedAt: new Date() } });
  const ended = await page(`${c.super}; ${grantB.cookie}`, "/admin/company");
  assert.equal(footerName(ended.html), NEUTRAL, "ended grant");
  const actAsMissing = await startActAs(c.super, { companyId: 99999, reason: "no such company" });
  assert.ok(actAsMissing.status >= 400 && !actAsMissing.cookie, `act-as for an unknown company is refused, got ${actAsMissing.status}`);
  const stillNeutral = await page(c.super, "/admin/company");
  assert.equal(footerName(stillNeutral.html), NEUTRAL);
  pass("forged, ended, another Super Admin's and unknown-company grants cannot select a company; a company admin's own company wins");

  // 7. Pending-review / soft-deleted companies never appear for anybody (checked on every page above and again here).
  const everyone = await Promise.all(["dealerA", "dealerB", "adminA", "adminB"].map((who) => page(c[who], who.startsWith("dealer") ? "/" : "/admin/company")));
  for (const res of everyone) for (const leak of LEAKS) assert.ok(!res.html.includes(leak), `leak ${leak}`);
  pass("a pending-review company and a soft-deleted company inserted first never leak into any footer");

  // 8. The quotation page hands ProposalBuilder the active tenant's company (GST, address, contact, tagline).
  const qa = await page(c.dealerA, "/quotation/q_a");
  assert.equal(qa.status, 200, "dealer A opens its quotation");
  for (const own of ["Alpha Automation", "27AAAAA0000A1Z5", "1 Alpha Street", "alpha@alpha.example", "Alpha tagline"]) assert.ok(qa.html.includes(own), `payload has ${own}`);
  for (const foreign of ["Beta Builders", "29BBBBB0000B1Z5", "2 Beta Street", "beta@beta.example", ...LEAKS]) assert.ok(!qa.html.includes(foreign), `payload must not have ${foreign}`);
  const qb = await page(c.dealerB, "/quotation/q_b");
  assert.equal(qb.status, 200, "dealer B opens its quotation");
  for (const own of ["Beta Builders", "29BBBBB0000B1Z5", "2 Beta Street", "beta@beta.example", "Beta tagline"]) assert.ok(qb.html.includes(own), `payload has ${own}`);
  for (const foreign of ["Alpha Automation", "27AAAAA0000A1Z5", "1 Alpha Street", "alpha@alpha.example", ...LEAKS]) assert.ok(!qb.html.includes(foreign), `payload must not have ${foreign}`);
  pass("the quotation page passes each tenant its own company (GST, address, contact, tagline) and nothing from another company");

  // 9 + 10. Cross-company access and missing / null / unknown companyId stay blocked, page and API. The page streams
  // from a loading boundary, so notFound() may arrive as a 200 carrying the not-found UI: what matters is that the
  // not-found marker is present and none of the quotation's or the other company's data is.
  const isNotFound = (res) => res.status === 404 || /NEXT_HTTP_ERROR_FALLBACK;404|could not be found/.test(res.html);
  const OTHER_COMPANY = { q_a: ["Alpha Automation", "27AAAAA0000A1Z5", "alpha@alpha.example", "1 Alpha Street"], q_b: ["Beta Builders", "29BBBBB0000B1Z5", "beta@beta.example", "2 Beta Street"] };
  for (const [who, id] of [["dealerB", "q_a"], ["adminB", "q_a"], ["dealerA", "q_b"], ["adminA", "q_b"], ["super", "q_a"]]) {
    const res = await page(c[who], `/quotation/${id}`);
    assert.ok(isNotFound(res), `${who} /quotation/${id} -> ${res.status} without a not-found marker`);
    assert.ok(!res.html.includes(`Client ${id}`), `${who} must not receive the quotation's client data`);
    for (const secret of OTHER_COMPANY[id]) assert.ok(!res.html.includes(secret), `${who} must not receive ${secret}`);
    const apiRes = await api(c[who], "GET", `/api/quotations/${id}`);
    assert.ok([403, 404].includes(apiRes.status), `${who} API ${id} -> ${apiRes.status}`);
  }
  for (const who of ["adminA", "adminB", "dealerA"]) {
    for (const id of ["q_missing", "q_null", "q_unknown"]) {
      const res = await page(c[who], `/quotation/${id}`);
      assert.ok(isNotFound(res), `${who} page ${id} -> ${res.status} without a not-found marker`);
      assert.ok(!res.html.includes(`Client ${id}`), `${who} must not receive ${id}'s client data`);
      assert.ok([403, 404].includes((await api(c[who], "GET", `/api/quotations/${id}`)).status), `${who} API ${id}`);
    }
  }
  pass("cross-company quotations and quotations with missing / null / unknown companyId render not-found with no quotation or company data (page) and 403/404 (API) for every role tried");

  // 11. Theme and company writes stay on the authenticated company.
  const themeB = await api(c.adminB, "PATCH", "/api/theme", { theme: "emerald-haven", companyId: 10 });
  assert.ok([200, 400].includes(themeB.status), `theme PATCH with a stray companyId -> ${themeB.status}`);
  const companies = async () => Object.fromEntries((await db.collection("companies").find({ _id: { $in: [10, 20] } }).toArray()).map((x) => [x._id, x]));
  let state = await companies();
  assert.equal(state[10].theme, "whyte-rose", "Company A's theme is untouched");
  if (themeB.status === 200) assert.equal(state[20].theme, "emerald-haven", "Company B's theme updated");
  const themeSuper = await api(c.super, "PATCH", "/api/theme", { theme: "emerald-haven" });
  assert.equal(themeSuper.status, 403, "Super Admin without an act-as company cannot write a theme");
  const compPatch = await api(c.adminB, "PATCH", "/api/company", { tagline: "Beta changed", companyId: 10 });
  assert.ok([200, 400].includes(compPatch.status), `company PATCH with a stray companyId -> ${compPatch.status}`);
  state = await companies();
  assert.equal(state[10].tagline, "Alpha tagline", "Company A's profile is untouched");
  if (compPatch.status === 200) assert.equal(state[20].tagline, "Beta changed", "Company B's profile updated");
  const getOwn = await api(c.adminA, "GET", "/api/company");
  assert.equal(getOwn.status, 200);
  assert.equal(getOwn.json?.name ?? getOwn.json?.data?.name, "Alpha Automation");
  const getPlatform = await api(c.super, "GET", "/api/company");
  assert.equal(getPlatform.status, 200);
  assert.ok(getPlatform.json === null || getPlatform.json?.data === null, "Super Admin without act-as gets no company");
  const getTheme = await api(c.adminA, "GET", "/api/theme");
  assert.equal(getTheme.json?.data?.currentTheme ?? getTheme.json?.currentTheme, "whyte-rose");
  pass("PATCH /api/theme and PATCH /api/company only ever write the session's company (a stray companyId in the body changes nothing); platform context cannot write; GETs return the caller's own company");

  console.log(`\n${results.length} tests passed.`);
} catch (error) {
  exitCode = 1;
  console.error(error);
  if (server) console.error(server.getOutput().slice(-3000));
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
