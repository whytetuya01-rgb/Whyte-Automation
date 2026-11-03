/**
 * Per-product discount through the real API (isolated production server, throwaway MongoDB). Written during development,
 * to run in the final test pass.
 *
 * Only an Admin or a Company Owner can give or remove a discount on one product; a dealer (even the quotation's own),
 * a sales executive and a custom-role admin cannot; the line's unit price becomes the price after the discount (so every
 * total follows) and is always worked out from the price BEFORE the discount (discounts never stack); bad values are
 * refused and change nothing; quantity changes keep the discount; a custom price, reset or another product ends it; a
 * locked quotation and another company's item are refused.
 *
 *   node tests/item-discount-api.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let server;
let exitCode = 0;
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };

try {
  server = await startIsolatedServer("item-discount", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Adi Admin", companyId: 10 },
    { _id: 3, email: "dealer@example.com", role: "dealer", name: "Dealer A", companyId: 10, discountAllocationPercent: 10 },
    { _id: 4, email: "custom@example.com", role: "configurable_admin", name: "Custom", companyId: 10, permissions: ["quotations:read_all", "quotations:edit_all", "quotations:create"] },
    { _id: 5, email: "adminb@example.com", role: "admin", name: "Admin B", companyId: 20 },
  ], { production: true });
  const { db, login, api } = server;
  const now = new Date();
  for (const [id, name] of [[10, "Acme Homes"], [20, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: id, name, slug: `c${id}`, status: "active", phone: "1", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const money = (value) => Decimal128.fromString(Number(value).toFixed(2));
  await db.collection("quotations").insertMany([
    { _id: "q_open", quotationNumber: "QT-2026-0001", companyId: 10, clientName: "Asha Patel", status: "draft", dealerId: 3, createdBy: "3", createdAt: now, updatedAt: now },
    { _id: "q_locked", quotationNumber: "QT-2026-0002", companyId: 10, clientName: "Locked Client", status: "approved", dealerId: 3, createdBy: "3", createdAt: now, updatedAt: now },
  ]);
  await db.collection("quotationrooms").insertMany([
    { _id: 1, companyId: 10, quotationId: "q_open", roomTypeId: null, customName: "Living", sortOrder: 0 },
    { _id: 2, companyId: 10, quotationId: "q_locked", roomTypeId: null, customName: "Hall", sortOrder: 0 },
  ]);
  const item = (id, room, extra = {}) => ({ _id: id, companyId: 10, quotationRoomId: room, productId: 1, productVariantId: null, quantity: 2, unitPrice: money(1000), priceWithoutTax: money(847.46), taxPercent: money(18), taxAmount: money(152.54), isCustomPrice: false, sortOrder: 0, ...extra });
  await db.collection("quotationitems").insertMany([item(1, 1), item(2, 2)]);

  const cookie = {
    owner: await login("owner@example.com", "admin"),
    admin: await login("admin@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
    custom: await login("custom@example.com", "admin"),
    adminB: await login("adminb@example.com", "admin"),
  };
  const patch = (who, id, body, quotation = "q_open") => api(cookie[who], "PATCH", `/api/quotations/${quotation}/items/${id}`, body);
  const stored = async (id = 1) => {
    const doc = await db.collection("quotationitems").findOne({ _id: id });
    return { unit: Number(String(doc.unitPrice)), pre: doc.preDiscountUnitPrice == null ? null : Number(String(doc.preDiscountUnitPrice)), type: doc.discountType ?? null, value: doc.discountValue ?? null, custom: doc.isCustomPrice, qty: doc.quantity, taxAmount: Number(String(doc.taxAmount)) };
  };

  // ── who may ──
  for (const who of ["dealer", "custom", "adminB"]) {
    const refused = await patch(who, 1, { discountType: "percentage", discountValue: 10 });
    assert.ok([403, 404].includes(refused.status), `${who} must be refused (${refused.status})`);
  }
  assert.equal((await patch("dealer", 1, { discountType: "percentage", discountValue: 10 })).status, 403, "a dealer cannot, even on their own quotation");
  assert.deepEqual((await stored()).type, null, "nothing was stored by the refused attempts");
  pass("a dealer (even on their own quotation), a custom-role admin and another company's admin cannot give a discount");

  // ── percentage, then fixed (never stacking), then remove ──
  const pct = await patch("admin", 1, { discountType: "percentage", discountValue: 10 });
  assert.equal(pct.status, 200, pct.text?.slice(0, 300));
  assert.deepEqual(await stored(), { unit: 900, pre: 1000, type: "percentage", value: 10, custom: true, qty: 2, taxAmount: (await stored()).taxAmount });
  assert.equal(pct.data.unitPrice, "900.00", "the response carries the new price");
  assert.deepEqual([pct.data.discountType, pct.data.discountValue, pct.data.preDiscountUnitPrice], ["percentage", 10, "1000.00"]);
  const fixed = await patch("owner", 1, { discountType: "fixed", discountValue: 150 });
  assert.equal(fixed.status, 200);
  assert.deepEqual(await stored().then(({ unit, pre, type, value }) => ({ unit, pre, type, value })), { unit: 850, pre: 1000, type: "fixed", value: 150 }, "worked out from the price before, not on top of the last discount");
  const taxAfter = await stored();
  assert.ok(Math.abs(taxAfter.taxAmount - (850 - 850 / 1.18)) < 0.02, "the GST split follows the new price");
  assert.equal((await patch("admin", 1, { quantity: 5 })).status, 200);
  assert.deepEqual(await stored().then(({ unit, type, qty }) => ({ unit, type, qty })), { unit: 850, type: "fixed", qty: 5 }, "a quantity change keeps the per-unit discount");
  const removed = await patch("admin", 1, { discountType: "none" });
  assert.equal(removed.status, 200);
  assert.deepEqual(await stored().then(({ unit, pre, type, value, custom }) => ({ unit, pre, type, value, custom })), { unit: 1000, pre: null, type: null, value: null, custom: false }, "removing restores the price before the discount");
  pass("an Admin or Owner gives a percentage or fixed discount; the unit price and GST split follow; it never stacks; a quantity change keeps it; removing restores the price");

  // ── refused values change nothing ──
  await patch("admin", 1, { discountType: "percentage", discountValue: 10 });
  for (const [body, why] of [
    [{ discountType: "percentage", discountValue: 0 }, "zero"],
    [{ discountType: "percentage", discountValue: -5 }, "negative"],
    [{ discountType: "percentage", discountValue: 100.5 }, "over 100%"],
    [{ discountType: "fixed", discountValue: 1000.01 }, "more than the price"],
    [{ discountType: "percentage", discountValue: 10.123 }, "3 decimals"],
    [{ discountType: "percentage" }, "no value"],
    [{ discountType: "bogus", discountValue: 5 }, "unknown type"],
    [{ discountType: "percentage", discountValue: 10, unitPrice: 500 }, "a discount and a custom price together"],
  ]) {
    const refused = await patch("admin", 1, body);
    assert.equal(refused.status, 400, `${why} must be a 400 (${refused.status})`);
    assert.equal((await stored()).unit, 900, `${why} changed nothing`);
  }
  pass("zero, negative, over 100%, more than the price, 3 decimals, no value, an unknown type and a discount plus a custom price are all refused, and change nothing");

  // ── other ways of changing the price end the discount ──
  assert.equal((await patch("admin", 1, { unitPrice: 700 })).status, 200);
  assert.deepEqual(await stored().then(({ unit, type, pre, custom }) => ({ unit, type, pre, custom })), { unit: 700, type: null, pre: null, custom: true }, "a custom price replaces the discount");
  assert.equal((await patch("admin", 1, { discountType: "percentage", discountValue: 20 })).status, 200);
  assert.deepEqual(await stored().then(({ unit, pre }) => ({ unit, pre })), { unit: 560, pre: 700 }, "a discount on a custom price starts from that price");
  assert.equal((await patch("admin", 1, { resetToDefaultPrice: true })).status, 200);
  assert.equal((await stored()).type, null, "back to the catalogue price ends the discount");
  pass("a custom price or a reset to the catalogue price ends a discount, and a new discount starts from the price then in force");

  // ── locked and other company ──
  assert.ok([400, 403, 409].includes((await patch("admin", 2, { discountType: "percentage", discountValue: 10 }, "q_locked")).status), "an approved quotation cannot be discounted");
  assert.equal((await stored(2)).type, null);
  assert.equal((await patch("adminB", 1, { discountType: "percentage", discountValue: 10 })).status >= 400, true);
  pass("an approved quotation and another company's quotation cannot be discounted");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-1500)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
