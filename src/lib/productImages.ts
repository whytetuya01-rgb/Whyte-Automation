/**
 * Product pictures: up to six per product, the first is the cover. Pure (no database), shared by the server and the screens.
 *
 * The cover is also stored in the product's older single-image fields (`imageUrl` / `imagePublicId`), which the quotation
 * PDF, the product pickers and the offline catalogue all read, so those keep working untouched. A product saved before
 * galleries existed has no `images`: its single image simply counts as the first (and only) picture, with no migration.
 */

export const MAX_PRODUCT_IMAGES = 6;

/** A picture address: an https link, or a static catalogue path that starts with a single "/". Nothing else (no data:, javascript:, http:). */
export const IMAGE_URL_PATTERN = /^(https:\/\/|\/(?!\/))\S+$/;
export const isAcceptableImageUrl = (url: string): boolean => IMAGE_URL_PATTERN.test(url);

export interface ProductImage {
  url: string;
  /** The Cloudinary asset id when we uploaded it; null for a static catalogue path or an external link. */
  publicId: string | null;
}

interface ImageSource {
  images?: ReadonlyArray<{ url?: string | null; publicId?: string | null }> | null;
  imageUrl?: string | null;
  imagePublicId?: string | null;
}

/** The product's pictures in order (cover first), from `images`, or from the single older image field. */
export function imagesOf(product: ImageSource): ProductImage[] {
  const gallery = (product.images ?? []).filter((image): image is { url: string; publicId?: string | null } => typeof image?.url === "string" && image.url.trim() !== "");
  if (gallery.length > 0) return gallery.slice(0, MAX_PRODUCT_IMAGES).map((image) => ({ url: image.url, publicId: image.publicId ?? null }));
  const legacy = product.imageUrl?.trim();
  return legacy ? [{ url: legacy, publicId: product.imagePublicId?.trim() || null }] : [];
}

/** What the older single-image fields must hold for this list: the first picture, or nothing. */
export function coverFields(images: ReadonlyArray<ProductImage>): { imageUrl: string | null; imagePublicId: string | null } {
  const cover = images[0];
  return { imageUrl: cover?.url ?? null, imagePublicId: cover?.publicId ?? null };
}

/** The picture to show for a variant: its own if it has one, otherwise the product's cover. */
export function variantImageUrl(variant: { imageUrl?: string | null }, product: ImageSource): string | null {
  return variant.imageUrl?.trim() || imagesOf(product)[0]?.url || null;
}

/** Uploaded assets that were in `before` and are no longer in `after`: the ones to delete from Cloudinary. */
export function removedPublicIds(before: ReadonlyArray<ProductImage>, after: ReadonlyArray<ProductImage>): string[] {
  const kept = new Set(after.map((image) => image.publicId).filter(Boolean));
  return [...new Set(before.map((image) => image.publicId).filter((id): id is string => Boolean(id) && !kept.has(id)))];
}

/** Moves the picture at `index` to `to` (clamped), keeping the rest in order. Returns a new list. */
export function moveImage(images: ReadonlyArray<ProductImage>, index: number, to: number): ProductImage[] {
  if (index < 0 || index >= images.length) return [...images];
  const target = Math.max(0, Math.min(images.length - 1, to));
  const next = [...images];
  const [picked] = next.splice(index, 1);
  next.splice(target, 0, picked);
  return next;
}

/**
 * An older client (or script) that still sets only the single image: the gallery follows it. A new cover replaces the first
 * picture (or becomes it); removing the cover drops the first picture. The rest of the gallery stays.
 */
export function withLegacyCover(images: ReadonlyArray<ProductImage>, cover: { imageUrl: string | null; imagePublicId: string | null }): ProductImage[] {
  const rest = images.slice(1).filter((image) => image.url !== cover.imageUrl);
  return cover.imageUrl ? [{ url: cover.imageUrl, publicId: cover.imagePublicId }, ...rest].slice(0, MAX_PRODUCT_IMAGES) : [...rest];
}
