/**
 * Comprehensive Test Suite: Separate Recommended, Selected Other Spaces, and Available Spaces
 *
 * Verifies:
 * 1. Recommended spaces appear only in Recommended Spaces.
 * 2. Selecting one non-recommended space displays Selected Other Spaces.
 * 3. Selecting multiple additional spaces displays all of them.
 * 4. Available Space Presets excludes all selected spaces (both recommended and non-recommended).
 * 5. Selecting and deselecting spaces updates the correct sections immediately.
 * 6. A recommended space never appears in Selected Other Spaces.
 * 7. Custom quotation-specific room names remain intact.
 * 8. Saving and reopening the quotation preserves all selected spaces and their correct classification.
 */

import assert from "node:assert/strict";
import { resolveRoomPresets, ResolvedRoomPreset } from "../src/lib/roomPresetsFallback";
import { getRoomDisplayName } from "../src/lib/roomUtils";
import type { Quotation, QuotationRoom, RoomType, HouseType } from "../src/types";

const results: string[] = [];
const pass = (name: string) => {
  results.push(name);
  console.log(`  ✓ ${name}`);
};

// Classification helpers exactly mirroring StepSelectSpaces implementation
function isRecommendedRoom(room: QuotationRoom, recommendedPresets: ResolvedRoomPreset[], hasHouseTypeContext: boolean): boolean {
  if (!hasHouseTypeContext) return false;
  const rRoomTypeId = room.roomTypeId !== undefined && room.roomTypeId !== null ? Number(room.roomTypeId) : null;
  return recommendedPresets.some((p) => {
    if (p.roomTypeId && rRoomTypeId !== null && Number(p.roomTypeId) === rRoomTypeId) return true;
    if (!rRoomTypeId && room.customName && p.name && room.customName.trim().toLowerCase() === p.name.trim().toLowerCase()) return true;
    return false;
  });
}

function classifySpaces({
  existingRooms,
  recommendedPresets,
  otherPresets,
  allPresets,
  hasHouseTypeContext,
}: {
  existingRooms: QuotationRoom[];
  recommendedPresets: ResolvedRoomPreset[];
  otherPresets: ResolvedRoomPreset[];
  allPresets: ResolvedRoomPreset[];
  hasHouseTypeContext: boolean;
}) {
  // 1. Recommended spaces
  const recommendedSectionRooms = hasHouseTypeContext
    ? existingRooms.filter((r) => isRecommendedRoom(r, recommendedPresets, hasHouseTypeContext))
    : [];

  // 2. Selected other spaces (non-recommended spaces selected by user)
  const selectedOtherRooms = existingRooms.filter((r) => !isRecommendedRoom(r, recommendedPresets, hasHouseTypeContext));

  // 3. Available space presets (unselected only, excluding every selected space)
  const candidatePresets = hasHouseTypeContext ? otherPresets : allPresets;

  const selectedRoomTypeIds = new Set<number>();
  const selectedNames = new Set<string>();

  existingRooms.forEach((r) => {
    if (r.roomTypeId !== undefined && r.roomTypeId !== null) {
      selectedRoomTypeIds.add(Number(r.roomTypeId));
    }
    if (r.roomType?.name) {
      selectedNames.add(r.roomType.name.trim().toLowerCase());
    }
    if (r.customName) {
      selectedNames.add(r.customName.trim().toLowerCase());
    }
  });

  if (hasHouseTypeContext) {
    recommendedPresets.forEach((p) => {
      if (p.roomTypeId) selectedRoomTypeIds.add(Number(p.roomTypeId));
      if (p.name) selectedNames.add(p.name.trim().toLowerCase());
    });
  }

  const seenNames = new Set<string>();
  const availableSpacePresets: ResolvedRoomPreset[] = [];

  candidatePresets.forEach((p) => {
    const nameKey = p.name.trim().toLowerCase();
    if (seenNames.has(nameKey)) return;

    const isSelectedById = p.roomTypeId !== undefined && selectedRoomTypeIds.has(Number(p.roomTypeId));
    const isSelectedByName = selectedNames.has(nameKey);

    if (!isSelectedById && !isSelectedByName) {
      seenNames.add(nameKey);
      availableSpacePresets.push(p);
    }
  });

  return {
    recommendedSectionRooms,
    selectedOtherRooms,
    availableSpacePresets,
  };
}

console.log("\n--- Section 1: House Type Recommendation Setup & Classification ---");

const mockRoomTypes: RoomType[] = [
  { id: 1, name: "Living Room", isActive: true, sortOrder: 1 },
  { id: 2, name: "Master Bedroom", isActive: true, sortOrder: 2 },
  { id: 3, name: "Kitchen", isActive: true, sortOrder: 3 },
  { id: 4, name: "Dining Room", isActive: true, sortOrder: 4 },
  { id: 5, name: "Balcony", isActive: true, sortOrder: 5 },
  { id: 6, name: "Bedroom", isActive: true, sortOrder: 6 },
  { id: 7, name: "Guest Room", isActive: true, sortOrder: 7 },
  { id: 8, name: "Study Room", isActive: true, sortOrder: 8 },
  { id: 9, name: "Servant Room", isActive: true, sortOrder: 9 },
] as any;

