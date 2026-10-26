/**
 * Unit tests for the Product Configuration improvements:
 *  - quantity input parsing (empty, zero, negative, decimal, text, exponent, too large)
 *  - space name validation
 *  - flat vs multi-floor label display (display-only: stored floor values are untouched)
 *  - API quantity schemas (whole numbers, shared maximum)
 *
 * Run with:
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/space-config-quantity.test.ts
 */
import assert from "node:assert/strict";
import { MAX_ITEM_QUANTITY, parseQuantityInput } from "../src/lib/quantity";
import { MAX_SPACE_NAME_LENGTH, validateSpaceName } from "../src/lib/spaceName";
import { getRoomDisplayName, getRoomFloorLabel, getRoomFullTitle, isMultiFloorHouseType } from "../src/lib/roomUtils";
import { createQuotationItemSchema, updateQuotationItemSchema } from "../src/lib/validation/quotation";
import type { QuotationRoom } from "../src/types";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

const room = (id: number, name: string, subArea: string | null = null, roomTypeId: number | null = id): QuotationRoom => ({
  id,
  quotationId: "q1",
  roomTypeId,
  roomType: roomTypeId ? { id: roomTypeId, name, icon: null } : undefined,
  customName: null,
  subArea,
  notes: null,
  sortOrder: id,
  items: [],
} as unknown as QuotationRoom);

// ── quantity parsing ────────────────────────────────────────────────
{
  const ok = (raw: string, value: number) => {
    const r = parseQuantityInput(raw);
    assert.deepEqual(r, { ok: true, value }, `"${raw}"`);
  };
  const bad = (raw: string, pattern: RegExp) => {
    const r = parseQuantityInput(raw);
    assert.equal(r.ok, false, `"${raw}" must be rejected`);
    if (!r.ok) assert.match(r.message, pattern, `"${raw}" message`);
  };
  ok("1", 1);
  ok("5", 5);
  ok("  12 ", 12);
  ok("007", 7);
  ok(String(MAX_ITEM_QUANTITY), MAX_ITEM_QUANTITY);
  bad("", /enter a quantity/i);
  bad("   ", /enter a quantity/i);
  bad("0", /at least 1/i);
  bad("000", /at least 1/i);
  bad("-1", /negative/i);
  bad("-0", /negative/i);
  bad("2.5", /whole number/i);
  bad("3.", /whole number/i);
  bad(".5", /whole number/i);
  bad("abc", /digits only/i);
  bad("1e3", /digits only/i);
  bad("5 6", /digits only/i);
  bad("+5", /digits only/i);
  bad(String(MAX_ITEM_QUANTITY + 1), /more than/i);
  bad("99999999999999999999", /more than/i);
  pass("quantity input: accepts whole numbers 1..max; rejects empty, zero, negative, decimal, text, exponent and oversize with a message");
}

// ── space names ─────────────────────────────────────────────────────
{
  assert.deepEqual(validateSpaceName("  Person A Room  "), { ok: true, value: "Person A Room" });
  assert.deepEqual(validateSpaceName("Parents' Bedroom"), { ok: true, value: "Parents' Bedroom" });
  assert.deepEqual(validateSpaceName("Guest Room"), { ok: true, value: "Guest Room" });
  assert.equal(validateSpaceName("").ok, false);
  assert.equal(validateSpaceName("   ").ok, false);
  assert.equal(validateSpaceName("x".repeat(MAX_SPACE_NAME_LENGTH)).ok, true);
  assert.equal(validateSpaceName("x".repeat(MAX_SPACE_NAME_LENGTH + 1)).ok, false);
  assert.equal(validateSpaceName("Bed\u0000room").ok, false);
  pass("space names: trims, allows apostrophes, rejects empty / over 120 characters / control characters");
}

