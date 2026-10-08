import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getRoomImage, roomImageSrc, ROOM_IMAGES, ROOM_IMAGE_SOURCES } from "../src/lib/roomImageMap.ts";

// Every preset name known to src/lib/roomPresetsFallback.ts (that module uses "@/"
// imports plain Node can't resolve, so the list is mirrored here) plus the
// room categories named in the room-image brief.
const KNOWN_PRESET_NAMES = [
  "Living Room", "Master Bedroom", "Bedroom", "Bedroom 2", "Bedroom 3", "Bedroom 4", "Kitchen",
  "Dining Room", "Dining", "Balcony", "Balcony 1", "Balcony 2", "Study Room", "Home Office",
  "Home Theatre", "Entrance / Foyer", "Foyer", "Entrance", "Utility Room", "Laundry", "Terrace",
  "Garden", "Gym", "Puja Room", "Store Room", "Corridor", "Staircase", "Garage", "Common Area",
  "Servant Room", "Driver Room", "Guest Room", "Kids Room",
];

/** Unit tests for the centralized room → background image mapping (no server needed). */
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
const fileOf = (name) => getRoomImage(name).file;

check("every canonical image file exists in public/room-images", () => {
  for (const entry of Object.values(ROOM_IMAGES)) {
    const p = path.join(publicDir, roomImageSrc(entry));
    assert.ok(existsSync(p), `missing ${p}`);
  }
});

check("every canonical image has source/licence metadata", () => {
  for (const key of Object.keys(ROOM_IMAGES)) assert.ok(ROOM_IMAGE_SOURCES[key], `no source for ${key}`);
});

check("every known preset name resolves to an existing image", () => {
  for (const name of KNOWN_PRESET_NAMES) {
    const entry = getRoomImage(name);
    assert.ok(existsSync(path.join(publicDir, roomImageSrc(entry))), `${name} -> ${entry.file} missing`);
  }
});

check("uploaded room photos map to their exact rooms", () => {
  assert.equal(fileOf("Living Room"), "living-room");
  assert.equal(fileOf("Master Bedroom"), "master-bedroom");
  assert.equal(fileOf("Home Theatre"), "home-theatre");
  assert.equal(fileOf("Bedroom 2"), "bedroom-2");
  assert.equal(fileOf("Bedroom 3"), "bedroom-3");
  assert.equal(fileOf("Dining Room"), "dining-room");
  assert.equal(fileOf("Kitchen"), "kitchen");
  assert.equal(fileOf("Entrance / Foyer"), "entrance-foyer");
  assert.equal(fileOf("Terrace"), "terrace");
});

check("naming variants resolve to the same image", () => {
  assert.equal(fileOf("Home Theater"), "home-theatre");
  assert.equal(fileOf("Entrance foyer"), "entrance-foyer");
  assert.equal(fileOf("Entrance/Foyer"), "entrance-foyer");
  assert.equal(fileOf("  living   ROOM "), "living-room");
  assert.equal(fileOf("Dining"), "dining-room");
  assert.equal(fileOf("Balcony 2"), "balcony");
});

check("numbered suffixes fall back to the base room", () => {
  assert.equal(fileOf("Bedroom 4"), "bedroom");
  assert.equal(fileOf("Bedroom 7"), "bedroom");
  assert.equal(fileOf("Balcony 5"), "balcony");
});

check("rooms without a dedicated photo use the closest related image", () => {
  assert.equal(fileOf("Guest Room"), "bedroom");
  assert.equal(fileOf("Kids Room"), "bedroom-3");
  assert.equal(fileOf("Study Room"), "home-office");
  assert.equal(fileOf("Utility Room"), "kitchen");
  assert.equal(fileOf("Store Room"), "kitchen");
  assert.equal(fileOf("Corridor"), "entrance-foyer");
  assert.equal(fileOf("Common Area"), "living-room");
});

check("custom free-text room names match by keyword", () => {
  assert.equal(fileOf("Kids Playroom"), "bedroom-3");
  assert.equal(fileOf("Upper Hallway"), "entrance-foyer");
  assert.equal(fileOf("Rooftop Garden"), "garden");
  assert.equal(fileOf("Main Stairs"), "staircase");
  assert.equal(fileOf("Mini Theater"), "home-theatre");
});

check("unknown names, empty and null use the universal fallback", () => {
  assert.equal(fileOf("Bar"), "living-room");
  assert.equal(fileOf(""), "living-room");
  assert.equal(fileOf(null), "living-room");
  assert.equal(fileOf(undefined), "living-room");
});

if (failures) {
  console.error(`\n${failures} room-image check(s) failed`);
  process.exit(1);
}
console.log("\nAll room-image mapping checks passed");
