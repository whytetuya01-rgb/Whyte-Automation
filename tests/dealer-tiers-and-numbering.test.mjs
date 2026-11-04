/**
 * Quotation numbering and dealer tiers through the real API (production-mode server + throwaway local MongoDB):
 *   - QT-YYYY-NNN from every creation path (new, dealer, converted lead, clone), concurrent creation, a number supplied
 *     by the client is never used, historical numbers are untouched;
 *   - a dealer's category follows the real lifecycle: only DELIVERED quotations count, and only after approval; repeated
 *     calls, drafts, sent, approved, rejected and clones do not; other dealers and companies are separate;
 *   - the Super Admin correction is permission-protected and audited; the dashboard shows real numbers.
 * The thresholds and the rules in detail are in tests/dealer-tier-service.test.ts.
 *
 *   node tests/dealer-tiers-and-numbering.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;
const YEAR = new Date().getFullYear();
const NUMBER = /^QT-\d{4}-\d{3,}$/;

try {
  server = await startIsolatedServer("tiers", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 3, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 4, email: "dealerd@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
    { _id: 5, email: "dealere@example.com", role: "dealer", name: "Dealer E", discountAllocationPercent: 10, companyId: 10 },
    { _id: 6, email: "dealerx@example.com", role: "dealer", name: "Dealer X", discountAllocationPercent: 10, companyId: 20 },
    { _id: 8, email: "adminb@example.com", role: "admin", name: "Admin B", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  // A quotation is marked sent together with its PDF (multipart "pdf").
  const markSent = async (cookie, id, label = id) => {
    const form = new FormData();
    form.append("pdf", new Blob([Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`)], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${id}/mark-sent`, { method: "POST", headers: { Cookie: cookie }, body: form });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, data: json?.data, text };
  };
  const now = new Date();
  for (const [cid, base, name] of [[10, 100, "Acme Homes"], [20, 200, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: cid, name, slug: `c${cid}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
    await db.collection("categories").insertOne({ _id: base + 1, companyId: cid, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
    await db.collection("products").insertOne({ _id: base + 1, companyId: cid, name: "Smart Switch", code: `P-${base}`, type: "switch_board", categoryId: base + 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
    await db.collection("productvariants").insertOne({ _id: base + 1, companyId: cid, productId: base + 1, variantCode: `V-${base}`, config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = {
    super: await login("super@example.com", "admin"),
    admin: await login("admin@example.com", "admin"),
    owner: await login("owner@example.com", "admin"),
    dealerD: await login("dealerd@example.com", "user"),
    dealerE: await login("dealere@example.com", "user"),
    dealerX: await login("dealerx@example.com", "user"),
    adminB: await login("adminb@example.com", "admin"),
  };
  const idOf = (r) => r.data?.id ?? r.data?._id;
  const numberOf = async (id) => (await db.collection("quotations").findOne({ _id: id })).quotationNumber;
  const sequenceOf = (number) => Number(number.split("-")[2]);

  // ═══ numbering ═══
  const firstB = await api(c.adminB, "POST", "/api/quotations", { clientName: "B first" });
  assert.equal(firstB.status, 201, firstB.text?.slice(0, 200));
  assert.equal(await numberOf(idOf(firstB)), `QT-${YEAR}-001`, "a new company starts at 001");

  const first = await api(c.admin, "POST", "/api/quotations", { clientName: "A first" });
  const second = await api(c.dealerD, "POST", "/api/quotations", { clientName: "A second (dealer)" });
  assert.deepEqual([first.status, second.status], [201, 201]);
  assert.equal(await numberOf(idOf(first)), `QT-${YEAR}-001`, "company A also starts at 001 (numbers are per company)");
  assert.equal(await numberOf(idOf(second)), `QT-${YEAR}-002`, "an admin and a dealer share one sequence");

  const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => api(i % 2 ? c.dealerD : c.admin, "POST", "/api/quotations", { clientName: `Burst ${i}` })));
  assert.ok(burst.every((r) => r.status === 201), `all created (${burst.map((r) => r.status)})`);
  const burstNumbers = await Promise.all(burst.map((r) => numberOf(idOf(r))));
  assert.ok(burstNumbers.every((n) => NUMBER.test(n)));
  assert.equal(new Set(burstNumbers).size, 10, "ten simultaneous creations: no duplicate number");
  assert.deepEqual(burstNumbers.map(sequenceOf).sort((a, b) => a - b), Array.from({ length: 10 }, (_, i) => 3 + i), "consecutive, no gaps");

  const lead = await api(c.owner, "POST", "/api/crm/leads", { customerName: "Lead for number", phone: "9000000071" });
  const converted = await api(c.owner, "POST", `/api/crm/leads/${lead.data.id}/convert`, {});
  assert.equal(converted.status, 200, converted.text?.slice(0, 160));
  assert.equal(converted.data.quotationNumber, `QT-${YEAR}-013`, "a converted lead takes the next number in the same sequence");

  const cloneSource = idOf(first);
  const clone = await api(c.admin, "POST", `/api/quotations/${cloneSource}/duplicate`, {});
  assert.equal(clone.status, 201, clone.text?.slice(0, 160));
  const cloneNumber = await numberOf(idOf(clone));
  assert.equal(cloneNumber, `QT-${YEAR}-014`, "a clone gets the next number");
  assert.notEqual(cloneNumber, await numberOf(cloneSource), "never the original's number");
  assert.equal(await numberOf(cloneSource), `QT-${YEAR}-001`, "and the original keeps its own");

  for (const [label, body] of [["QT-1999-777", { clientName: "Forged", quotationNumber: "QT-1999-777" }], ["QT-2026-001", { clientName: "Forged two", quotationNumber: `QT-${YEAR}-001` }]]) {
    const forged = await api(c.admin, "POST", "/api/quotations", body);
    assert.ok(forged.status === 400 || forged.status === 201, `a supplied number is refused or ignored (${forged.status})`);
    if (forged.status === 201) assert.notEqual(await numberOf(idOf(forged)), label, "and never used");
    assert.equal(await db.collection("quotations").countDocuments({ quotationNumber: "QT-1999-777" }), 0, "no quotation was saved with the supplied number");
  }
  assert.equal((await api(c.admin, "PATCH", `/api/quotations/${cloneSource}`, { quotationNumber: "QT-1999-888" })).status >= 400, true, "the number cannot be edited either");
  assert.equal(await numberOf(cloneSource), `QT-${YEAR}-001`);

  // Historical numbers: raw legacy data above the counter, and an old year.
  const legacy = [
    { _id: "q_legacy_1", companyId: 10, quotationNumber: `QT-${YEAR}-500`, clientName: "Legacy 500", status: "draft", createdAt: new Date("2025-02-02") },
    { _id: "q_legacy_2", companyId: 10, quotationNumber: "QT-2025-123", clientName: "Legacy 2025", status: "draft", createdAt: new Date("2025-03-03") },
  ];
  await db.collection("quotations").insertMany(legacy);
  const afterLegacy = await api(c.admin, "POST", "/api/quotations", { clientName: "After legacy" });
  assert.equal(await numberOf(idOf(afterLegacy)), `QT-${YEAR}-501`, "new numbers go above historical ones");
  for (const doc of legacy) {
    const kept = await db.collection("quotations").findOne({ _id: doc._id });
    assert.deepEqual([kept.quotationNumber, kept.clientName, kept.createdAt.toISOString()], [doc.quotationNumber, doc.clientName, doc.createdAt.toISOString()], "historical quotations are unchanged");
  }
  let indexes = [];
  for (let i = 0; i < 30 && !indexes.some((x) => x.unique && JSON.stringify(x.key) === JSON.stringify({ companyId: 1, quotationNumber: 1 })); i += 1) {
    indexes = await db.collection("quotations").indexes().catch(() => []);
    await new Promise((r) => setTimeout(r, 200));
  }
  const duplicateInsert = await db.collection("quotations").insertOne({ _id: "q_dup_number", companyId: 10, quotationNumber: `QT-${YEAR}-500`, clientName: "dup" }).then(() => null, (e) => e);
  assert.equal(duplicateInsert?.code, 11000, "the database refuses a second quotation with the same number in a company");
  pass("numbering: QT-YYYY-NNN from every path (admin, dealer, converted lead, clone), simultaneous creates are unique and consecutive, supplied numbers are never used, historical numbers are untouched, duplicates are refused by the database");

  // ═══ dealer tiers through the real lifecycle ═══
  const addItem = async (cookie, qid, base) => {
    const room = (await api(cookie, "GET", `/api/quotations/${qid}`)).data.rooms[0];
    assert.equal((await api(cookie, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: room.id, productId: base + 1, productVariantId: base + 1, quantity: 1 })).status, 201);
  };
  const ready = async (dealerCookie, base, label) => {
    const q = await api(dealerCookie, "POST", "/api/quotations", { clientName: label, houseTypeId: base + 1 });
    assert.equal(q.status, 201, q.text?.slice(0, 160));
    await addItem(dealerCookie, idOf(q), base);
    return idOf(q);
  };
  const transition = (cookie, qid, action) => api(cookie, "POST", `/api/quotations/${qid}/transition`, { action });
  const tierOf = async (adminCookie, dealerId) => {
    const list = (await api(adminCookie, "GET", "/api/admin/dealers?pageSize=100")).json;
    return (list.data ?? []).find((d) => d.id === dealerId)?.tier;
  };

  const sentOnly = await ready(c.dealerD, 100, "Sent only");
  assert.equal((await markSent(c.dealerD, sentOnly)).status, 200);
  const approvedOnly = await ready(c.dealerD, 100, "Approved only");
  await markSent(c.dealerD, approvedOnly);
  assert.equal((await transition(c.admin, approvedOnly, "approve")).status, 200);
  const rejected = await ready(c.dealerD, 100, "Rejected");
  await markSent(c.dealerD, rejected);
  assert.equal((await transition(c.admin, rejected, "reject")).status, 200);
  const before = await tierOf(c.admin, 4);
  assert.deepEqual([before.category, before.qualifiedCount, before.nextCategory, before.quotationsRequiredForNextCategory], ["bronze", 0, "silver", 5], "draft, sent, approved-only and rejected quotations do not count");

  const deliveredIds = [];
  for (let i = 1; i <= 5; i += 1) {
    const qid = await ready(c.dealerD, 100, `Delivered ${i}`);
    await markSent(c.dealerD, qid);
    assert.equal((await transition(c.admin, qid, "approve")).status, 200);
    const afterApprove = await tierOf(c.admin, 4);
    assert.equal(afterApprove.qualifiedCount, i - 1, `approving ${i} does not count yet`);
    assert.equal((await transition(c.admin, qid, "deliver")).status, 200);
    deliveredIds.push(qid);
    const state = await tierOf(c.admin, 4);
    assert.equal(state.qualifiedCount, i, `delivering ${i} counts`);
    assert.equal(state.category, i < 5 ? "bronze" : "silver", `after ${i} delivered`);
  }
  assert.equal((await transition(c.admin, deliveredIds[4], "deliver")).status >= 400, true, "delivering twice is refused");
  assert.equal((await tierOf(c.admin, 4)).qualifiedCount, 5, "and does not count again");
  const clone2 = await api(c.dealerD, "POST", `/api/quotations/${deliveredIds[0]}/duplicate`, {});
  assert.equal(clone2.status, 201, clone2.text?.slice(0, 160));
  assert.equal((await tierOf(c.admin, 4)).qualifiedCount, 5, "a clone of a delivered quotation does not count until it qualifies itself");
  assert.equal((await api(c.admin, "PATCH", `/api/quotations/${deliveredIds[0]}`, { clientName: "Edited after delivery" })).status >= 400, true, "a delivered quotation cannot be edited");
  const silver = await tierOf(c.admin, 4);
  assert.deepEqual([silver.category, silver.nextCategory, silver.quotationsRequiredForNextCategory, silver.progressPercent], ["silver", "gold", 5, 0]);
  assert.ok(silver.categoryAchievedAt, "the date it was reached is recorded");
  const history = await db.collection("dealercategoryevents").find({ dealerId: 4 }).toArray();
  assert.deepEqual(history.map((e) => [e.fromCategory, e.toCategory, e.source, e.qualifiedCount, e.quotationId]), [["bronze", "silver", "automatic", 5, deliveredIds[4]]], "one history entry, naming the quotation that earned it");
  pass("a dealer reaches Silver on the 5th DELIVERED quotation: approving, sending, rejecting, repeating, cloning and editing never count");

  // Other dealers and companies stay separate
  assert.equal((await tierOf(c.admin, 5)).qualifiedCount, 0, "another dealer of the same company is unaffected");
  for (let i = 1; i <= 5; i += 1) {
    const qid = await ready(c.dealerX, 200, `X delivered ${i}`);
    await markSent(c.dealerX, qid);
    await transition(c.adminB, qid, "approve");
    assert.equal((await transition(c.adminB, qid, "deliver")).status, 200);
  }
  assert.equal((await tierOf(c.adminB, 6)).category, "silver", "company 2's dealer earned Silver on their own");
  assert.equal((await tierOf(c.admin, 4)).qualifiedCount, 5, "and company 1's dealer did not change");
  assert.equal((await db.collection("dealercategoryevents").countDocuments({ companyId: 10 })), 1, "company 1's history has only its own entry");
  const crossList = (await api(c.admin, "GET", "/api/admin/dealers?pageSize=100")).json;
  assert.ok(!(crossList.data ?? []).some((d) => d.id === 6), "company 1 cannot see company 2's dealer");
  assert.equal((await api(c.admin, "GET", "/api/admin/dealers/6")).status, 404);
  pass("tier counts are per dealer and per company: other dealers and the other company's dealers do not affect each other and cannot be seen");

  // The detail view: category, history, the exact qualifying quotations
  const detail = (await api(c.admin, "GET", "/api/admin/dealers/4")).json;
  assert.deepEqual([detail.performance.category, detail.performance.qualifiedCount], ["silver", 5]);
  assert.deepEqual(detail.performance.qualifyingQuotations.map((q) => q.id).sort(), [...deliveredIds].sort(), "exactly the delivered quotations are listed");
  assert.equal(detail.performance.history.length, 1);
  assert.equal(detail.performance.history[0].quotationId, deliveredIds[4]);
  assert.ok(!JSON.stringify(detail.performance).match(/estimatedEarning|cost|margin|passwordHash/i), "no earnings, costs or margins in the performance section");
  pass("the dealer detail lists the exact quotations that count, the category history, and nothing commercial");

  // ═══ Super Admin correction ═══
  const correct = (cookie, id, body) => api(cookie, "POST", `/api/admin/dealers/${id}/category`, body);
  assert.equal((await correct(c.admin, 4, { category: "gold", reason: "Recognised legacy sales" })).status, 403, "an admin cannot correct a category");
  assert.equal((await correct(c.owner, 4, { category: "gold", reason: "Recognised legacy sales" })).status, 403, "nor a company owner");
  assert.equal((await correct(c.dealerD, 4, { category: "diamond", reason: "I deserve it" })).status >= 400, true, "nor the dealer");
  assert.equal((await correct("", 4, { category: "gold", reason: "no session at all" })).status, 401);
  const noCompany = await correct(c.super, 4, { category: "gold", reason: "Recognised legacy sales" });
  assert.equal(noCompany.status, 403, "a Super Admin must first act as the company");
  assert.equal(noCompany.json?.error?.details?.reason, "COMPANY_CONTEXT_REQUIRED");
  const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: c.super }, body: JSON.stringify({ companyId: 10, reason: "tier correction test" }) });
  assert.equal(act.status, 200);
  const acting = [c.super, ...act.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ");
  assert.equal((await correct(acting, 4, { category: "mythic", reason: "valid reason text" })).status, 400, "unknown category");
  assert.equal((await correct(acting, 4, { category: "gold" })).status, 400, "reason required");
  assert.equal((await correct(acting, 4, { category: "gold", reason: "abc" })).status, 400, "reason too short");
  assert.equal((await correct(acting, 4, { category: "silver", reason: "Already silver here" })).status, 409, "already in that category");
  assert.equal((await correct(acting, 6, { category: "gold", reason: "Another company's dealer" })).status, 404, "a dealer of another company cannot be corrected while acting as company 10");
  assert.equal((await db.collection("adminusers").findOne({ _id: 4 })).dealerTier.category, "silver", "refused corrections changed nothing");
  const ok = await correct(acting, 4, { category: "gold", reason: "Recognised 5 legacy deliveries from before the system" });
  assert.equal(ok.status, 200, ok.text?.slice(0, 200));
  assert.equal(ok.data.to, "gold");
  const manual = await db.collection("dealercategoryevents").findOne({ dealerId: 4, source: "manual" });
  assert.deepEqual([manual.fromCategory, manual.toCategory, manual.performedBy, manual.reason], ["silver", "gold", 1, "Recognised 5 legacy deliveries from before the system"], "audited: who, what, why");
  assert.equal((await tierOf(c.admin, 4)).category, "gold", "the list shows the corrected category");
  pass("manual correction: Super Admin only, acting as the company, with a valid category and written reason; refused for admins, owners, dealers and other companies; audited");

  // ═══ the dashboard shows real numbers ═══
  // The admin area draws its pages in the browser, so the HTML the server sends holds the dashboard's DATA (the page payload),
  // not its markup. The dealer category card is fed by `dealerTiers.dealersByCategory` in that payload.
  const dashboardResponse = await fetch(`${baseUrl}/admin/dashboard?tab=dealers`, { headers: { Cookie: c.admin } });
  const html = await dashboardResponse.text();
  const payload = html.replace(/\\"/g, '"');
  const categoriesIn = (source) => {
    const block = source.match(/"dealersByCategory":\{([^}]*)\}/)?.[1] ?? "";
    return ["bronze", "silver", "gold", "platinum", "diamond"].map((key) => Number(block.match(new RegExp(`"${key}":(\\d+)`))?.[1]));
  };
  const diagnostics = `status ${dashboardResponse.status}, ${html.length} bytes, dealersByCategory:${payload.includes("dealersByCategory")}`;
  assert.deepEqual(categoriesIn(payload), [1, 0, 1, 0, 0], `company 1: dealer E Bronze, dealer D Gold (corrected) [${diagnostics}]`);
  assert.match(payload, /"upgradesInPeriod":\d+/);
  assert.ok(!html.includes("Illustrative preview"), "the dealer category card is real data: no demo fixtures on the page");
  const htmlB = (await (await fetch(`${baseUrl}/admin/dashboard?tab=dealers`, { headers: { Cookie: c.adminB } })).text()).replace(/\\"/g, '"');
  assert.deepEqual(categoriesIn(htmlB), [0, 1, 0, 0, 0], "company 2 sees only its own dealer");
  pass("the dashboard's dealer category card shows each company's own real numbers");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(server.getOutput?.().slice(-2500));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
