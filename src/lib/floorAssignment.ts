/**
 * Intelligent Floor & Location Assignment Module
 *
 * Provides centralized semantic mapping and dynamic room-based default floor calculation:
 * 1. Semantic floor defaults based on room name/type.
 * 2. Multi-instance progression: assigns next available logical floor when same room type is added multiple times.
 * 3. Property-type awareness: respects single-floor vs multi-floor configurations.
 * 4. Contextual explicit floor preference when user adds a room inside a specific floor section.
 * 5. Special location preservation (Terrace -> Terrace, Outdoor -> Outdoor).
 */

import type { QuotationRoom } from "@/types";

/**
 * Centralized semantic rules mapping room names/types to default floor/location.
 */
export const ROOM_DEFAULT_FLOOR_RULES: Record<string, string> = {
  // Ground Floor Rooms
  "living room": "Ground Floor",
  "living": "Ground Floor",
  "kitchen": "Ground Floor",
  "dining room": "Ground Floor",
  "dining": "Ground Floor",
  "entrance": "Ground Floor",
  "foyer": "Ground Floor",
  "entrance / foyer": "Ground Floor",
  "common area": "Ground Floor",
  "staircase": "Ground Floor",
  "parking": "Ground Floor",
  "garage": "Ground Floor",
  "pooja room": "Ground Floor",
  "puja room": "Ground Floor",
  "guest room": "Ground Floor",
  "verandah": "Ground Floor",
  "porch": "Ground Floor",

  // First Floor Rooms
  "master bedroom": "First Floor",
  "bedroom": "First Floor",
  "bedroom 2": "First Floor",
  "bedroom 3": "First Floor",
  "kids bedroom": "First Floor",
  "children bedroom": "First Floor",
  "balcony": "First Floor",
  "balcony 2": "First Floor",
  "balcony 3": "First Floor",
  "study": "First Floor",
  "study room": "First Floor",
  "home office": "First Floor",
  "office": "First Floor",
  "family lounge": "First Floor",
  "lounge": "First Floor",

  // Upper / Special Location Rooms
  "terrace": "Terrace",
  "roof terrace": "Terrace",
  "outdoor": "Outdoor",
  "garden": "Outdoor",
  "patio": "Outdoor",
  "basement": "Basement",
  "home theater": "Basement",
  "theater": "Basement",
  "gaming room": "Basement",
};

/**
 * Special locations that stay fixed and do NOT auto-increment across floors.
 */
export const SPECIAL_LOCATIONS: ReadonlySet<string> = new Set([
  "Terrace",
  "Outdoor",
  "Basement",
]);

/**
 * Standard ordered sequence of floors for multi-instance room progression.
 */
export const STANDARD_FLOOR_SEQUENCE: readonly string[] = [
  "Ground Floor",
  "First Floor",
  "Second Floor",
  "Third Floor",
  "Basement",
  "Terrace",
  "Outdoor",
  "Other",
];

/**
 * Gets the base default floor for a room based on its name semantics.
 */
export function getBaseDefaultFloorForRoom(roomName?: string | null): string {
  if (!roomName) return "Ground Floor";
  const lowerName = roomName.toLowerCase().trim();

  if (ROOM_DEFAULT_FLOOR_RULES[lowerName]) {
    return ROOM_DEFAULT_FLOOR_RULES[lowerName];
  }

  for (const [key, floor] of Object.entries(ROOM_DEFAULT_FLOOR_RULES)) {
    if (lowerName.includes(key)) {
      return floor;
    }
  }

  return "Ground Floor";
}

/**
 * Normalizes room name for matching duplicate instances (e.g. "Living Room 2" -> "living room").
 */
export function normalizeBaseRoomName(name?: string | null): string {
  if (!name) return "";
  // Strip trailing numbers (e.g., "Living Room 2" -> "living room")
  return name.replace(/\s+\d+$/i, "").trim().toLowerCase();
}

