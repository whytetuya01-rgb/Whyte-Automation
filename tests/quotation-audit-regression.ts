import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  normalizeQuotation,
  normalizeQuotationRoom,
  normalizeQuotationItem,
  normalizeCategories,
  normalizeRoomTypes,
  normalizeHouseTypes,
} from "@/lib/quotationNormalization";
import { createQuotationItemSchema, createQuotationRoomSchema } from "@/lib/validation/quotation";

interface TestResult {
  name: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

const results: TestResult[] = [];

async function assertCase(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function run() {
  console.log("--- Starting Whyte Quotation End-to-End Audit Regression Tests ---");

  // =========================================================================
  // TEST 1: Schema Validation for quotationRoomId
  // =========================================================================
  await assertCase("Schema: createQuotationItemSchema rejects missing quotationRoomId", () => {
    const invalidPayload = {
      productId: 101,
      quantity: 2,
      variantConfig: { series: "wifi", finish: "glass" },
    };

    const parsed = createQuotationItemSchema.safeParse(invalidPayload);
    assert.equal(parsed.success, false, "Should fail validation when quotationRoomId is omitted");
    const issues = (parsed as any).error?.issues || [];
    assert.ok(
      issues.some((i: any) => i.path.includes("quotationRoomId")),
      "Error must be explicitly flagged on quotationRoomId"
    );
  });

  await assertCase("Schema: createQuotationItemSchema accepts valid quotationRoomId and productId", () => {
    const validPayload = {
      quotationRoomId: 42,
      productId: 101,
      productVariantId: 5,
      quantity: 3,
    };

    const parsed = createQuotationItemSchema.safeParse(validPayload);
    assert.equal(parsed.success, true, "Should pass validation with valid IDs");
    if (parsed.success) {
      assert.equal(parsed.data.quotationRoomId, 42);
      assert.equal(parsed.data.productId, 101);
      assert.equal(parsed.data.quantity, 3);
    }
  });

  // =========================================================================
  // TEST 2: Normalization fixes lean Mongoose documents with raw _id (Root Cause)
  // =========================================================================
  await assertCase("Normalization: Guarantees id from _id on Quotation, Room, and Items", () => {
    // Simulating raw Mongoose .lean() document from MongoDB
    const rawLeanQuotation = {
      _id: 1001,
      status: "draft",
      clientName: "John Doe",
      discountType: "percentage",
      discountValue: 10,
      allocatedDiscountPercent: 25,
      rooms: [
        {
          _id: 201,
          quotationId: 1001,
          customName: "Master Bedroom",
          items: [
            {
              _id: 301,
              quotationRoomId: 201,
              productId: 401,
              quantity: 2,
              unitPrice: "1500.00",
              product: { _id: 401, name: "Smart Touch Switch 4M", code: "STS-4M" },
            },
            {
              _id: 302,
              quotationRoomId: 201,
              productId: 402,
              quantity: 1,
              unitPrice: "2500.00",
              product: { _id: 402, name: "Smart Dimmer Module", code: "SDM-1" },
            },
          ],
        },
        {
          _id: 202,
          quotationId: 1001,
          customName: "Living Room",
          items: [
            {
              _id: 303,
              quotationRoomId: 202,
              productId: 403,
              quantity: 4,
              unitPrice: "800.00",
              product: { _id: 403, name: "Curtain Controller", code: "CC-1" },
            },
          ],
        },
      ],
    };

    const normalized = normalizeQuotation(rawLeanQuotation);

    // Assert quotation ID
    assert.equal(normalized.id, "1001", "Quotation id must be string '1001'");
    assert.equal(normalized.rooms.length, 2, "Must have 2 rooms");

    // Assert Room 1
    const r1 = normalized.rooms[0];
    assert.equal(r1.id, 201, "Room 1 id must be 201");
    assert.equal(r1.items.length, 2, "Room 1 has 2 items");

    // Assert Room 1 items
    assert.equal(r1.items[0].id, 301, "Item 1 id must be 301");
    assert.equal(r1.items[0].productId, 401, "Item 1 productId must be 401");
    assert.equal(r1.items[0].product?.id, 401, "Item 1 product.id must be 401");
    assert.equal(r1.items[0].quantity, 2, "Item 1 quantity must be 2");
    assert.equal(r1.items[0].unitPrice, "1500.00", "Item 1 unitPrice must be formatted string '1500.00'");
    assert.equal(r1.items[0].linePrice, 3000, "Item 1 linePrice must be 2 * 1500 = 3000");

    assert.equal(r1.items[1].id, 302);
    assert.equal(r1.items[1].linePrice, 2500, "Item 2 linePrice must be 1 * 2500 = 2500");

    // Room 1 Subtotal: 3000 + 2500 = 5500
    assert.equal(r1.subtotal, 5500, "Room 1 subtotal must be 5500");

    // Assert Room 2
    const r2 = normalized.rooms[1];
    assert.equal(r2.id, 202, "Room 2 id must be 202");
    assert.equal(r2.items[0].id, 303);
    assert.equal(r2.items[0].linePrice, 3200, "Item 3 linePrice must be 4 * 800 = 3200");
    assert.equal(r2.subtotal, 3200, "Room 2 subtotal must be 3200");

    // Financial Calculations on Quotation
    // Subtotal = 5500 + 3200 = 8700
    assert.equal(normalized.subtotal, 8700, "Quotation subtotal must equal sum of room subtotals (8700)");

    // Total Products Count (sum of quantities: 2 + 1 + 4 = 7)
    assert.equal(normalized.totalProducts, 7, "Total products must equal sum of quantities (7), not items array length (3)");

    // Customer Discount: 10% of 8700 = 870
    assert.equal(normalized.discountAmount, 870, "Discount amount must be 10% of 8700 (870)");

    // Grand Total: 8700 - 870 = 7830
    assert.equal(normalized.grandTotal, 7830, "Grand total must be 8700 - 870 = 7830");

    // Dealer Commission / Earnings: allocated 25% - 10% customer discount = 15% net earning
    // 15% of 8700 = 1305
    assert.equal(normalized.earningPercent, 15, "Net earning percent must be 15%");
    assert.equal(normalized.estimatedEarning, 1305, "Estimated earning must be 15% of 8700 = 1305");
  });

  // =========================================================================
  // TEST 3: Decimal128 and Zero/Negative Quantity Bounding
  // =========================================================================
  await assertCase("Normalization: Handles Mongoose Decimal128 and guarantees min quantity = 1", () => {
    const itemDoc = {
      _id: 55,
      quotationRoomId: 10,
      productId: 20,
      quantity: 0, // invalid zero quantity
      unitPrice: mongoose.Types.Decimal128.fromString("123.45"),
    };

    const normalized = normalizeQuotationItem(itemDoc);
    assert.equal(normalized.id, 55);
    assert.equal(normalized.quantity, 1, "Zero quantity must be bounded to 1");
    assert.equal(normalized.unitPrice, "123.45", "Decimal128 must be formatted string '123.45'");
    assert.equal(normalized.linePrice, 123.45, "linePrice must be 1 * 123.45 = 123.45");
  });

  // =========================================================================
  // TEST 4: Categories & Subcategories recursive normalization
  // =========================================================================
  await assertCase("Normalization: Recursively normalizes Category tree with guaranteed numeric id", () => {
    const rawCategories = [
      {
        _id: 1,
        name: "Switches & Sockets",
        children: [
          { _id: 11, name: "Smart Switches" },
          { _id: 12, name: "Power Sockets" },
        ],
      },
      {
        _id: 2,
        name: "Curtain Automation",
        children: [],
      },
    ];

    const normalizedCats = normalizeCategories(rawCategories as any);
    assert.equal(normalizedCats[0].id, 1);
    assert.equal(normalizedCats[0].children?.[0].id, 11);
    assert.equal(normalizedCats[0].children?.[1].id, 12);
    assert.equal(normalizedCats[1].id, 2);
  });

  // =========================================================================
  // TEST 5: Multi-Room Isolation
  // =========================================================================
  await assertCase("Multi-Room Isolation: Items in Room A are never confused with Room B", () => {
    const testQuotation = {
      id: 99,
      rooms: [
        {
          id: 101,
          customName: "Living Room",
          items: [
            { id: 1001, productId: 50, quantity: 2, unitPrice: 100 },
            { id: 1002, productId: 51, quantity: 1, unitPrice: 200 },
          ],
        },
        {
          id: 102,
          customName: "Bedroom",
          items: [
            { id: 1003, productId: 50, quantity: 1, unitPrice: 100 },
          ],
        },
      ],
    };

    const norm = normalizeQuotation(testQuotation);
    const room101 = norm.rooms.find((r) => r.id === 101);
    const room102 = norm.rooms.find((r) => r.id === 102);

    // In Room 101, Product 50 has count 2
    const p50InRoom101 = (room101?.items || [])
      .filter((i) => i.productId === 50)
      .reduce((acc, i) => acc + (i.quantity || 1), 0);
    assert.equal(p50InRoom101, 2, "Room 101 must have exactly 2 of Product 50");

    // In Room 102, Product 50 has count 1
    const p50InRoom102 = (room102?.items || [])
      .filter((i) => i.productId === 50)
      .reduce((acc, i) => acc + (i.quantity || 1), 0);
    assert.equal(p50InRoom102, 1, "Room 102 must have exactly 1 of Product 50");

    // Active room check simulation
    const currentRoomId = 101;
    const isR1Current = norm.rooms[0].id === currentRoomId;
    const isR2Current = norm.rooms[1].id === currentRoomId;
    assert.equal(isR1Current, true, "Room 101 is current");
    assert.equal(isR2Current, false, "Room 102 is NOT current");
  });

  // =========================================================================
  // TEST 6: Fixed vs Percentage Discount Calculations
  // =========================================================================
  await assertCase("Discount Calculations: Fixed discount clamped at subtotal", () => {
    const qWithFixedDiscount = {
      _id: 500,
      discountType: "fixed",
      discountValue: 10000,
      rooms: [
        {
          _id: 1,
          items: [{ _id: 1, productId: 1, quantity: 1, unitPrice: 4000 }],
        },
      ],
    };

    const norm = normalizeQuotation(qWithFixedDiscount);
    assert.equal(norm.subtotal, 4000);
    assert.equal(norm.discountAmount, 4000, "Discount cannot exceed subtotal (clamped at 4000)");
    assert.equal(norm.grandTotal, 0, "Grand total must be 0 after full discount");
  });

  console.log("\n=======================================================");
  console.log(`Results: ${results.filter((r) => r.status === "PASS").length} passed, ${results.filter((r) => r.status === "FAIL").length} failed`);
  console.log("=======================================================");

  if (results.some((r) => r.status === "FAIL")) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
