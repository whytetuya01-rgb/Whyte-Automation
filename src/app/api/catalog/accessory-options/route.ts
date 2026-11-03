import { connectMongoDB } from "@/lib/mongodb";
import { Product } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { cleanAccessoryIds, MAX_ACCESSORIES } from "@/lib/productAccessories";
import { parseSearchQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

const LIMIT = 30;

/**
 * GET /api/catalog/accessory-options?search=&ids=1,2,3
 *
 * The products a person can pick as suggested accessories (this company's own, by name or code), or the named ones by id (so
 * the product form can show what is already chosen). Names and pictures only: no prices.
 */
export async function GET(req: Request) {
  try {
    return await withPermission("catalog:read", async (actor) => {
      requireActiveCompany(actor);
      const params = new URL(req.url).searchParams;
      const search = parseSearchQueryParam(params, "search", { max: 100 });
      const rawIds = params.get("ids");
      const ids = rawIds ? cleanAccessoryIds(rawIds.split(",")) : [];
      if (ids.length > MAX_ACCESSORIES) throw new ApiError("VALIDATION_ERROR", `At most ${MAX_ACCESSORIES} ids.`, { field: "ids" });

      await connectMongoDB();
      const filter: Record<string, unknown> = {};
      if (ids.length > 0) filter._id = { $in: ids };
      else if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [{ name: rx }, { code: rx }];
        filter.isActive = { $ne: false };
      } else filter.isActive = { $ne: false };
      const products = await Product.find(filter).select("name code imageUrl isActive").sort({ name: 1 }).limit(LIMIT).lean<Array<{ _id: number; name: string; code?: string | null; imageUrl?: string | null; isActive?: boolean }>>();
      return apiSuccess(products.map((product) => ({ id: product._id, name: product.name, code: product.code ?? null, imageUrl: product.imageUrl ?? null, isActive: product.isActive !== false })));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/catalog/accessory-options" });
  }
}