/**
 * Calculates the intelligent default floor for a newly created quotation room.
 */
export function calculateIntelligentDefaultFloor({
  roomTypeId,
  roomName,
  existingRooms = [],
  isMultiFloor = true,
  explicitFloorContext,
}: {
  roomTypeId?: number | null;
  roomName?: string | null;
  existingRooms?: QuotationRoom[];
  isMultiFloor?: boolean;
  explicitFloorContext?: string | null;
}): string {
  // 1. Single-floor properties always assign Ground Floor
  if (!isMultiFloor) {
    return "Ground Floor";
  }

  // 2. Explicit contextual floor (e.g. user clicked + ADD ROOM inside "Second Floor")
  if (
    explicitFloorContext &&
    explicitFloorContext.trim() &&
    explicitFloorContext.trim() !== "Unspecified Location"
  ) {
    return explicitFloorContext.trim();
  }

  // 3. Base semantic default floor for this room type
  const baseFloor = getBaseDefaultFloorForRoom(roomName);

  // 4. Special Locations (Terrace -> Terrace, Outdoor -> Outdoor) do NOT auto-increment
  if (SPECIAL_LOCATIONS.has(baseFloor)) {
    return baseFloor;
  }

  // 5. Match existing room instances by roomTypeId (preferred) or normalized name (fallback)
  const targetBaseName = normalizeBaseRoomName(roomName);
  const matchingRooms = existingRooms.filter((r) => {
    if (roomTypeId && r.roomTypeId && Number(r.roomTypeId) === Number(roomTypeId)) {
      return true;
    }
    const rName = r.customName ?? r.roomType?.name ?? "";
    return normalizeBaseRoomName(rName) === targetBaseName;
  });

  if (matchingRooms.length === 0) {
    return baseFloor;
  }

  // Collect occupied floors for this room type
  const occupiedFloors = new Set<string>();
  for (const r of matchingRooms) {
    if (r.subArea && r.subArea.trim() && r.subArea !== "Unspecified Location") {
      occupiedFloors.add(r.subArea.trim());
    }
  }

  // If base floor is not yet occupied by this room type, use it
  if (!occupiedFloors.has(baseFloor)) {
    return baseFloor;
  }

  // Find next available logical floor starting from baseFloor in STANDARD_FLOOR_SEQUENCE
  const baseIdx = STANDARD_FLOOR_SEQUENCE.indexOf(baseFloor);
  const startIdx = baseIdx !== -1 ? baseIdx : 0;

  for (let i = startIdx + 1; i < STANDARD_FLOOR_SEQUENCE.length; i++) {
    const candidateFloor = STANDARD_FLOOR_SEQUENCE[i];
    if (!SPECIAL_LOCATIONS.has(candidateFloor) && !occupiedFloors.has(candidateFloor)) {
      return candidateFloor;
    }
  }

  // Fallback: check sequence from start up to startIdx
  for (let i = 0; i < startIdx; i++) {
    const candidateFloor = STANDARD_FLOOR_SEQUENCE[i];
    if (!SPECIAL_LOCATIONS.has(candidateFloor) && !occupiedFloors.has(candidateFloor)) {
      return candidateFloor;
    }
  }

  return baseFloor;
}

/**
 * Resolves the effective floor location for a room instance.
 * Prefers explicitly assigned `subArea`. If missing/empty/Unspecified, calculates intelligent room default.
 */
export function getEffectiveFloorForRoom(
  room: QuotationRoom,
  allRooms: QuotationRoom[] = [],
  isMultiFloor = true
): string {
  if (room.subArea && room.subArea.trim() && room.subArea.trim() !== "Unspecified Location") {
    return room.subArea.trim();
  }

  const roomName = room.customName ?? room.roomType?.name ?? "";
  return calculateIntelligentDefaultFloor({
    roomTypeId: room.roomTypeId,
    roomName,
    existingRooms: allRooms,
    isMultiFloor,
  });
}
