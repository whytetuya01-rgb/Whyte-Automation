/**
 * Centralized Room → Background Image Mapping
 *
 * Single source of truth for which premium background photo a room
 * preset/space card uses. Resolution order for any room name:
 *   1. Canonical key (exact, e.g. "kitchen")
 *   2. Known alias / naming-variant (e.g. "Home Theater" -> "home-theatre")
 *   3. Numbered-suffix strip (e.g. "Bedroom 5" -> "bedroom")
 *   4. Keyword/substring match against the same alias table (covers
 *      free-typed custom room names, e.g. "Kids Playroom" -> bedroom-3)
 *   5. Universal fallback (living-room)
 *
 * Image files live in /public/room-images/*.webp.
 */

export interface RoomImageEntry {
  /** File under /public/room-images, without extension. */
  file: string;
  /** CSS object-position vertical anchor, 0 (top) – 1 (bottom). */
  focalY: number;
  /** Decorative alt text (rooms also render a real text label, so this stays short). */
  alt: string;
}

export interface RoomImageSource {
  title: string;
  creator: string | null;
  source: "zip-upload" | "stocksnap" | "rawpixel";
  license: string;
  licenseUrl: string;
  landingUrl: string | null;
}

/** Canonical image entries. Keys are lowercase-kebab room identities. */
export const ROOM_IMAGES: Record<string, RoomImageEntry> = {
  "living-room": { file: "living-room", focalY: 0.55, alt: "Living room" },
  "master-bedroom": { file: "master-bedroom", focalY: 0.5, alt: "Master bedroom" },
  "home-theatre": { file: "home-theatre", focalY: 0.45, alt: "Home theatre" },
  "bedroom-3": { file: "bedroom-3", focalY: 0.5, alt: "Bedroom" },
  "dining-room": { file: "dining-room", focalY: 0.5, alt: "Dining room" },
  "bedroom-2": { file: "bedroom-2", focalY: 0.5, alt: "Bedroom" },
  kitchen: { file: "kitchen", focalY: 0.5, alt: "Kitchen" },
  "entrance-foyer": { file: "entrance-foyer", focalY: 0.55, alt: "Entrance / foyer" },
  terrace: { file: "terrace", focalY: 0.55, alt: "Terrace" },
  bedroom: { file: "bedroom", focalY: 0.45, alt: "Bedroom" },
  balcony: { file: "balcony", focalY: 0.5, alt: "Balcony" },
  "home-office": { file: "home-office", focalY: 0.45, alt: "Home office" },
  garden: { file: "garden", focalY: 0.4, alt: "Garden" },
  staircase: { file: "staircase", focalY: 0.35, alt: "Staircase" },
};

/** Exact-name / naming-variant aliases -> canonical ROOM_IMAGES key. */
const NAME_ALIASES: Record<string, string> = {
  "living room": "living-room",
  "master bedroom": "master-bedroom",
  "home theatre": "home-theatre",
  "home theater": "home-theatre",
  "bedroom 3": "bedroom-3",
  "dining room": "dining-room",
  dining: "dining-room",
  "bedroom 2": "bedroom-2",
  kitchen: "kitchen",
  "entrance / foyer": "entrance-foyer",
  "entrance/foyer": "entrance-foyer",
  "entrance foyer": "entrance-foyer",
  foyer: "entrance-foyer",
  entrance: "entrance-foyer",
  terrace: "terrace",
  bedroom: "bedroom",
  balcony: "balcony",
  "balcony 1": "balcony",
  "balcony 2": "balcony",
  "home office": "home-office",
  garden: "garden",
  staircase: "staircase",

  // Tier 2 — no dedicated photo; aliased to the closest semantically related room.
  "guest room": "bedroom",
  "kids room": "bedroom-3",
  "kid's room": "bedroom-3",
  "study room": "home-office",
  "utility room": "kitchen",
  laundry: "kitchen",
  "store room": "kitchen",
  corridor: "entrance-foyer",
  "common area": "living-room",

  // Tier 3 — no close relative available; universal fallback.
  gym: "living-room",
  "puja room": "living-room",
  garage: "living-room",
  "servant room": "living-room",
  "driver room": "living-room",
};

