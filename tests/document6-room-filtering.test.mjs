import assert from "node:assert";

// Mock implementation matching getRenderableProposalRooms from StepProposalPreview.tsx
function getRenderableProposalRooms(rooms) {
  if (!rooms || !Array.isArray(rooms)) return [];

  return rooms
    .filter((room) => {
      if (!room || typeof room !== "object") return false;
      const items = room.items;
      if (!Array.isArray(items) || items.length === 0) return false;
      return items.some((item) => {
        if (!item || typeof item !== "object") return false;
        const qty = Number(item.quantity);
        return !isNaN(qty) && qty > 0;
      });
    })
    .map((room) => ({
      ...room,
      items: (room.items || []).filter((item) => {
        if (!item || typeof item !== "object") return false;
        const qty = Number(item.quantity);
        return !isNaN(qty) && qty > 0;
      }),
    }));
}

console.log("=== Running Document 6 Room & Floor Filtering Tests ===");

// TEST 1: Living Room has 2 devices, Bedroom has 0 devices
const test1Rooms = [
  { id: 1, customName: "Living Room", items: [{ id: 101, quantity: 2 }] },
  { id: 2, customName: "Bedroom", items: [] },
];
const result1 = getRenderableProposalRooms(test1Rooms);
assert.strictEqual(result1.length, 1, "Only Living Room should render");
assert.strictEqual(result1[0].customName, "Living Room");
console.log("PASS: Test 1 - Empty Bedroom with 0 devices excluded");

// TEST 2: Living Room has 2 devices, Bedroom has 1 device
const test2Rooms = [
  { id: 1, customName: "Living Room", items: [{ id: 101, quantity: 2 }] },
  { id: 2, customName: "Bedroom", items: [{ id: 102, quantity: 1 }] },
];
const result2 = getRenderableProposalRooms(test2Rooms);
assert.strictEqual(result2.length, 2, "Both Living Room and Bedroom should render");
console.log("PASS: Test 2 - Both rooms with devices rendered");

// TEST 3: Bedroom has 1 device with quantity = 2
const test3Rooms = [
  { id: 2, customName: "Bedroom", items: [{ id: 102, quantity: 2 }] },
];
const result3 = getRenderableProposalRooms(test3Rooms);
assert.strictEqual(result3.length, 1, "Bedroom with qty 2 should render");
assert.strictEqual(result3[0].items[0].quantity, 2);
console.log("PASS: Test 3 - Bedroom with quantity > 0 rendered");

// TEST 4: Room with device having quantity = 0
const test4Rooms = [
  { id: 2, customName: "Bedroom", items: [{ id: 102, quantity: 0 }] },
];
const result4 = getRenderableProposalRooms(test4Rooms);
assert.strictEqual(result4.length, 0, "Bedroom with qty 0 should NOT render");
console.log("PASS: Test 4 - Room with quantity 0 device excluded");

// TEST 5: Multi-floor scenario
// Ground Floor: Living Room (2 devices), Kitchen (1 device)
// First Floor: Bedroom (0 devices), Balcony (0 devices)
const test5Rooms = [
  { id: 1, customName: "Living Room", floor: "Ground Floor", items: [{ id: 101, quantity: 2 }] },
  { id: 2, customName: "Kitchen", floor: "Ground Floor", items: [{ id: 102, quantity: 1 }] },
  { id: 3, customName: "Bedroom", floor: "First Floor", items: [] },
  { id: 4, customName: "Balcony", floor: "First Floor", items: [{ id: 104, quantity: 0 }] },
];
const result5 = getRenderableProposalRooms(test5Rooms);
assert.strictEqual(result5.length, 2, "Only Ground Floor rooms should render");
const renderedFloors = Array.from(new Set(result5.map(r => r.floor)));
assert.deepStrictEqual(renderedFloors, ["Ground Floor"], "First Floor must be completely absent");
console.log("PASS: Test 5 - Empty First Floor omitted completely");

// TEST 6: Room with invalid / null items or quantity
const test6Rooms = [
  null,
  undefined,
  { id: 1, customName: "Empty Space", items: null },
  { id: 2, customName: "NaN Qty Space", items: [{ quantity: "invalid" }] },
  { id: 3, customName: "Negative Qty Space", items: [{ quantity: -1 }] },
  { id: 4, customName: "Valid Space", items: [{ quantity: 0 }, { quantity: 3 }] },
];
const result6 = getRenderableProposalRooms(test6Rooms);
assert.strictEqual(result6.length, 1, "Only Valid Space should render");
assert.strictEqual(result6[0].customName, "Valid Space");
assert.strictEqual(result6[0].items.length, 1, "Only item with qty 3 should be kept");
assert.strictEqual(result6[0].items[0].quantity, 3);
console.log("PASS: Test 6 - Invalid / null / zero data handled safely");

console.log("\nALL DOCUMENT 6 FILTERING TESTS PASSED 100%!");
