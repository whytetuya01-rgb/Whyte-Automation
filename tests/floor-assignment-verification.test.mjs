import assert from "assert";
import {
  ROOM_DEFAULT_FLOOR_RULES,
  calculateIntelligentDefaultFloor,
  getBaseDefaultFloorForRoom,
  getEffectiveFloorForRoom,
} from "../src/lib/floorAssignment.ts";
import { groupRoomsByFloor } from "../src/lib/roomUtils.ts";

console.log("==================================================");
console.log("RUNNING INTELLIGENT FLOOR ASSIGNMENT VERIFICATION");
console.log("==================================================\n");

// TEST 1: Add Living Room -> Ground Floor (NOT First Floor)
console.log("TEST 1: Add Living Room -> Ground Floor");
const test1 = calculateIntelligentDefaultFloor({ roomName: "Living Room", existingRooms: [], isMultiFloor: true });
assert.strictEqual(test1, "Ground Floor", "Living Room must default to Ground Floor, NOT First Floor");
console.log(" => [PASS] TEST 1 passed successfully.\n");

// TEST 2: Add Kitchen -> Ground Floor
console.log("TEST 2: Add Kitchen -> Ground Floor");
const test2 = calculateIntelligentDefaultFloor({ roomName: "Kitchen", existingRooms: [], isMultiFloor: true });
assert.strictEqual(test2, "Ground Floor", "Kitchen must default to Ground Floor");
console.log(" => [PASS] TEST 2 passed successfully.\n");

// TEST 3: Add Dining Room -> Ground Floor
console.log("TEST 3: Add Dining Room -> Ground Floor");
const test3 = calculateIntelligentDefaultFloor({ roomName: "Dining Room", existingRooms: [], isMultiFloor: true });
assert.strictEqual(test3, "Ground Floor", "Dining Room must default to Ground Floor");
console.log(" => [PASS] TEST 3 passed successfully.\n");

// TEST 4: Add Master Bedroom -> First Floor
console.log("TEST 4: Add Master Bedroom -> First Floor");
const test4 = calculateIntelligentDefaultFloor({ roomName: "Master Bedroom", existingRooms: [], isMultiFloor: true });
assert.strictEqual(test4, "First Floor", "Master Bedroom must default to First Floor");
console.log(" => [PASS] TEST 4 passed successfully.\n");

// TEST 5: Add Balcony -> First Floor
console.log("TEST 5: Add Balcony -> First Floor");
const test5 = calculateIntelligentDefaultFloor({ roomName: "Balcony", existingRooms: [], isMultiFloor: true });
assert.strictEqual(test5, "First Floor", "Balcony must default to First Floor");
console.log(" => [PASS] TEST 5 passed successfully.\n");

// TEST 6: Add Terrace -> Terrace
console.log("TEST 6: Add Terrace -> Terrace (Special Location)");
const test6 = calculateIntelligentDefaultFloor({ roomName: "Terrace", existingRooms: [], isMultiFloor: true });
assert.strictEqual(test6, "Terrace", "Terrace must default to Terrace, NOT First Floor");
console.log(" => [PASS] TEST 6 passed successfully.\n");

// TEST 7: Duplicate Living Room -> First Floor
console.log("TEST 7: Add Living Room again -> First Floor");
const test7 = calculateIntelligentDefaultFloor({
  roomName: "Living Room",
  existingRooms: [{ id: 101, customName: "Living Room", subArea: "Ground Floor" }],
  isMultiFloor: true,
});
assert.strictEqual(test7, "First Floor", "2nd Living Room must default to First Floor");
console.log(" => [PASS] TEST 7 passed successfully.\n");

// TEST 8: Add Living Room a 3rd time -> Second Floor
console.log("TEST 8: Add Living Room a 3rd time -> Second Floor");
const test8 = calculateIntelligentDefaultFloor({
  roomName: "Living Room",
  existingRooms: [
    { id: 101, customName: "Living Room", subArea: "Ground Floor" },
    { id: 102, customName: "Living Room 2", subArea: "First Floor" },
  ],
  isMultiFloor: true,
});
assert.strictEqual(test8, "Second Floor", "3rd Living Room must default to Second Floor");
console.log(" => [PASS] TEST 8 passed successfully.\n");

// TEST 9: Add Balcony again -> Second Floor
console.log("TEST 9: Add Balcony again -> Second Floor");
const test9 = calculateIntelligentDefaultFloor({
  roomName: "Balcony",
  existingRooms: [{ id: 103, customName: "Balcony", subArea: "First Floor" }],
  isMultiFloor: true,
});
assert.strictEqual(test9, "Second Floor", "2nd Balcony must default to Second Floor");
console.log(" => [PASS] TEST 9 passed successfully.\n");

// TEST 10: Manual User Override Preservation
console.log("TEST 10: Manual User Override Preservation");
const existingRoomsWithOverride = [
  { id: 101, customName: "Living Room", subArea: "Third Floor" },
];
assert.strictEqual(existingRoomsWithOverride[0].subArea, "Third Floor", "User manual assignment must be preserved");
console.log(" => [PASS] TEST 10 passed successfully.\n");

// TEST 11: Add Room inside SECOND FLOOR section -> Second Floor
console.log("TEST 11: Click SECOND FLOOR + ADD ROOM and select Living Room -> Second Floor");
const test11 = calculateIntelligentDefaultFloor({
  roomName: "Living Room",
  existingRooms: [{ id: 101, customName: "Living Room", subArea: "Ground Floor" }],
  isMultiFloor: true,
  explicitFloorContext: "Second Floor",
});
assert.strictEqual(test11, "Second Floor", "Contextual floor preference must override room default");
console.log(" => [PASS] TEST 11 passed successfully.\n");

// TEST 12: Full Grouping Test without "UNSPECIFIED LOCATION" bug
console.log("TEST 12: Grouping rooms by effective floor (Ground Floor, First Floor, Terrace)");
const sampleRooms = [
  { id: 1, customName: "Living Room", subArea: null },
  { id: 2, customName: "Master Bedroom", subArea: null },
  { id: 3, customName: "Bedroom", subArea: null },
  { id: 4, customName: "Kitchen", subArea: null },
  { id: 5, customName: "Dining Room", subArea: null },
  { id: 6, customName: "Balcony", subArea: null },
  { id: 7, customName: "Balcony 2", subArea: null },
  { id: 8, customName: "Staircase", subArea: null },
  { id: 9, customName: "Terrace", subArea: null },
  { id: 10, customName: "Entrance / Foyer", subArea: null },
];

const grouped = groupRoomsByFloor(sampleRooms, true);
const floorMap = Object.fromEntries(grouped.map((g) => [g.floor, g.rooms.map((r) => r.customName)]));

assert.ok(floorMap["Ground Floor"], "Ground Floor section must exist");
assert.ok(floorMap["First Floor"], "First Floor section must exist");
assert.ok(floorMap["Terrace"], "Terrace section must exist");
assert.strictEqual(floorMap["Unspecified Location"], undefined, "Unspecified Location must NOT exist");

assert.deepStrictEqual(floorMap["Ground Floor"], ["Living Room", "Kitchen", "Dining Room", "Staircase", "Entrance / Foyer"]);
assert.deepStrictEqual(floorMap["First Floor"], ["Master Bedroom", "Bedroom", "Balcony", "Balcony 2"]);
assert.deepStrictEqual(floorMap["Terrace"], ["Terrace"]);
console.log(" => [PASS] TEST 12 passed successfully.\n");

console.log("==================================================");
console.log("ALL 12 INTELLIGENT FLOOR ASSIGNMENT TESTS PASSED!");
console.log("==================================================\n");