/** Keyword rules for free-typed custom room names, checked in order (first match wins). */
const KEYWORD_RULES: Array<{ keywords: string[]; target: string }> = [
  { keywords: ["master bedroom"], target: "master-bedroom" },
  { keywords: ["guest"], target: "bedroom" },
  { keywords: ["kid", "nursery", "playroom"], target: "bedroom-3" },
  { keywords: ["bedroom", "bed room"], target: "bedroom" },
  { keywords: ["living"], target: "living-room" },
  { keywords: ["dining"], target: "dining-room" },
  { keywords: ["kitchen"], target: "kitchen" },
  { keywords: ["theatre", "theater", "cinema"], target: "home-theatre" },
  { keywords: ["foyer", "entrance", "lobby"], target: "entrance-foyer" },
  { keywords: ["corridor", "hallway", "passage"], target: "entrance-foyer" },
  { keywords: ["terrace"], target: "terrace" },
  { keywords: ["balcony"], target: "balcony" },
  { keywords: ["garden", "backyard", "lawn", "patio"], target: "garden" },
  { keywords: ["staircase", "stairway", "stairs"], target: "staircase" },
  { keywords: ["office", "study", "work room", "workroom"], target: "home-office" },
  { keywords: ["utility", "laundry", "store", "storage", "pantry", "closet"], target: "kitchen" },
  { keywords: ["gym", "fitness", "exercise"], target: "living-room" },
  { keywords: ["puja", "pooja", "mandir", "prayer", "temple"], target: "living-room" },
  { keywords: ["garage", "parking"], target: "living-room" },
  { keywords: ["servant", "driver", "staff"], target: "living-room" },
  { keywords: ["common area", "clubhouse", "lounge"], target: "living-room" },
];

/** Final catch-all when nothing else matches. */
const UNIVERSAL_FALLBACK_KEY = "living-room";

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Strips a trailing " 2", " 3", " four", etc. so "Bedroom 5" resolves like "Bedroom". */
function stripNumberedSuffix(name: string): string {
  return name.replace(/\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i, "").trim();
}

/**
 * Resolves the best background image for a room/space name.
 * Never throws — always returns a usable entry (falls back to the
 * universal fallback image if nothing matches).
 */
export function getRoomImage(roomName: string | null | undefined): RoomImageEntry {
  const raw = roomName ?? "";
  const normalized = normalize(raw);

  if (!normalized) return ROOM_IMAGES[UNIVERSAL_FALLBACK_KEY];

  if (ROOM_IMAGES[normalized]) return ROOM_IMAGES[normalized];
  if (NAME_ALIASES[normalized]) return ROOM_IMAGES[NAME_ALIASES[normalized]];

  const stripped = stripNumberedSuffix(normalized);
  if (stripped !== normalized) {
    if (ROOM_IMAGES[stripped]) return ROOM_IMAGES[stripped];
    if (NAME_ALIASES[stripped]) return ROOM_IMAGES[NAME_ALIASES[stripped]];
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => normalized.includes(kw))) {
      return ROOM_IMAGES[rule.target];
    }
  }

  return ROOM_IMAGES[UNIVERSAL_FALLBACK_KEY];
}

/** Public path for a resolved room image entry, e.g. "/room-images/kitchen.webp". */
export function roomImageSrc(entry: RoomImageEntry): string {
  return `/room-images/${entry.file}.webp`;
}

/**
 * Attribution / licensing metadata for every sourced photo. Kept alongside
 * the mapping so provenance travels with the code that uses it.
 */
export const ROOM_IMAGE_SOURCES: Record<string, RoomImageSource> = {
  "living-room": { title: "Living room", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  "master-bedroom": { title: "Master bedroom", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  "home-theatre": { title: "Home Theater", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  "bedroom-3": { title: "Bedroom 3", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  "dining-room": { title: "Dining room", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  "bedroom-2": { title: "Bedroom 2", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  kitchen: { title: "Kitchen", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  "entrance-foyer": { title: "Entrance foyer", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  terrace: { title: "Terrace", creator: null, source: "zip-upload", license: "Provided by user", licenseUrl: "", landingUrl: null },
  bedroom: {
    title: "Modern Room",
    creator: "World Travel Adventures",
    source: "stocksnap",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://stocksnap.io/photo/modern-room-ORRHZ1VULX",
  },
  balcony: {
    title: "Sitting Area Toward City",
    creator: null,
    source: "rawpixel",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.rawpixel.com/image/6082603/sitting-area-toward-city",
  },
  "home-office": {
    title: "Home Office",
    creator: "Matt Bango",
    source: "stocksnap",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://stocksnap.io/photo/home-office-TTSZNHYKJD",
  },
  garden: {
    title: "Patio Furniture",
    creator: "Matt Bango",
    source: "stocksnap",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://stocksnap.io/photo/patio-furniture-ZIU3AC46X4",
  },
  staircase: {
    title: "Modern staircase house",
    creator: null,
    source: "rawpixel",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.rawpixel.com/image/6042740/photo-image-public-domain-house-home",
  },
};
