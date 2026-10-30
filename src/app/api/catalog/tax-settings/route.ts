import { connectMongoDB } from "@/lib/mongodb";
import { Company, Product } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { loadCompanyTaxSettings, productTaxUsage } from "@/lib/productTax";
import { formatGstRate } from "@/lib/taxSettings";
import { gstRatesSchema } from "@/lib/validation/taxSettings";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/tax-settings
 *
 * The acting company's GST rates, default rate and HSN/SAC codes, with how many products use each. Readable by anyone
 * who can read the catalogue; `canManage` tells the screen whether to offer edits (the write routes check it again).
 */
export async function GET() {
  try {
    return await withPermission("catalog:read", async (actor) => {
      requireActiveCompany(actor);
      await connectMongoDB();
      const [settings, usage] = await Promise.all([loadCompanyTaxSettings(actor.companyId as number), productTaxUsage()]);
      return apiSuccess({
        ...settings,
        hsnCodes: settings.hsnCodes.map((entry) => ({ ...entry, productCount: usage.byCode[entry.code] ?? 0 })),
        productsByRate: usage.byRate,
        unclassifiedProducts: usage.unclassified,
        totalProducts: usage.total,
        canManage: hasPermission(actor.role, actor.permissions, "catalog:edit"),
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/catalog/tax-settings" });
  }
}

/**
 * PUT /api/catalog/tax-settings
 *
 * Replaces the company's allowed GST rates and default rate. A rate still used by a product or an HSN/SAC code cannot
 * be removed. Nothing here changes a price or a quotation.
 */
export async function PUT(req: Request) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const parsed = gstRatesSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError("VALIDATION_ERROR", issue?.message ?? "Invalid GST rates.", {
          field: issue?.path.length ? String(issue.path[0]) : "gstRates",
          details: { issues: parsed.error.issues },
        });
      }
      await connectMongoDB();
      const current = await loadCompanyTaxSettings(companyId);
      const removed = current.gstRates.filter((rate) => !parsed.data.gstRates.includes(rate));
      for (const rate of removed) {
        const products = await Product.countDocuments({ gstRate: rate });
        const codes = current.hsnCodes.filter((entry) => entry.gstRate === rate).map((entry) => entry.code);
        if (products > 0 || codes.length > 0) {
          const users = [products > 0 ? `${products} product${products === 1 ? "" : "s"}` : null, codes.length > 0 ? `HSN/SAC ${codes.slice(0, 3).join(", ")}${codes.length > 3 ? "…" : ""}` : null].filter(Boolean).join(" and ");
          throw new ApiError("CONFLICT", `${formatGstRate(rate)} is still used by ${users}. Move them to another rate first.`, { field: "gstRates" });
        }
      }
      await Company.updateOne(
        { _id: companyId },
        { $set: { "taxSettings.gstRates": parsed.data.gstRates, "taxSettings.defaultGstRate": parsed.data.defaultGstRate, updatedAt: new Date() } }
      );
      return apiSuccess(await loadCompanyTaxSettings(companyId));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PUT /api/catalog/tax-settings" });
  }
}
