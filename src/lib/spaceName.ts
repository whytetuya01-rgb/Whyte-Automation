/**
 * Validation for a quotation-specific space (room) name. Mirrors `spaceNameSchema` in `lib/validation/quotation.ts`,
 * which the API enforces; this is the same rule for instant inline feedback.
 */
export const MAX_SPACE_NAME_LENGTH = 120;

export type SpaceNameResult = { ok: true; value: string } | { ok: false; message: string };

export function validateSpaceName(raw: string): SpaceNameResult {
  const value = raw.trim();
  if (!value) return { ok: false, message: "Space name cannot be empty." };
  if (value.length > MAX_SPACE_NAME_LENGTH) {
    return { ok: false, message: `Space name must be ${MAX_SPACE_NAME_LENGTH} characters or fewer.` };
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, message: "Space name cannot contain control characters." };
  return { ok: true, value };
}
