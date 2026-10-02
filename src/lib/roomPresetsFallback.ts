/**
 * Centralized Room Presets & Fallback Configuration Layer
 *
 * This file provides:
 * 1. Default room preset descriptions, icons, and device hints.
 * 2. Static fallback room presets and house-type templates if database records
 *    are temporarily unavailable or empty.
 * 3. Resolvers that merge DB-driven HouseType / RoomType records with UI metadata.
 */

import { HouseType, RoomType, HouseTypeRoomTemplate } from "@/types";
import { isBathroomLikeRoomName } from "@/lib/utils";

export interface ResolvedRoomPreset {
  id?: number;
  roomTypeId?: number;
  name: string;
  icon?: string | null;
  description: string;
  defaultDevicesHint: string;
  defaultCount: number;
  isRecommended?: boolean;
}

/**
 * Standard device counts and descriptions for known room types.
 * Used to enrich both DB-stored RoomTypes and fallback presets.
 */
export const ROOM_METADATA_MAP: Record<
  string,
  { description: string; defaultDevicesHint: string; defaultCount: number }
> = {
  "living room": {
    description: "Lighting, fan automation & smart mood scenes",
    defaultDevicesHint: "3-4 devices",
    defaultCount: 1,
  },
  "master bedroom": {
    description: "Dimming, bedside controls, curtains & comfort",
    defaultDevicesHint: "3 devices",
    defaultCount: 1,
  },
  "bedroom": {
    description: "Standard comfort lighting & fan control",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "bedroom 2": {
    description: "Secondary bedroom automation & fan control",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "bedroom 3": {
    description: "Guest / kids bedroom automation & comfort",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "bedroom 4": {
    description: "Additional bedroom lighting & comfort scenes",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "kitchen": {
    description: "Task lighting, exhaust fan & appliance safety",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "dining room": {
    description: "Chandelier dimming & dining ambient scenes",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "dining": {
    description: "Chandelier dimming & dining ambient scenes",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "balcony": {
    description: "Weather-proof lighting & evening automations",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "balcony 1": {
    description: "Primary balcony lighting & evening scene",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "balcony 2": {
    description: "Secondary balcony lighting automation",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "study room": {
    description: "Focus lighting, desk automation & power tracking",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "home office": {
    description: "Focus workstation scenes, lighting & equipment",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "home theatre": {
    description: "Immersive cinema lighting, acoustics & RGB scenes",
    defaultDevicesHint: "4 devices",
    defaultCount: 1,
  },
  "entrance / foyer": {
    description: "Welcome scene, hallway lighting & sensor controls",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "foyer": {
    description: "Welcome scene, hallway lighting & sensor controls",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "entrance": {
    description: "Welcome scene, hallway lighting & sensor controls",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "utility room": {
    description: "Task lighting & utility equipment automation",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "laundry": {
    description: "Convenience lighting & appliance controls",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "terrace": {
    description: "Outdoor architectural & landscape lighting",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "garden": {
    description: "Landscape pathways & ambient garden scenes",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "gym": {
    description: "Energizing lighting & climate controls",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "puja room": {
    description: "Serene devotional lighting & spotlight accents",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "store room": {
    description: "Convenience lighting with motion sensors",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "corridor": {
    description: "Pathway guide lights & night automations",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "staircase": {
    description: "Step lighting & two-way automation control",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "garage": {
    description: "Motion-activated parking lights & shutter controls",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "common area": {
    description: "Central hallway & circulation illumination",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  },
  "servant room": {
    description: "Essential lighting & fan control",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
  "driver room": {
    description: "Essential lighting & fan control",
    defaultDevicesHint: "1 device",
    defaultCount: 1,
  },
};

/**
 * Helper to fetch descriptive metadata for any room name.
 */
export function getRoomMetadata(roomName: string): {
  description: string;
  defaultDevicesHint: string;
  defaultCount: number;
} {
  const normalized = roomName.trim().toLowerCase();
  if (ROOM_METADATA_MAP[normalized]) {
    return ROOM_METADATA_MAP[normalized];
  }

  // Substring matches
  for (const [key, value] of Object.entries(ROOM_METADATA_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }

  return {
    description: "Smart lighting, fan and appliance automation",
    defaultDevicesHint: "2 devices",
    defaultCount: 1,
  };
}

/**
 * Universal fallback room presets if DB contains no RoomTypes.
 */
export const FALLBACK_ROOM_PRESETS: Array<{
  name: string;
  icon?: string;
  defaultCount: number;
}> = [
  { name: "Living Room", defaultCount: 1 },
  { name: "Master Bedroom", defaultCount: 1 },
  { name: "Bedroom", defaultCount: 1 },
  { name: "Kitchen", defaultCount: 1 },
  { name: "Dining Room", defaultCount: 1 },
  { name: "Balcony", defaultCount: 1 },
  { name: "Study Room", defaultCount: 1 },
  { name: "Home Theatre", defaultCount: 1 },
  { name: "Entrance / Foyer", defaultCount: 1 },
  { name: "Utility Room", defaultCount: 1 },
];

/**
 * Fallback room associations per House Type if DB has no HouseTypeRoomTemplate rows.
 */
export const FALLBACK_HOUSE_TYPE_TEMPLATES: Record<
  string,
  Array<{ name: string; defaultCount: number }>
> = {
  "1 bhk": [
    { name: "Living Room", defaultCount: 1 },
    { name: "Master Bedroom", defaultCount: 1 },
    { name: "Kitchen", defaultCount: 1 },
    { name: "Dining Room", defaultCount: 1 },
    { name: "Balcony", defaultCount: 1 },
  ],
  "2 bhk": [
    { name: "Living Room", defaultCount: 1 },
    { name: "Master Bedroom", defaultCount: 1 },
    { name: "Bedroom", defaultCount: 1 },
    { name: "Kitchen", defaultCount: 1 },
    { name: "Dining Room", defaultCount: 1 },
    { name: "Balcony", defaultCount: 1 },
  ],
  "3 bhk": [
    { name: "Living Room", defaultCount: 1 },
    { name: "Master Bedroom", defaultCount: 1 },
    { name: "Bedroom 2", defaultCount: 1 },
    { name: "Bedroom 3", defaultCount: 1 },
    { name: "Kitchen", defaultCount: 1 },
    { name: "Dining Room", defaultCount: 1 },
    { name: "Balcony", defaultCount: 2 },
    { name: "Entrance / Foyer", defaultCount: 1 },
  ],
  "4 bhk": [
    { name: "Living Room", defaultCount: 1 },
    { name: "Master Bedroom", defaultCount: 1 },
    { name: "Bedroom 2", defaultCount: 1 },
    { name: "Bedroom 3", defaultCount: 1 },
    { name: "Guest Room", defaultCount: 1 },
    { name: "Kitchen", defaultCount: 1 },
    { name: "Dining Room", defaultCount: 1 },
    { name: "Balcony", defaultCount: 2 },
    { name: "Study Room", defaultCount: 1 },
    { name: "Entrance / Foyer", defaultCount: 1 },
  ],
  "duplex": [
    { name: "Living Room", defaultCount: 1 },
    { name: "Master Bedroom", defaultCount: 1 },
    { name: "Bedroom", defaultCount: 1 },
    { name: "Kitchen", defaultCount: 1 },
    { name: "Dining Room", defaultCount: 1 },
    { name: "Balcony", defaultCount: 2 },
    { name: "Staircase", defaultCount: 1 },
    { name: "Terrace", defaultCount: 1 },
    { name: "Entrance / Foyer", defaultCount: 1 },
  ],
  "villa": [
    { name: "Living Room", defaultCount: 1 },
    { name: "Master Bedroom", defaultCount: 1 },
    { name: "Bedroom 2", defaultCount: 1 },
    { name: "Guest Room", defaultCount: 1 },
    { name: "Kitchen", defaultCount: 1 },
    { name: "Dining Room", defaultCount: 1 },
    { name: "Home Theatre", defaultCount: 1 },
    { name: "Garden", defaultCount: 1 },
    { name: "Balcony", defaultCount: 2 },
    { name: "Entrance / Foyer", defaultCount: 1 },
  ],
  "penthouse": [
    { name: "Living Room", defaultCount: 1 },
    { name: "Master Bedroom", defaultCount: 1 },
    { name: "Bedroom 2", defaultCount: 1 },
    { name: "Bedroom 3", defaultCount: 1 },
    { name: "Kitchen", defaultCount: 1 },
    { name: "Dining Room", defaultCount: 1 },
    { name: "Terrace", defaultCount: 1 },
    { name: "Home Theatre", defaultCount: 1 },
    { name: "Balcony", defaultCount: 2 },
    { name: "Entrance / Foyer", defaultCount: 1 },
  ],
};

/**
 * Resolves available room presets based on:
 * 1. Selected House Type & its DB room templates
 * 2. Available active RoomTypes in DB
 * 3. Centralized static fallback configuration if DB is empty
 */
export function resolveRoomPresets({
  houseType,
  allRoomTypes = [],
}: {
  houseType?: HouseType | null;
  allRoomTypes?: RoomType[];
}): {
  recommendedPresets: ResolvedRoomPreset[];
  otherPresets: ResolvedRoomPreset[];
  allPresets: ResolvedRoomPreset[];
} {
  // Filter out any bathroom-like rooms per Whyte business rules
  const activeRoomTypes = allRoomTypes
    .filter((rt) => rt.isActive && !isBathroomLikeRoomName(rt.name))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  // Map to index DB room types by lowercase name and by id
  const dbRoomByName = new Map<string, RoomType>();
  const dbRoomById = new Map<number, RoomType>();
  activeRoomTypes.forEach((rt) => {
    dbRoomByName.set(rt.name.trim().toLowerCase(), rt);
    dbRoomById.set(rt.id, rt);
  });

  const recommendedPresets: ResolvedRoomPreset[] = [];
  const recommendedNames = new Set<string>();
  const recommendedIds = new Set<number>();

  // 1. Try DB Room Template for the selected HouseType
  if (houseType && Array.isArray(houseType.roomTemplate) && houseType.roomTemplate.length > 0) {
    const validTemplates = houseType.roomTemplate.filter((t) => {
      const roomName = t.roomType?.name || dbRoomById.get(t.roomTypeId)?.name;
      return roomName && !isBathroomLikeRoomName(roomName);
    });

    validTemplates.forEach((t) => {
      const dbRoom = t.roomType || dbRoomById.get(t.roomTypeId);
      const name = dbRoom?.name || `Room ${t.roomTypeId}`;
      const meta = getRoomMetadata(name);

      recommendedNames.add(name.toLowerCase());
      recommendedIds.add(t.roomTypeId);

      recommendedPresets.push({
        id: dbRoom?.id ?? t.roomTypeId,
        roomTypeId: t.roomTypeId,
        name,
        icon: dbRoom?.icon ?? null,
        description: meta.description,
        defaultDevicesHint: meta.defaultDevicesHint,
        defaultCount: t.defaultCount || meta.defaultCount || 1,
        isRecommended: true,
      });
    });
  }

  // 2. If no DB template found, check fallback house type template
  if (houseType && recommendedPresets.length === 0) {
    const htNameLower = houseType.name.trim().toLowerCase();
    let fallbackTemplateList = FALLBACK_HOUSE_TYPE_TEMPLATES[htNameLower];

    if (!fallbackTemplateList) {
      for (const [key, list] of Object.entries(FALLBACK_HOUSE_TYPE_TEMPLATES)) {
        if (htNameLower.includes(key)) {
          fallbackTemplateList = list;
          break;
        }
      }
    }

    if (fallbackTemplateList) {
      fallbackTemplateList.forEach((item) => {
        const matchedDbRoom =
          dbRoomByName.get(item.name.toLowerCase()) ||
          activeRoomTypes.find((r) => r.name.toLowerCase().includes(item.name.toLowerCase()));

        const meta = getRoomMetadata(item.name);
        const id = matchedDbRoom ? matchedDbRoom.id : undefined;

        if (id) recommendedIds.add(id);
        recommendedNames.add(item.name.toLowerCase());

        recommendedPresets.push({
          id,
          roomTypeId: id,
          name: matchedDbRoom ? matchedDbRoom.name : item.name,
          icon: matchedDbRoom?.icon ?? null,
          description: meta.description,
          defaultDevicesHint: meta.defaultDevicesHint,
          defaultCount: item.defaultCount || meta.defaultCount || 1,
          isRecommended: true,
        });
      });
    }
  }

  // 3. Resolve other / remaining room presets
  const otherPresets: ResolvedRoomPreset[] = [];

  if (activeRoomTypes.length > 0) {
    // Add all remaining active DB RoomTypes
    activeRoomTypes.forEach((rt) => {
      const isAlreadyRecommended =
        (rt.id && recommendedIds.has(rt.id)) ||
        recommendedNames.has(rt.name.trim().toLowerCase());

      if (!isAlreadyRecommended) {
        const meta = getRoomMetadata(rt.name);
        otherPresets.push({
          id: rt.id,
          roomTypeId: rt.id,
          name: rt.name,
          icon: rt.icon ?? null,
          description: meta.description,
          defaultDevicesHint: meta.defaultDevicesHint,
          defaultCount: meta.defaultCount || 1,
          isRecommended: false,
        });
      }
    });
  } else {
    // DB has no RoomTypes at all -> Use centralized FALLBACK_ROOM_PRESETS
    FALLBACK_ROOM_PRESETS.forEach((preset) => {
      const isAlreadyRecommended = recommendedNames.has(preset.name.toLowerCase());
      if (!isAlreadyRecommended) {
        const meta = getRoomMetadata(preset.name);
        otherPresets.push({
          name: preset.name,
          icon: preset.icon ?? null,
          description: meta.description,
          defaultDevicesHint: meta.defaultDevicesHint,
          defaultCount: preset.defaultCount || meta.defaultCount || 1,
          isRecommended: false,
        });
      }
    });
  }

  const allPresets = [...recommendedPresets, ...otherPresets];

  return {
    recommendedPresets,
    otherPresets,
    allPresets,
  };
}
