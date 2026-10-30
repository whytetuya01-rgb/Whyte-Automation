import { connectMongoDB } from "@/lib/mongodb";
import { Company, Product } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { loadCompanyTaxSettings } from "@/lib/productTax";
import { formatGstRate } from "@/lib/taxSettings";
import { hsnCodeUpdateSchema } from "@/lib/validation/taxSettings";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

async function codeParam(context: RouteContext): Promise<string> {
  const code = decodeURIComponent((await context.params).code ?? "").trim();
  if (!/^\d{4,8}$/.test(code)) throw new ApiError("NOT_FOUND", "HSN/SAC code not found.", { field: "code" });
  return code;
}

/**
 * PATCH /api/catalog/tax-settings/hsn-codes/[code]
 *
 * Changes a code's description, default GST rate or active flag. The code itself never changes (products refer to
 * it). Changing the rate does not touch products: "Apply to products" does that, explicitly.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const code = await codeParam(context);
      const parsed = hsnCodeUpdateSchema.safeParse(await readJsonBody(req));
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
      if (input.gstRate !== undefined && !settings.gstRates.includes(input.gstRate)) {
        throw new ApiError("VALIDATION_ERROR", `${formatGstRate(input.gstRate)} is not one of your company's GST rates.`, { field: "gstRate" });
      }
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.description !== undefined) set["taxSettings.hsnCodes.$.description"] = input.description;
      if (input.gstRate !== undefined) set["taxSettings.hsnCodes.$.gstRate"] = input.gstRate;
      if (input.isActive !== undefined) set["taxSettings.hsnCodes.$.isActive"] = input.isActive;
      const result = await Company.updateOne({ _id: companyId, "taxSettings.hsnCodes.code": code }, { $set: set });
      if (result.matchedCount === 0) throw new ApiError("NOT_FOUND", "HSN/SAC code not found.", { field: "code" });
      const updated = (await loadCompanyTaxSettings(companyId)).hsnCodes.find((entry) => entry.code === code);
      return apiSuccess(updated);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/catalog/tax-settings/hsn-codes/[code]" });
  }
}

/**
 * DELETE /api/catalog/tax-settings/hsn-codes/[code]
 *
 * Removes a code nobody uses. A code on any product is refused: deactivate it instead, or move the products first.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const code = await codeParam(context);
      await connectMongoDB();
      const inUse = await Product.countDocuments({ hsnCode: code });
      if (inUse > 0) {
        throw new ApiError("CONFLICT", `${code} is used by ${inUse} product${inUse === 1 ? "" : "s"}. Deactivate it instead, or move those products to another code first.`, { field: "code" });
      }
      const result = await Company.updateOne(
        { _id: companyId, "taxSettings.hsnCodes.code": code },
        { $pull: { "taxSettings.hsnCodes": { code } }, $set: { updatedAt: new Date() } }
      );
      if (result.matchedCount === 0) throw new ApiError("NOT_FOUND", "HSN/SAC code not found.", { field: "code" });
      return apiSuccess({ code, deleted: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/catalog/tax-settings/hsn-codes/[code]" });
  }
}
