import { connectMongoDB } from "@/lib/mongodb";
import { Product } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { withTransaction } from "@/lib/transaction";
import { applyGstRateToVariants, loadCompanyTaxSettings } from "@/lib/productTax";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

/**
 * POST /api/catalog/tax-settings/hsn-codes/[code]/apply
 *
 * Gives every product with this HSN/SAC code the code's GST rate, and re-splits their variants' GST-inclusive prices
 * by it. Prices, costs and existing quotations do not change (quotation items keep the tax snapshot they were added
 * with). All-or-nothing.
 */
export async function POST(_req: Request, context: RouteContext) {
  try {
    return await withPermission("catalog:edit", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const code = decodeURIComponent((await context.params).code ?? "").trim();
      await connectMongoDB();
      const entry = (await loadCompanyTaxSettings(companyId)).hsnCodes.find((row) => row.code === code);
      if (!entry) throw new ApiError("NOT_FOUND", "HSN/SAC code not found.", { field: "code" });

      const result = await withTransaction(async (session) => {
        let query = Product.find({ hsnCode: code }).select("_id").lean<Array<{ _id: number }>>();
        if (session) query = query.session(session);
        const productIds = (await query).map((row) => Number(row._id));
        if (productIds.length === 0) return { products: 0, variants: 0, changed: 0, realigned: 0 };
        const variants = await applyGstRateToVariants(productIds, entry.gstRate, session);
        await Product.updateMany({ _id: { $in: productIds } }, { $set: { gstRate: entry.gstRate, updatedAt: new Date() } }, session ? { session } : {});
        return { products: productIds.length, ...variants };
      });
      return apiSuccess({ code, gstRate: entry.gstRate, ...result });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/catalog/tax-settings/hsn-codes/[code]/apply" });
  }
}
