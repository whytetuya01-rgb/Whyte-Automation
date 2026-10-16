/**
 * Cloudinary path conventions and ownership rules for product images.
 *
 *  - NEW uploads go to `whyte/companies/<companyId>/products/…`. The company
 *    id comes from the server-side tenant context, never from the client.
 *  - EXISTING assets live in the legacy flat folder `whyte/products/…`. They
 *    were all uploaded before companies existed, so they belong to exactly one
 *    company: the default company the Phase 1 migration created (slug
 *    `whyte`). Their URLs and public ids are left exactly as they are —
 *    nothing is renamed or re-uploaded, so historical quotations and PDFs keep
 *    rendering.
 *
 * A public id is manageable (replace / delete) by a company only if it is in
 * that company's own folder, or it is a legacy asset AND that company is the
 * legacy owner. Anything else — another company's folder, a legacy asset when
 * you are not the legacy owner, a path outside the product folders, or a
 * malformed/traversal path — is refused. The decision is made from the path
 * and the caller's session alone, so it cannot be influenced by request data
 * other than the id being acted on.
 */

export const COMPANY_UPLOAD_ROOT = "whyte/companies";
export const LEGACY_PRODUCT_FOLDER = "whyte/products";

/** Folder that every NEW product image upload for this company goes into. */
export function companyProductFolder(companyId: number): string {
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error("A positive integer companyId is required to build an upload folder.");
  }
  return `${COMPANY_UPLOAD_ROOT}/${companyId}/products`;
}

/** Conservative shape check: slash-separated segments of letters, digits, `_` and `-`; no traversal, no empty segments. */
export function isSafePublicId(publicId: string): boolean {
  if (publicId.length === 0 || publicId.length > 255) return false;
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(publicId)) return false;
  return true;
}

export type ImageOwnership =
  | "own" // in this company's folder, or a legacy asset and this company is the legacy owner
  | "foreign" // another company's folder, or a legacy asset this company does not own
  | "outside" // not a product-image path at all
  | "malformed";

export function classifyImagePublicId(
  publicId: string,
  caller: { companyId: number; legacyOwnerCompanyId: number | null }
): ImageOwnership {
  if (!isSafePublicId(publicId)) return "malformed";

  const ownPrefix = `${companyProductFolder(caller.companyId)}/`;
  if (publicId.startsWith(ownPrefix)) return "own";

  if (publicId.startsWith(`${COMPANY_UPLOAD_ROOT}/`)) return "foreign";

  if (publicId.startsWith(`${LEGACY_PRODUCT_FOLDER}/`)) {
    return caller.legacyOwnerCompanyId === caller.companyId ? "own" : "foreign";
  }

  return "outside";
}

/** Whether `caller` may attach, replace or delete this asset. */
export function canManageImage(
  publicId: string,
  caller: { companyId: number; legacyOwnerCompanyId: number | null }
): boolean {
  return classifyImagePublicId(publicId, caller) === "own";
}
