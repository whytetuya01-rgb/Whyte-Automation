import { Product } from "@/models";
import { ApiError } from "@/lib/api-response";
import { MAX_ACCESSORIES, cleanAccessoryIds } from "@/lib/productAccessories";

/**
 * Checks the accessories a product is being saved with: at most 20, not the product itself, and every one a product of this
 * company (the query is company-scoped, so another company's product simply is not found). Returns the cleaned list.
 */
export async function assertAccessoriesAllowed(ids: unknown, selfId?: number): Promise<number[]> {
  const cleaned = cleanAccessoryIds(ids);
  if (cleaned.length > MAX_ACCESSORIES) throw new ApiError("VALIDATION_ERROR", `A product can suggest up to ${MAX_ACCESSORIES} accessories.`, { field: "accessoryIds" });
  if (selfId !== undefined && cleaned.includes(selfId)) throw new ApiError("VALIDATION_ERROR", "A product cannot be its own accessory.", { field: "accessoryIds" });
  if (cleaned.length === 0) return [];
  const found = await Product.countDocuments({ _id: { $in: cleaned } });
  if (found !== cleaned.length) throw new ApiError("VALIDATION_ERROR", "One of the chosen accessories does not exist. Refresh and try again.", { field: "accessoryIds" });
  return cleaned;
}
