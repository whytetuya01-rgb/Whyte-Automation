import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { ApiError } from "@/lib/api-response";
import { canManageImage } from "@/lib/uploadPaths";

/**
 * The company that owns the legacy flat `whyte/products/` assets: the default
 * company the Phase 1 migration created (slug `whyte`). `null` if there isn't
 * one — in which case no company owns legacy assets and none can manage them.
 */
export const LEGACY_ASSET_OWNER_SLUG = "whyte";

export async function resolveLegacyOwnerCompanyId(): Promise<number | null> {
  await connectMongoDB();
  const company = await Company.findOne({ slug: LEGACY_ASSET_OWNER_SLUG }).select("_id").lean();
  return company?._id ?? null;
}

/**
 * Throws 403 unless `companyId` may manage the Cloudinary asset `publicId`.
 * Used before attaching an image to a product and before deleting one, so a
 * request can never point at, adopt, or destroy another company's asset.
 */
export async function assertImageManageable(publicId: string, companyId: number): Promise<void> {
  const legacyOwnerCompanyId = await resolveLegacyOwnerCompanyId();
  if (!canManageImage(publicId, { companyId, legacyOwnerCompanyId })) {
    throw new ApiError("FORBIDDEN", "That image does not belong to your company.", { field: "publicId" });
  }
}

/**
 * Validates the `imagePublicId` of a product being created or edited.
 * An unchanged value is always accepted (existing data is never invalidated);
 * a new value must be an asset the caller's company owns.
 */
export async function assertProductImageAllowed(
  nextPublicId: string | null | undefined,
  companyId: number,
  currentPublicId?: string | null
): Promise<void> {
  const next = typeof nextPublicId === "string" ? nextPublicId.trim() : "";
  if (!next) return;
  if (currentPublicId && next === currentPublicId) return;
  try {
    await assertImageManageable(next, companyId);
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ApiError("FORBIDDEN", "That image does not belong to your company.", { field: "imagePublicId" });
    }
    throw error;
  }
}
