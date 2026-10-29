/**
 * Rules for a company's quotation cover picture. Shared by the server (validation) and the client (the editor's own
 * checks and help text). The picture is shown 370 × 250 px on the cover, cropped to fill.
 */
export const COVER_IMAGE_SPEC = {
  maxBytes: 3 * 1024 * 1024,
  minWidth: 600,
  minHeight: 300,
  maxWidth: 6000,
  maxHeight: 6000,
  /** width / height */
  minAspect: 1,
  maxAspect: 3,
  recommended: "1480 × 1000 px (landscape) JPG or WebP",
} as const;

export function coverImageHelp(): string {
  const spec = COVER_IMAGE_SPEC;
  return `PNG, JPG or WebP, up to ${spec.maxBytes / (1024 * 1024)}MB, at least ${spec.minWidth}×${spec.minHeight} px, landscape (between 1:1 and 3:1). Recommended: ${spec.recommended}.`;
}

/** The problem with a picture's pixel size, or null when it is acceptable. */
export function coverImageProblem(size: { width: number; height: number }): string | null {
  const spec = COVER_IMAGE_SPEC;
  const actual = `this one is ${size.width}×${size.height}`;
  if (size.width < spec.minWidth || size.height < spec.minHeight) return `The cover image must be at least ${spec.minWidth}×${spec.minHeight} pixels (${actual}).`;
  if (size.width > spec.maxWidth || size.height > spec.maxHeight) return `The cover image must be no larger than ${spec.maxWidth}×${spec.maxHeight} pixels (${actual}).`;
  const ratio = size.width / size.height;
  if (ratio < spec.minAspect || ratio > spec.maxAspect) return `The cover image must be landscape, between 1:1 and 3:1 (${actual}).`;
  return null;
}
