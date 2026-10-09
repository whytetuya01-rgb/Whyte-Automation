/**
 * Centralized House Type → Background Image Mapping
 *
 * Same pattern as roomImageMap.ts: a single source of truth for which photo
 * a house-type card uses. Mapped explicitly by house-type `id` (the stable
 * database primary key) rather than by name or array position, so renaming
 * a house type in /admin/house-types never silently breaks its image, and a
 * brand-new, unmapped house type always falls back gracefully instead of
 * borrowing another entry's picture.
 *
 * Image files live in /public/house-type-images/*.webp, except "duplex"
 * which reuses the existing /public/room-images/staircase.webp asset (same
 * photo already used for the Staircase room card) rather than sourcing a
 * near-duplicate image.
 */

export interface HouseTypeImageEntry {
  /** Public path to the image, e.g. "/house-type-images/villa.webp". */
  src: string;
  /** CSS object-position vertical anchor, 0 (top) – 1 (bottom). */
  focalY: number;
  /** Decorative alt text (cards also render a real text title). */
  alt: string;
}

export interface HouseTypeImageSource {
  title: string;
  creator: string | null;
  source: "rawpixel" | "flickr";
  license: string;
  licenseUrl: string;
  landingUrl: string;
}

/** Keyed by HouseType._id. */
export const HOUSE_TYPE_IMAGES: Record<number, HouseTypeImageEntry> = {
  1: { src: "/house-type-images/1-bhk.webp", focalY: 0.45, alt: "1 BHK apartment" },
  2: { src: "/house-type-images/2-bhk.webp", focalY: 0.5, alt: "2 BHK apartment" },
  3: { src: "/house-type-images/3-bhk.webp", focalY: 0.45, alt: "3 BHK apartment" },
  4: { src: "/house-type-images/4-bhk.webp", focalY: 0.5, alt: "4 BHK residence" },
  5: { src: "/room-images/staircase.webp", focalY: 0.35, alt: "Duplex" },
  6: { src: "/house-type-images/villa.webp", focalY: 0.55, alt: "Villa" },
  7: { src: "/house-type-images/penthouse.webp", focalY: 0.5, alt: "Penthouse" },
  12: { src: "/house-type-images/residential-apartment.webp", focalY: 0.5, alt: "Residential apartment" },
  13: { src: "/house-type-images/luxury-villa.webp", focalY: 0.55, alt: "Luxury villa" },
  14: { src: "/house-type-images/commercial-retail.webp", focalY: 0.5, alt: "Commercial / retail space" },
  15: { src: "/house-type-images/corporate-office.webp", focalY: 0.55, alt: "Corporate office" },
  16: { src: "/house-type-images/hospitality-hotel.webp", focalY: 0.5, alt: "Hospitality / hotel" },
};

/** Universal fallback for a house type with no mapped image (e.g. a brand-new one). */
const FALLBACK_IMAGE: HouseTypeImageEntry = {
  src: "/house-type-images/residential-apartment.webp",
  focalY: 0.5,
  alt: "House type",
};

/** Resolves the background image for a house type id. Never throws. */
export function getHouseTypeImage(houseTypeId: number | null | undefined): HouseTypeImageEntry {
  if (houseTypeId == null) return FALLBACK_IMAGE;
  return HOUSE_TYPE_IMAGES[houseTypeId] ?? FALLBACK_IMAGE;
}

/**
 * Attribution / licensing metadata for every sourced photo, keyed the same
 * way as HOUSE_TYPE_IMAGES. Kept alongside the mapping so provenance travels
 * with the code that uses it (same convention as ROOM_IMAGE_SOURCES).
 */
export const HOUSE_TYPE_IMAGE_SOURCES: Record<number, HouseTypeImageSource> = {
  1: {
    title: "Modern Bed Room with wooden bed and white pillows",
    creator: "Foto Miki Digital",
    source: "flickr",
    license: "Public Domain Mark 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    landingUrl: "https://www.flickr.com/photos/96511847@N04/9200512623",
  },
  2: {
    title: "Minimalist lounge",
    creator: "Foto Miki Digital",
    source: "flickr",
    license: "Public Domain Mark 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    landingUrl: "https://www.flickr.com/photos/96511847@N04/9200887261",
  },
  3: {
    title: "Black and white living room",
    creator: "Foto Miki Digital",
    source: "flickr",
    license: "Public Domain Mark 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    landingUrl: "https://www.flickr.com/photos/96511847@N04/9203927284",
  },
  4: {
    title: "Modern dining room interior with sea / ocean view",
    creator: "Foto Miki Digital",
    source: "flickr",
    license: "Public Domain Mark 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    landingUrl: "https://www.flickr.com/photos/96511847@N04/9199999759",
  },
  // 5 (Duplex) intentionally omitted: reuses the existing staircase.webp,
  // whose attribution already lives in ROOM_IMAGE_SOURCES.
  6: {
    title: "Modern house design, dusk exterior with pool",
    creator: null,
    source: "rawpixel",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.rawpixel.com/image/5919803/photo-image-public-domain-house-interior",
  },
  7: {
    title: "View toward city",
    creator: null,
    source: "rawpixel",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.rawpixel.com/image/6082584/view-toward-city",
  },
  12: {
    title: "Apartment building exterior",
    creator: null,
    source: "rawpixel",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.rawpixel.com/image/3293345/free-photo-image-apartment-building-architecture-banister",
  },
  13: {
    title: "Tropical pool",
    creator: "Artem Beliaikin",
    source: "flickr",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.flickr.com/photos/157635012@N07/49390283161",
  },
  14: {
    title: "Women's clothes on hangers",
    creator: "Artem Beliaikin",
    source: "flickr",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.flickr.com/photos/157635012@N07/50179598477",
  },
  15: {
    title: "Orderly computer workspace",
    creator: null,
    source: "rawpixel",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.rawpixel.com/image/3283105/free-photo-image-desk-office-home-working",
  },
  16: {
    title: "Hotel bedroom decor interior",
    creator: null,
    source: "rawpixel",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    landingUrl: "https://www.rawpixel.com/image/6036396/photo-image-public-domain-wood-house",
  },
};
