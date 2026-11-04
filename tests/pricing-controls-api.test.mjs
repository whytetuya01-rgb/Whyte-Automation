/**
 * Pricing controls and pipeline probabilities through the real API (isolated production server, throwaway MongoDB).
 *
 *  1. Custom unit price: only the Company Owner and an Admin. A dealer, a sales executive, a custom-role admin and a
 *     Super Admin are refused, change nothing and leave no audit row. Putting the catalogue price back, or re-sending the
 *     price already there, is not an override and is allowed.
 *  2. Item discounts: Owner and Admin; a Super Admin only while acting within a selected company (and still not a custom
 *     price). Totals follow the final unit price; the GST split follows it too.
 *  3. Every custom price, reset, discount and removal is in the quotation's audit trail with who, before and after.
 *  4. CRM stage probabilities: company-scoped, Owner/Admin only to change, validated, and they weight ONLY the pipeline
 *     forecast: quotation totals and the cards' real value do not move.
 *
 *   node tests/pricing-controls-api.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let server;
let exitCode = 0;
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };

try {
  server = await startIsolatedServer("pricing-controls", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Adi Admin", companyId: 10 },
    { _id: 3, email: "dealer@example.com", role: "dealer", name: "Dealer A", companyId: 10, discountAllocationPercent: 10 },
    { _id: 4, email: "custom@example.com", role: "configurable_admin", name: "Custom", companyId: 10, permissions: ["quotations:read_all", "quotations:edit_all", "quotations:create"] },
    { _id: 5, email: "adminb@example.com", role: "admin", name: "Admin B", companyId: 20 },
    { _id: 6, email: "sales@example.com", role: "sales_executive", name: "Sam Sales", companyId: 10 },
    { _id: 7, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 8, email: "crmcustom@example.com", role: "configurable_admin", name: "CRM Custom", companyId: 10, permissions: ["crm:manage"] },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  for (const [id, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const money = (value) => Decimal128.fromString(Number(value).toFixed(2));
  await db.collection("products").insertOne({ _id: 1, companyId: 10, name: "Smart Switch", code: "SW-1", isActive: true, createdAt: now, updatedAt: now });
  await db.collection("quotations").insertOne({ _id: "q_open", quotationNumber: "QT-2026-0001", companyId: 10, clientName: "Asha Patel", status: "draft", dealerId: 3, createdBy: "3", createdAt: now, updatedAt: now });
  await db.collection("quotationrooms").insertOne({ _id: 1, companyId: 10, quotationId: "q_open", roomTypeId: null, customName: "Living", sortOrder: 0 });
  const item = (id, extra = {}) => ({ _id: id, companyId: 10, quotationRoomId: 1, productId: 1, productVariantId: null, quantity: 2, unitPrice: money(1000), priceWithoutTax: money(847.46), taxPercent: money(18), taxAmount: money(152.54), isCustomPrice: false, originalUnitPrice: null, sortOrder: id, ...extra });
  await db.collection("quotationitems").insertMany([item(1), item(2), item(3)]);

  const cookie = {
    owner: await login("owner@example.com", "admin"),
    admin: await login("admin@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
    custom: await login("custom@example.com", "admin"),
    adminB: await login("adminb@example.com", "admin"),
    sales: await login("sales@example.com", "user"),
    super: await login("super@example.com", "admin"),
    crmCustom: await login("crmcustom@example.com", "admin"),
  };
  const patch = (who, id, body) => api(cookie[who], "PATCH", `/api/quotations/q_open/items/${id}`, body);
  const stored = async (id = 1) => {
    const doc = await db.collection("quotationitems").findOne({ _id: id });
    return { unit: Number(String(doc.unitPrice)), net: Number(String(doc.priceWithoutTax)), tax: Number(String(doc.taxAmount)), custom: doc.isCustomPrice, type: doc.discountType ?? null, pre: doc.preDiscountUnitPrice == null ? null : Number(String(doc.preDiscountUnitPrice)) };
  };
  const events = (action) => db.collection("quotationauditevents").find(action ? { action } : {}).sort({ performedOn: 1 }).toArray();

  // ── 1. custom unit price ──
  for (const who of ["dealer", "sales", "custom"]) {
    const refused = await patch(who, 1, { unitPrice: 700 });
    assert.ok([403, 404].includes(refused.status), `${who} must be refused (${refused.status})`);
  }
  assert.equal((await patch("dealer", 1, { unitPrice: 700 })).status, 403, "a dealer cannot override a price, even on their own quotation");
  assert.deepEqual(await stored(), { unit: 1000, net: 847.46, tax: 152.54, custom: false, type: null, pre: null }, "refused attempts changed nothing");
  assert.equal((await events()).length, 0, "refused attempts left no audit row");
  pass("a dealer, a sales executive and a custom-role admin cannot set a custom unit price; nothing changes, nothing is audited");

  const owner = await patch("owner", 1, { unitPrice: 700 });
  assert.equal(owner.status, 200, owner.text?.slice(0, 300));
  const afterOwner = await stored();
  assert.equal(afterOwner.unit, 700);
  assert.equal(afterOwner.custom, true);
  assert.ok(Math.abs(afterOwner.tax - (700 - 700 / 1.18)) < 0.02, "GST split follows the custom price");
  assert.equal((await patch("admin", 2, { unitPrice: 1200 })).status, 200, "an Admin may too");
  assert.equal((await patch("dealer", 1, { unitPrice: 700 })).status, 200, "re-sending the price already there is not an override");
  assert.equal((await events("item_price_overridden")).length, 2, "only the two real overrides are audited");
  pass("the Company Owner and an Admin can set a custom unit price; GST split follows; a no-op resend is harmless and not audited");

  const dealerReset = await patch("dealer", 1, { resetToDefaultPrice: true });
  assert.equal(dealerReset.status, 200, "putting the catalogue price back is not an override");
  assert.equal((await stored()).custom, false);
  const resets = await events("item_price_reset");
  assert.equal(resets.length, 1);
  assert.equal(resets[0].performedBy, 3);
  pass("anyone who can edit the quotation can put a line back to the catalogue price, and it is audited");

  // ── 2/3. discounts: owner/admin, audit, totals ──
  const pct = await patch("admin", 3, { discountType: "percentage", discountValue: 10 });
  assert.equal(pct.status, 200, pct.text?.slice(0, 300));
  const disc = await stored(3);
  assert.deepEqual([disc.unit, disc.pre, disc.type], [900, 1000, "percentage"]);
  assert.ok(Math.abs(disc.tax - (900 - 900 / 1.18)) < 0.02, "GST split follows the final unit price");
  const applied = await events("item_discount_applied");
  assert.equal(applied.length, 1);
  assert.deepEqual([applied[0].performedBy, applied[0].previousValue.unitPrice, applied[0].newValue.unitPrice, applied[0].newValue.discountType, applied[0].newValue.discountValue], [2, 1000, 900, "percentage", 10]);
  assert.equal(applied[0].metadata.productName, "Smart Switch");
  assert.equal(applied[0].metadata.actingAsCompany, false);
  assert.equal((await patch("admin", 3, { discountType: "none" })).status, 200);
  assert.equal((await events("item_discount_removed")).length, 1);
  assert.equal((await stored(3)).unit, 1000);
  assert.equal((await events("item_discount_applied")).length, 1);
  pass("a discount sets the final unit price and GST split; applying and removing it are audited with who, before and after");

  // ── 2. Super Admin: only within a selected company ──
  const noContext = await patch("super", 3, { discountType: "percentage", discountValue: 5 });
  assert.ok(noContext.status >= 400, `a Super Admin with no company selected is refused (${noContext.status})`);
  assert.equal((await stored(3)).type, null);
  await db.collection("platformaccesslogs").insertOne({ _id: "grant_company_10", superAdminUserId: 7, companyId: 10, reason: "pricing test", startedAt: new Date(), endedAt: null });
  const acting = `${cookie.super}; whyte_act_as=grant_company_10`;
  const superDiscount = await api(acting, "PATCH", "/api/quotations/q_open/items/3", { discountType: "fixed", discountValue: 100 });
  assert.equal(superDiscount.status, 200, superDiscount.text?.slice(0, 300));
  assert.deepEqual(await stored(3).then((s) => [s.unit, s.type]), [900, "fixed"]);
  const superEvent = (await events("item_discount_applied")).at(-1);
  assert.deepEqual([superEvent.performedBy, superEvent.metadata.role, superEvent.metadata.actingAsCompany], [7, "super_admin", true], "the audit row records the Super Admin acting within the company");
  const superPrice = await api(acting, "PATCH", "/api/quotations/q_open/items/2", { unitPrice: 500 });
  assert.equal(superPrice.status, 403, "acting within a company does not allow a custom price");
  assert.equal((await stored(2)).unit, 1200);
  await db.collection("platformaccesslogs").updateOne({ _id: "grant_company_10" }, { $set: { endedAt: new Date() } });
  const ended = await api(acting, "PATCH", "/api/quotations/q_open/items/3", { discountType: "none" });
  assert.ok(ended.status >= 400, `once the grant has ended the Super Admin is refused again (${ended.status})`);
  pass("a Super Admin can discount only inside an active act-as company (audited as such), never set a custom price, and loses it when the grant ends");

  // ── totals follow the final unit price (and nothing else) ──
  const lineTotals = (await db.collection("quotationitems").find({}).toArray()).reduce((sum, row) => sum + Number(String(row.unitPrice)) * row.quantity, 0);
  assert.equal(lineTotals, 1000 * 2 + 1200 * 2 + 900 * 2, "the subtotal is the sum of final unit price x quantity");
  pass("quotation subtotal = final unit price x quantity per line (discounts and overrides flow through, nothing is double counted)");

  // ── another company's admin can do nothing here ──
  assert.ok((await patch("adminB", 1, { unitPrice: 600 })).status >= 400);
  assert.ok((await patch("adminB", 1, { discountType: "percentage", discountValue: 10 })).status >= 400);
  pass("another company's admin can neither override a price nor discount");

  // ── 4. stage probabilities ──
  const get = (who) => api(cookie[who], "GET", "/api/crm/stage-probabilities");
  const first = await get("admin");
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.stages, { new: 10, contacted: 25, site_visit: 40, quoted: 60, negotiation: 80, won: 100, lost: 0 }, "built-in defaults at first");
  assert.equal(first.data.canManage, true);
  assert.equal((await get("dealer")).status === 200 ? (await get("dealer")).data.canManage : false, false, "a dealer can never manage them");
  const SET = { new: 15, contacted: 30, site_visit: 45, quoted: 70, negotiation: 85 };
  for (const who of ["dealer", "sales"]) assert.equal((await api(cookie[who], "PUT", "/api/crm/stage-probabilities", SET)).status, 403, `${who} cannot change them`);
  assert.equal((await api(cookie.super, "PUT", "/api/crm/stage-probabilities", SET)).status >= 400, true, "a Super Admin with no company has none to change");
  for (const [body, why] of [
    [{ ...SET, quoted: 101 }, "over 100"],
    [{ ...SET, quoted: -1 }, "negative"],
    [{ ...SET, quoted: 60.5 }, "fraction"],
    [{ ...SET, quoted: "60" }, "text"],
    [{ ...SET, won: 50 }, "won is fixed"],
    [{ new: 1, contacted: 2, site_visit: 3, quoted: 4 }, "a stage missing"],
  ]) assert.equal((await api(cookie.admin, "PUT", "/api/crm/stage-probabilities", body)).status, 400, `${why} is refused`);
  assert.deepEqual((await get("admin")).data.stages.quoted, 60, "refused values changed nothing");
  pass("stage probabilities: defaults first; dealer and sales executive cannot change; bad values are refused and change nothing");

  // a deal in each of two stages; one with its own override; and a quotation total we will check does not move
  await db.collection("leads").insertMany([
    { _id: "lead_q", companyId: 10, referenceNumber: "LD-1", customerName: "Quoted Deal", status: "quoted", estimatedBudget: 100000, priority: "medium", createdBy: 2, createdAt: now, updatedAt: now },
    { _id: "lead_n", companyId: 10, referenceNumber: "LD-2", customerName: "Negotiation Deal", status: "negotiation", estimatedBudget: 200000, priority: "medium", createdBy: 2, createdAt: now, updatedAt: now },
    { _id: "lead_o", companyId: 10, referenceNumber: "LD-3", customerName: "Overridden Deal", status: "quoted", estimatedBudget: 100000, probability: 90, priority: "medium", createdBy: 2, createdAt: now, updatedAt: now },
    { _id: "lead_w", companyId: 10, referenceNumber: "LD-4", customerName: "Won Deal", status: "won", estimatedBudget: 50000, priority: "medium", createdBy: 2, createdAt: now, updatedAt: now },
    { _id: "lead_b", companyId: 20, referenceNumber: "LD-5", customerName: "Other Company Deal", status: "quoted", estimatedBudget: 100000, priority: "medium", createdBy: 5, createdAt: now, updatedAt: now },
  ]);
  const board = async (who) => (await api(cookie[who], "GET", "/api/crm/pipeline")).data.flatMap((stage) => stage.items);
  const byName = (cards, name) => cards.find((card) => card.customerName === name);
  const quotationBefore = (await api(cookie.admin, "GET", "/api/quotations/q_open")).data;
  let cards = await board("admin");
  assert.deepEqual([byName(cards, "Quoted Deal").probability, byName(cards, "Quoted Deal").weightedValue], [60, 60000]);

  assert.equal((await api(cookie.owner, "PUT", "/api/crm/stage-probabilities", SET)).status, 200, "the Company Owner sets them");
  cards = await board("admin");
  assert.deepEqual([byName(cards, "Quoted Deal").probability, byName(cards, "Quoted Deal").weightedValue, byName(cards, "Quoted Deal").estimatedValue], [70, 70000, 100000], "weighted value follows; the deal's value does not move");
  assert.deepEqual([byName(cards, "Negotiation Deal").probability, byName(cards, "Negotiation Deal").weightedValue], [85, 170000]);
  assert.deepEqual([byName(cards, "Overridden Deal").probability, byName(cards, "Overridden Deal").weightedValue], [90, 90000], "a lead's own override still wins");
  assert.deepEqual([byName(cards, "Won Deal").probability, byName(cards, "Won Deal").weightedValue], [100, 50000], "won stays 100%");
  assert.equal((await get("admin")).data.stages.negotiation, 85);
  pass("saved stage probabilities weight the pipeline forecast (a lead's override and won/lost are unaffected), the deal's own value does not move");

  const quotationAfter = (await api(cookie.admin, "GET", "/api/quotations/q_open")).data;
  assert.deepEqual(quotationAfter.rooms?.map((room) => room.items?.map((row) => row.unitPrice)), quotationBefore.rooms?.map((room) => room.items?.map((row) => row.unitPrice)), "quotation prices untouched by stage probabilities");
  assert.equal(JSON.stringify(quotationAfter.totals ?? null), JSON.stringify(quotationBefore.totals ?? null), "quotation totals untouched by stage probabilities");
  pass("changing stage probabilities leaves quotation prices and totals exactly as they were");

  // company scoping + other roles reading/writing
  const otherBoard = await board("adminB");
  assert.equal(byName(otherBoard, "Other Company Deal").probability, 60, "another company still uses the defaults");
  assert.equal((await api(cookie.adminB, "GET", "/api/crm/stage-probabilities")).data.stages.quoted, 60);
  assert.equal((await api(cookie.admin, "PUT", "/api/crm/stage-probabilities", { ...SET, quoted: 55 })).status, 200, "an Admin may change them too");
  assert.equal((await api(cookie.adminB, "GET", "/api/crm/stage-probabilities")).data.stages.quoted, 60, "company B unaffected by company A's change");
  assert.equal((await api(cookie.crmCustom, "PUT", "/api/crm/stage-probabilities", { ...SET, quoted: 65 })).status, 200, "a custom admin with crm:manage may");
  assert.equal((await api(cookie.custom, "PUT", "/api/crm/stage-probabilities", SET)).status, 403, "a custom admin without crm:manage may not");
  assert.equal((await get("admin")).data.stages.quoted, 65);
  const companyDocs = await db.collection("companies").find({}).toArray();
  assert.deepEqual(companyDocs.map((c) => [c._id, c.crmSettings?.stageProbabilities?.quoted ?? null]).sort(), [[10, 65], [20, null]], "stored on the company that set it, nowhere else");
  pass("stage probabilities are company-scoped: another company is unaffected; Admin and a CRM-managing custom admin may change them; others may not");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-1500)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
