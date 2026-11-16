import assert from "node:assert/strict";
import { createQuotationSchema } from "../src/lib/validation/quotation";
import { isBathroomLikeRoomName } from "../src/lib/utils";
import { calculateDealerEarning, customerDiscountError } from "../src/lib/dealerEarnings";
import Quotation from "../src/models/Quotation";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

function main() {
  console.log("\n--- Testing Phase 5: Quotation Creation API & Database Optimization ---");

  // 1. Validation Schema: Client details and premises
  const validCreation = createQuotationSchema.safeParse({
    clientName: "Rohan Mehta",
    clientPhone: "+91 98765 43210",
    clientEmail: "rohan@example.com",
    clientAddress: "12 Palm Grove, Mumbai",
    premisesName: "4BHK Luxury Apartment",
    discountType: "percentage",
    customerDiscountPercent: 10,
  });
  assert.equal(validCreation.success, true, "Valid quotation creation schema must pass");
  if (validCreation.success) {
    assert.equal(validCreation.data.clientName, "Rohan Mehta");
    assert.equal(validCreation.data.customerDiscountPercent, 10);
  }
  pass("1. Quotation creation schema validates client details, premises, and discount");

  // 2. Validation Schema: Missing client name rejected
  const missingName = createQuotationSchema.safeParse({
    clientPhone: "+91 98765 43210",
    premisesName: "Villa",
  });
  assert.equal(missingName.success, false, "Missing clientName must fail schema validation");
  pass("2. Quotation creation schema strictly rejects submissions without client name");

  // 3. Dealer Discount Allocation Rules
  const validDealerDiscount = customerDiscountError({
    hasDealer: true,
    allocatedPercent: 20,
    customerPercent: 15,
    actorIsDealer: true,
  });
  assert.equal(validDealerDiscount, null, "Customer discount within allocated percent must be permitted");

  const excessiveDealerDiscount = customerDiscountError({
    hasDealer: true,
    allocatedPercent: 15,
    customerPercent: 25,
    actorIsDealer: true,
  });
  assert.notEqual(excessiveDealerDiscount, null, "Customer discount exceeding dealer allocation must be rejected");
  pass("3. Dealer discount allocation validation strictly enforces discount limits");

  // 4. Dealer Earnings Computation
  const earnings = calculateDealerEarning({
    subtotal: 100000,
    allocatedPercent: 20,
    customerPercent: 5,
  });
  assert.equal(earnings.earningPercent, 15, "Dealer earning percent must equal allocated minus customer percent");
  pass("4. Dealer earning percentage is computed accurately (allocated - customer discount)");

  // 5. Bathroom-like room filtering during room generation
  assert.equal(isBathroomLikeRoomName("Master Bathroom"), true);
  assert.equal(isBathroomLikeRoomName("Guest Toilet"), true);
  assert.equal(isBathroomLikeRoomName("Common Washroom"), true);
  assert.equal(isBathroomLikeRoomName("Living Room"), false);
  assert.equal(isBathroomLikeRoomName("Master Bedroom"), false);
  assert.equal(isBathroomLikeRoomName("Home Theater"), false);
  pass("5. Bathroom-like room filtering correctly identifies and excludes non-habitable automation spaces");

  // 6. House Type Template Room Mapping Simulation
  const mockTemplates = [
    { roomTypeId: 101, roomType: { name: "Living Room" }, defaultCount: 1, sortOrder: 1 },
    { roomTypeId: 102, roomType: { name: "Master Bathroom" }, defaultCount: 2, sortOrder: 2 },
    { roomTypeId: 103, roomType: { name: "Master Bedroom" }, defaultCount: 2, sortOrder: 3 },
  ];

  const validTemplates = mockTemplates.filter((t) => {
    return Boolean(t.roomType) && !isBathroomLikeRoomName(t.roomType?.name);
  });
  assert.equal(validTemplates.length, 2, "Bathrooms must be filtered out of templates");

  const totalRooms = validTemplates.reduce((sum, t) => sum + (Number(t.defaultCount) || 1), 0);
  assert.equal(totalRooms, 3, "Total rooms should sum Living Room (1) + Master Bedroom (2)");

  const mockRoomIds = [5001, 5002, 5003];
  let cursor = 0;
  const roomsToCreate = [];
  for (const t of validTemplates) {
    const defaultCount = Number(t.defaultCount) || 1;
    for (let i = 0; i < defaultCount; i++) {
      roomsToCreate.push({
        _id: mockRoomIds[cursor++],
        quotationId: "q_test_123",
        roomTypeId: t.roomTypeId,
        sortOrder: t.sortOrder * 10 + i,
      });
    }
  }
  assert.equal(roomsToCreate.length, 3);
  assert.equal(roomsToCreate[0].sortOrder, 10);
  assert.equal(roomsToCreate[1].sortOrder, 30);
  assert.equal(roomsToCreate[2].sortOrder, 31);
  pass("6. Room template batching generates deterministic room sequences and sort orders without bathroom rooms");

  // 7. Compound Index Verification on Quotation Model
  const indexes = Quotation.schema.indexes();
  const hasCustomerIndex = indexes.some(([fields]) => {
    return fields.companyId === 1 && fields.customerId === 1 && fields.createdAt === -1;
  });
  assert.equal(hasCustomerIndex, true, "QuotationSchema must include { companyId: 1, customerId: 1, createdAt: -1 } index");
  pass("7. Quotation schema registers compound index { companyId: 1, customerId: 1, createdAt: -1 }");

  console.log(`\nALL ${count} PHASE 5 TESTS PASSED!\n`);
}

main();