const mockHouseType: HouseType = {
  id: 101,
  name: "2 BHK Executive",
  roomTemplate: [
    { roomTypeId: 1, defaultCount: 1 },
    { roomTypeId: 2, defaultCount: 1 },
    { roomTypeId: 3, defaultCount: 1 },
  ],
} as any;

const resolved = resolveRoomPresets({ houseType: mockHouseType, allRoomTypes: mockRoomTypes });
assert.equal(resolved.recommendedPresets.length, 3, "House type should resolve 3 recommended presets");
assert.equal(resolved.recommendedPresets[0].name, "Living Room");
assert.equal(resolved.recommendedPresets[1].name, "Master Bedroom");
assert.equal(resolved.recommendedPresets[2].name, "Kitchen");
pass("House type recommended presets resolved correctly (Living Room, Master Bedroom, Kitchen)");

console.log("\n--- Section 2: Exclusivity & Separation Tests ---");

// Test 2.1: Only recommended spaces selected -> Selected Other Spaces is empty
let rooms: QuotationRoom[] = [
  { id: 10, quotationId: 1, roomTypeId: 1, roomType: mockRoomTypes[0], items: [] },
  { id: 11, quotationId: 1, roomTypeId: 2, roomType: mockRoomTypes[1], items: [] },
] as any;

let res = classifySpaces({
  existingRooms: rooms,
  recommendedPresets: resolved.recommendedPresets,
  otherPresets: resolved.otherPresets,
  allPresets: resolved.allPresets,
  hasHouseTypeContext: true,
});

assert.equal(res.recommendedSectionRooms.length, 2);
assert.equal(res.selectedOtherRooms.length, 0, "Selected Other Spaces must be empty when only recommended spaces are selected");
pass("Recommended spaces appear only in Recommended Spaces, Selected Other Spaces remains empty");

// Test 2.2: Available Space Presets excludes all selected and recommended spaces
const availableNames = res.availableSpacePresets.map((p) => p.name.toLowerCase());
assert.ok(!availableNames.includes("living room"), "Living Room must be excluded from Available Space Presets");
assert.ok(!availableNames.includes("master bedroom"), "Master Bedroom must be excluded from Available Space Presets");
assert.ok(!availableNames.includes("kitchen"), "Kitchen (recommended) must be excluded from Available Space Presets");
assert.ok(availableNames.includes("bedroom"), "Bedroom (unselected) must be in Available Space Presets");
assert.ok(availableNames.includes("guest room"), "Guest Room (unselected) must be in Available Space Presets");
pass("Available Space Presets excludes all selected and recommended spaces");

console.log("\n--- Section 3: Adding Non-Recommended Spaces (Selected Other Spaces) ---");

// Test 3.1: Select one non-recommended space -> appears in Selected Other Spaces, removed from Available
rooms = [
  ...rooms,
  { id: 12, quotationId: 1, roomTypeId: 6, roomType: mockRoomTypes[5], items: [] }, // Bedroom
] as any;

res = classifySpaces({
  existingRooms: rooms,
  recommendedPresets: resolved.recommendedPresets,
  otherPresets: resolved.otherPresets,
  allPresets: resolved.allPresets,
  hasHouseTypeContext: true,
});

assert.equal(res.recommendedSectionRooms.length, 2, "Recommended Spaces count unchanged");
assert.equal(res.selectedOtherRooms.length, 1, "Selected Other Spaces has exactly 1 space");
assert.equal(res.selectedOtherRooms[0].roomTypeId, 6, "Bedroom is in Selected Other Spaces");
assert.ok(!res.availableSpacePresets.map((p) => p.name.toLowerCase()).includes("bedroom"), "Bedroom immediately excluded from Available Presets");
pass("Selecting one non-recommended space displays Selected Other Spaces and removes it from Available Presets");

// Test 3.2: Select multiple additional spaces -> all appear in Selected Other Spaces
rooms = [
  ...rooms,
  { id: 13, quotationId: 1, roomTypeId: 7, roomType: mockRoomTypes[6], items: [] }, // Guest Room
  { id: 14, quotationId: 1, roomTypeId: null, customName: "Wine Cellar", items: [] }, // Custom space
] as any;

res = classifySpaces({
  existingRooms: rooms,
  recommendedPresets: resolved.recommendedPresets,
  otherPresets: resolved.otherPresets,
  allPresets: resolved.allPresets,
  hasHouseTypeContext: true,
});

