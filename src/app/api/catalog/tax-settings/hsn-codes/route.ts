import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { loadCompanyTaxSettings } from "@/lib/productTax";
import { TAX_LIMITS, formatGstRate } from "@/lib/taxSettings";
import { hsnCodeCreateSchema } from "@/lib/validation/taxSettings";

export const dynamic = "force-dynamic";

/**
 * POST /api/catalog/tax-settings/hsn-codes
 *
 * Adds an HSN (goods) or SAC (services) code to the acting company's list, with the GST rate a product gets when the
 * code is picked. Codes are unique per company; the insert is conditional, so two concurrent adds cannot both win.
 */
export async function POST(req: Request) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const parsed = hsnCodeCreateSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError("VALIDATION_ERROR", issue?.message ?? "Invalid HSN/SAC code.", {
          field: issue?.path.length ? String(issue.path[0]) : undefined,
          details: { issues: parsed.error.issues },
        });
      }
      const input = parsed.data;
      await connectMongoDB();
      const settings = await loadCompanyTaxSettings(companyId);
      if (!settings.gstRates.includes(input.gstRate)) {
        throw new ApiError("VALIDATION_ERROR", `${formatGstRate(input.gstRate)} is not one of your company's GST rates.`, { field: "gstRate" });
      }
      if (settings.hsnCodes.length >= TAX_LIMITS.hsnCodes) {
        throw new ApiError("VALIDATION_ERROR", `A company can keep up to ${TAX_LIMITS.hsnCodes} HSN/SAC codes.`, { field: "code" });
      }
      const entry = { code: input.code, kind: input.kind, description: input.description ?? null, gstRate: input.gstRate, isActive: input.isActive ?? true };
      const result = await Company.updateOne(
        { _id: companyId, "taxSettings.hsnCodes.code": { $ne: input.code } },
        { $push: { "taxSettings.hsnCodes": entry }, $set: { updatedAt: new Date() } }
      );
      if (result.matchedCount === 0) {
        throw new ApiError("DUPLICATE_RECORD", `${input.code} is already in your list.`, { field: "code" });
      }
      return apiSuccess(entry, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/catalog/tax-settings/hsn-codes" });
  }
}
