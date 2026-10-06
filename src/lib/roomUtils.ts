import { QuotationRoom } from "@/types";

/**
 * Calculates display name for a room instance.
 * If multiple rooms share the same base name (e.g. "Living Room"),
 * automatically generates display names: "Living Room", "Living Room 2", "Living Room 3", etc.
 * The automatically generated display name and Floor / Location remain separate values.
 */
export function getRoomDisplayName(
  room: QuotationRoom | null | undefined,
  allRooms?: QuotationRoom[]
): string {
  if (!room) return "Space";
  const baseName = room.customName ?? room.roomType?.name ?? "Room";
  if (!allRooms || allRooms.length === 0) return baseName;

  const currentRoomId = room.id ?? (room as any)._id;

  // Filter rooms that share the exact same base name
  const sameNameRooms = allRooms.filter((r) => {
    const rName = r.customName ?? r.roomType?.name ?? "Room";
    return rName.trim().toLowerCase() === baseName.trim().toLowerCase();
  });

  if (sameNameRooms.length <= 1) return baseName;

  const roomIdx = sameNameRooms.findIndex(
    (r) => (r.id ?? (r as any)._id) === currentRoomId
  );

  if (roomIdx > 0) {
    return `${baseName} ${roomIdx + 1}`;
  }

  return baseName;
}

/**
 * Returns full title formatted as:
 * "Living Room · First Floor"
 * or "Living Room 2 · Second Floor"
 */
export function getRoomFullTitle(
  room: QuotationRoom | null | undefined,
  allRooms?: QuotationRoom[],
  isMultiFloor = true
): string {
  if (!room) return "Space";
  const displayName = getRoomDisplayName(room, allRooms);
  const floorLocation = getEffectiveFloorForRoom(room, allRooms || [], isMultiFloor);
  if (floorLocation && floorLocation !== "Unspecified Location") {
    return `${displayName} · ${floorLocation}`;
  }
  return displayName;
}

export interface FloorRoomGroup {
  floor: string;
  rooms: QuotationRoom[];
}

import { getEffectiveFloorForRoom } from "@/lib/floorAssignment";

/**
 * Standard logical order for sorting floor groups.
 */
const FLOOR_ORDER = [
  "basement",
  "ground floor",
  "first floor",
  "second floor",
  "third floor",
  "fourth floor",
  "terrace",
  "outdoor",
  "other",
  "unspecified location",
];

export function groupRoomsByFloor(rooms: QuotationRoom[], isMultiFloor = true): FloorRoomGroup[] {
  if (!rooms || rooms.length === 0) return [];

  const groupsMap = new Map<string, QuotationRoom[]>();

  for (const room of rooms) {
    const floor = getEffectiveFloorForRoom(room, rooms, isMultiFloor);
    if (!groupsMap.has(floor)) {
      groupsMap.set(floor, []);
    }
    groupsMap.get(floor)!.push(room);
  }

  const getFloorIndex = (floorName: string) => {
    const lower = floorName.toLowerCase().trim();
    const idx = FLOOR_ORDER.indexOf(lower);
    if (idx !== -1) return idx;
    // Custom floor names go after standard floors but before Unspecified Location
    return 50;
  };

  return Array.from(groupsMap.entries())
    .map(([floor, rooms]) => ({ floor, rooms }))
    .sort((a, b) => getFloorIndex(a.floor) - getFloorIndex(b.floor));
}

/**
 * Determines whether a HouseType / property type supports multiple floors/locations.
 */
export function isMultiFloorHouseType(
  houseType?: { name?: string; isMultiFloor?: boolean } | null
): boolean {
  if (!houseType) return false;
  if (typeof houseType.isMultiFloor === "boolean") return houseType.isMultiFloor;

  const name = houseType.name?.toLowerCase().trim() || "";
  const multiFloorKeywords = [
    "duplex",
    "villa",
    "bungalow",
    "multi-floor",
    "multi floor",
    "multifloor",
    "row house",
    "penthouse",
    "triplex",
  ];

  return multiFloorKeywords.some((kw) => name.includes(kw));
}