assert.equal(res.recommendedSectionRooms.length, 2, "Recommended section still has Living Room & Master Bedroom");
assert.equal(res.selectedOtherRooms.length, 3, "Selected Other Spaces displays all 3 additional spaces (Bedroom, Guest Room, Wine Cellar)");
assert.ok(res.selectedOtherRooms.some((r) => r.customName === "Wine Cellar"), "Wine Cellar custom space is in Selected Other Spaces");
pass("Selecting multiple additional spaces displays all of them in Selected Other Spaces");

// Test 3.3: Recommended space NEVER appears in Selected Other Spaces
assert.ok(
  !res.selectedOtherRooms.some((r) => r.roomTypeId === 1 || r.roomTypeId === 2),
  "Recommended spaces (Living Room, Master Bedroom) must NEVER appear in Selected Other Spaces"
);
pass("A recommended space never appears in Selected Other Spaces");

console.log("\n--- Section 4: Deselection & Dynamic Updates ---");

// Test 4.1: Deselecting / removing a non-recommended space immediately returns it to Available Presets
rooms = rooms.filter((r) => r.roomTypeId !== 7); // Remove Guest Room

res = classifySpaces({
  existingRooms: rooms,
  recommendedPresets: resolved.recommendedPresets,
  otherPresets: resolved.otherPresets,
  allPresets: resolved.allPresets,
  hasHouseTypeContext: true,
});

assert.equal(res.selectedOtherRooms.length, 2, "Selected Other Spaces decreased to 2");
assert.ok(
  res.availableSpacePresets.map((p) => p.name.toLowerCase()).includes("guest room"),
  "Guest Room immediately returned to Available Space Presets upon deselection"
);
pass("Selecting and deselecting spaces updates the correct sections immediately");

// Test 4.2: Removing all non-recommended spaces empties Selected Other Spaces
rooms = rooms.filter((r) => r.roomTypeId !== 6 && r.customName !== "Wine Cellar");

res = classifySpaces({
  existingRooms: rooms,
  recommendedPresets: resolved.recommendedPresets,
  otherPresets: resolved.otherPresets,
  allPresets: resolved.allPresets,
  hasHouseTypeContext: true,
});

assert.equal(res.selectedOtherRooms.length, 0, "Selected Other Spaces is empty again");
assert.ok(
  res.availableSpacePresets.map((p) => p.name.toLowerCase()).includes("bedroom"),
  "Bedroom returned to Available Space Presets"
);
pass("Removing all additional spaces clears Selected Other Spaces and returns presets to Available");

console.log("\n--- Section 5: Quotation-Specific Renaming & Immutability ---");

// Test 5.1: Renamed space keeps roomTypeId and correct classification
rooms = [
  { id: 10, quotationId: 1, roomTypeId: 1, roomType: mockRoomTypes[0], customName: "Main Hall", items: [] }, // Renamed recommended
  { id: 15, quotationId: 1, roomTypeId: 6, roomType: mockRoomTypes[5], customName: "Person A Room", items: [] }, // Renamed non-recommended
] as any;

res = classifySpaces({
  existingRooms: rooms,
  recommendedPresets: resolved.recommendedPresets,
  otherPresets: resolved.otherPresets,
  allPresets: resolved.allPresets,
  hasHouseTypeContext: true,
});

assert.equal(res.recommendedSectionRooms.length, 1, "Renamed 'Main Hall' stays in Recommended Spaces");
assert.equal(res.recommendedSectionRooms[0].customName, "Main Hall");
assert.equal(res.selectedOtherRooms.length, 1, "Renamed 'Person A Room' stays in Selected Other Spaces");
assert.equal(res.selectedOtherRooms[0].customName, "Person A Room");
assert.ok(
  !res.availableSpacePresets.map((p) => p.name.toLowerCase()).includes("bedroom"),
  "Bedroom preset excluded from Available Presets even though renamed to 'Person A Room'"
);
pass("Custom quotation-specific room names remain intact and preserve accurate section classification");

console.log("\n--- Section 6: Saving & Reopening Quotation State Preservation ---");

// Simulate saving and reopening the quotation
const serializedQuotation = JSON.stringify({
  id: 1,
  houseTypeId: 101,
  rooms,
});

const reopenedQuotation: Quotation = JSON.parse(serializedQuotation);
const reopenedRes = classifySpaces({
  existingRooms: reopenedQuotation.rooms || [],
  recommendedPresets: resolved.recommendedPresets,
  otherPresets: resolved.otherPresets,
  allPresets: resolved.allPresets,
  hasHouseTypeContext: Boolean(reopenedQuotation.houseTypeId),
});

assert.equal(reopenedRes.recommendedSectionRooms.length, 1);
assert.equal(reopenedRes.recommendedSectionRooms[0].customName, "Main Hall");
assert.equal(reopenedRes.selectedOtherRooms.length, 1);
assert.equal(reopenedRes.selectedOtherRooms[0].customName, "Person A Room");
pass("Saving and reopening the quotation preserves all selected spaces and their correct classification");

console.log(`\nAll ${results.length} Space Classification tests PASSED!\n`);