// ── flat vs multi-floor ─────────────────────────────────────────────
{
  const living = room(1, "Living Room", "Ground Floor");
  const master = room(2, "Master Bedroom");
  const all = [living, master];
  const snapshot = JSON.parse(JSON.stringify(all));

  // flats: no floor label anywhere, however the floor was stored or defaulted
  for (const name of ["1 BHK", "2 BHK", "3 BHK", "Apartment", "Studio"]) {
    assert.equal(isMultiFloorHouseType({ name }), false, name);
    assert.equal(getRoomFloorLabel(living, all, false), null);
    assert.equal(getRoomFloorLabel(master, all, false), null);
    assert.equal(getRoomFullTitle(living, all, false), "Living Room", `${name}: no floor in the title`);
    assert.equal(getRoomFullTitle(master, all, false), "Master Bedroom");
  }
  // multi-floor houses keep the real floor
  for (const name of ["Villa", "Duplex 4 BHK", "Bungalow", "Row House", "Penthouse"]) {
    assert.equal(isMultiFloorHouseType({ name }), true, name);
  }
  assert.equal(getRoomFloorLabel(living, all, true), "Ground Floor");
  assert.equal(getRoomFullTitle(living, all, true), "Living Room · Ground Floor");
  assert.equal(getRoomFullTitle(master, all, true), "Master Bedroom · First Floor", "multi-floor default floor still applies");
  assert.equal(getRoomFloorLabel(room(3, "Terrace Lounge", "Unspecified Location"), all, true) !== "Unspecified Location", true);
  // an explicit property flag beats the name
  assert.equal(isMultiFloorHouseType({ name: "Villa", isMultiFloor: false }), false);
  assert.equal(isMultiFloorHouseType({ name: "2 BHK", isMultiFloor: true }), true);
  // hiding the label changes nothing that is stored
  assert.deepEqual(JSON.parse(JSON.stringify(all)), snapshot, "rooms are not mutated by label rendering");
  assert.equal(living.subArea, "Ground Floor", "the stored floor value is preserved");
  pass("flats hide floor labels and keep stored values; villa / duplex / bungalow keep the actual floor; explicit isMultiFloor wins over the name");
}

// ── renamed space shows its custom name everywhere the helpers are used ──
{
  const a = { ...room(1, "Bedroom"), customName: "Person A Room" } as QuotationRoom;
  const b = room(2, "Bedroom");
  assert.equal(getRoomDisplayName(a, [a, b]), "Person A Room");
  assert.equal(getRoomDisplayName(b, [a, b]), "Bedroom");
  assert.equal(getRoomFullTitle(a, [a, b], false), "Person A Room");
  assert.equal(a.roomTypeId, 1, "room type reference preserved");
  pass("a renamed space displays its custom name (flat and multi-floor) and keeps its room type reference");
}

// ── API quantity schemas ───────────────────────────────────────────
{
  const base = { quotationRoomId: 1, productId: 1 };
  const create = (quantity: unknown) => createQuotationItemSchema.safeParse({ ...base, quantity });
  assert.equal(create(5).success, true);
  assert.equal(create("5").success, true);
  assert.equal(create(MAX_ITEM_QUANTITY).success, true);
  assert.equal(create(MAX_ITEM_QUANTITY + 1).success, false);
  assert.equal(create(2.5).success, false);
  assert.equal(create(-1).success, false);
  assert.equal(create("").success, false);
  assert.equal(create("abc").success, false);
  assert.equal(createQuotationItemSchema.safeParse(base).success, true, "quantity stays optional on create");
  const update = (quantity: unknown) => updateQuotationItemSchema.safeParse({ quantity });
  assert.equal(update(7).success, true);
  assert.equal(update(0).success, true, "PATCH keeps accepting 0 exactly as before");
  assert.equal(update(MAX_ITEM_QUANTITY + 1).success, false);
  assert.equal(update(1.5).success, false);
  assert.equal(update(-2).success, false);
  pass("item create / update schemas: whole numbers up to the shared maximum; decimals, negatives and oversize are rejected");
}

console.log(`\n${count} checks passed.`);
