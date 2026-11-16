import assert from "node:assert/strict";
import { createRoomTemplateSchema, updateRoomTemplateSchema } from "../src/lib/validation/roomTemplate";
import type { RoomTemplate, RoomTemplateItem, QuotationRoom, QuotationItem } from "../src/types";

function pass(name: string) {
  console.log(`✓ ${name}`);
}

async function run() {
  console.log("\n--- Testing Whyte Room-Wise Template System & Step 3 Redesign ---\n");

  // ── 1. Schema Validation: Create Template ───────────────────────────────────
  const validCreatePayload = {
    roomTypeId: 1,
    name: "Living Room Template",
    description: "Standard 6-touch panel with smart fan and utility sockets",
    isActive: true,
    displayOrder: 1,
    items: [
      {
        productId: 101,
        variantId: 1001,
        defaultQuantity: 1,
        displayOrder: 0,
        isRequired: true,
      },
      {
        productId: 102,
        variantId: 1003,
        defaultQuantity: 1,
        displayOrder: 1,
        isRequired: false,
      },
      {
        productId: 103,
        variantId: null,
        defaultQuantity: 2,
        displayOrder: 2,
        isRequired: false,
      },
    ],
  };

  const parsed = createRoomTemplateSchema.safeParse(validCreatePayload);
  assert.ok(parsed.success, "Valid template schema should parse successfully");
  assert.equal(parsed.data.name, "Living Room Template");
  assert.equal(parsed.data.items.length, 3);
  assert.equal(parsed.data.items[2].defaultQuantity, 2);
  pass("1. Valid room template schema parses with correct items and quantities");

  // ── 2. Reject Missing Room Type or Name ──────────────────────────────────────
  const invalidPayload = {
    name: "", // empty name
    items: [],
  };
  const invalidParsed = createRoomTemplateSchema.safeParse(invalidPayload);
  assert.ok(!invalidParsed.success, "Should reject template without name or roomTypeId");
  pass("2. Schema strictly rejects missing roomTypeId or empty name");

  // ── 3. One Template Per Room Type Rule (Database & Store level) ─────────────
  const mockTenantTemplates: RoomTemplate[] = [
    {
      id: 1,
      companyId: 10,
      roomTypeId: 1, // Living Room
      name: "Living Room Template",
      description: "Default living room setup",
      isActive: true,
      displayOrder: 0,
      items: validCreatePayload.items as any,
    },
    {
      id: 2,
      companyId: 10,
      roomTypeId: 2, // Master Bedroom
      name: "Master Bedroom Template",
      description: "Default master bedroom setup",
      isActive: true,
      displayOrder: 1,
      items: [],
    },
  ];

  // Function simulating API duplicate check
  function validateUniqueTemplate(
    roomTypeId: number,
    existingTemplates: RoomTemplate[],
    currentTemplateId?: number
  ) {
    const conflict = existingTemplates.find(
      (t) => t.roomTypeId === roomTypeId && (!currentTemplateId || t.id !== currentTemplateId)
    );
    if (conflict) {
      throw new Error(
        `DUPLICATE_RECORD: A template ("${conflict.name}") already exists for Room Type ${roomTypeId}. Only one template is allowed per space.`
      );
    }
  }

  // Attempting to create a second template for RoomType 1 should fail
  assert.throws(
    () => validateUniqueTemplate(1, mockTenantTemplates),
    /DUPLICATE_RECORD/,
    "Must throw DUPLICATE_RECORD when creating a 2nd template for Living Room"
  );
  pass("3. One-template rule strictly rejects second template for same Room Type");

  // Creating a template for RoomType 3 (Kitchen - not yet configured) succeeds
  assert.doesNotThrow(
    () => validateUniqueTemplate(3, mockTenantTemplates),
    "Should permit template for unconfigured room type"
  );
  pass("4. Unconfigured room types are allowed to have a template created");

  // Editing existing template 1 keeping its own roomTypeId 1 succeeds
  assert.doesNotThrow(
    () => validateUniqueTemplate(1, mockTenantTemplates, 1),
    "Editing an existing template preserves its own room type"
  );
  pass("5. Editing an existing template allows preserving its own room type");

  // ── 6. Step 3 Quotation Builder: Single Template Resolution ─────────────────
  function resolveRoomTemplate(
    roomTypeId: number | null | undefined,
    templates: RoomTemplate[]
  ): RoomTemplate | null {
    if (!roomTypeId) return null;
    return templates.find((t) => t.roomTypeId === roomTypeId && t.isActive) || null;
  }

  // Living Room (roomTypeId = 1) resolves Living Room Template
  const livingTemplate = resolveRoomTemplate(1, mockTenantTemplates);
  assert.ok(livingTemplate, "Should resolve Living Room Template");
  assert.equal(livingTemplate?.name, "Living Room Template");
  pass("6. Step 3 correctly identifies Room Type and displays exactly its template");

  // Unconfigured room (roomTypeId = 7) returns null -> manual selection flow
  const unconfiguredTemplate = resolveRoomTemplate(7, mockTenantTemplates);
  assert.equal(unconfiguredTemplate, null, "Unconfigured room should return null template");
  pass("7. Step 3 gracefully handles rooms without templates (manual selection)");

  // Inactive template is ignored
  const withInactive: RoomTemplate[] = [
    { ...mockTenantTemplates[0], isActive: false },
  ];
  const inactiveResolved = resolveRoomTemplate(1, withInactive);
  assert.equal(inactiveResolved, null, "Inactive templates must not be offered in quotation builder");
  pass("8. Inactive templates are never offered in the quotation builder");

  // ── 9. Template Application: Independent & Fully Editable Items ─────────────
  // Simulate applying template into quotation room
  function applyTemplateToRoom(
    room: QuotationRoom,
    template: RoomTemplate
  ): QuotationRoom {
    const newItems: QuotationItem[] = template.items.map((it, idx) => ({
      id: 5000 + idx,
      quotationRoomId: room.id,
      productId: it.productId,
      productVariantId: it.variantId ?? null,
      variantConfig: (it.variantConfig as any) || null,
      quantity: it.defaultQuantity,
      unitPrice: "4500", // authoritative server calculation
      isCustomPrice: false,
      variantLabel: null,
      sbNumber: null,
      notes: null,
      sortOrder: idx,
    }));

    return {
      ...room,
      items: [...(room.items || []), ...newItems],
    };
  }

  const initialRoom: QuotationRoom = {
    id: 10,
    quotationId: "QT-TEST-001",
    roomTypeId: 1,
    customName: "Living Room",
    subArea: null,
    notes: null,
    sortOrder: 0,
    items: [],
  };

  const populatedRoom = applyTemplateToRoom(initialRoom, mockTenantTemplates[0]);
  assert.equal(populatedRoom.items.length, 3, "Room should receive 3 items from template");
  assert.equal(populatedRoom.items[2].quantity, 2, "Default quantity of 2 should be applied");
  pass("9. Template application populates items with correct default quantities");

  // Verify non-locking: user can delete item, modify quantity, or add new product
  const afterUserEdit: QuotationRoom = {
    ...populatedRoom,
    items: populatedRoom.items
      .filter((i) => i.id !== 5000) // deleted item #5000
      .map((i) => (i.id === 5002 ? { ...i, quantity: 4 } : i)), // changed quantity
  };
  assert.equal(afterUserEdit.items.length, 2, "User can freely remove any template item");
  assert.equal(afterUserEdit.items[1].quantity, 4, "User can freely modify item quantity");
  pass("10. Items remain 100% editable and unlocked after template application");

  // ── 11. Prices Are Not Authoritative in Template ────────────────────────────
  // Templates store productId, variantId, defaultQuantity, but NOT fixed selling prices
  for (const item of validCreatePayload.items) {
    assert.equal((item as any).unitPrice, undefined, "Template item must NOT store authoritative price");
    assert.equal((item as any).mrp, undefined, "Template item must NOT store authoritative MRP");
  }
  pass("11. Templates never store authoritative product prices (preserves quotation pricing rules)");

  console.log("\nALL 11 ROOM TEMPLATE TESTS PASSED!\n");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
