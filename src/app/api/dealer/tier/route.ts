import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { DEALER_TIERS, QUALIFYING_QUOTATION_STATUS, tierRank } from "@/lib/dealerTiers";
import { countQualifiedQuotations, dealerPerformance, evaluateDealerCategory } from "@/lib/dealerTierService";

export const dynamic = "force-dynamic";

/**
 * GET /api/dealer/tier
 *
 * The signed-in Dealer's own level (Bronze to Diamond): the level they have, how many delivered quotations count, how
 * many more reach the next level, and the whole ladder. Only the dealer's own record is read (the session's user id and
 * company); nothing about other dealers. Everything is worked out on the server by the same rules the admin screens use.
 *
 * Before answering, the dealer is brought up to the level their delivered quotations already earn (safe to repeat; it
 * never lowers a level), so quotations delivered before levels existed show correctly.
 */
export async function GET() {
  try {
    return await withSession(async ({ role, userId, companyId }) => {
      if (role !== "dealer") throw new ApiError("FORBIDDEN", "Only Dealers have a dealer level.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      await evaluateDealerCategory({ companyId, dealerId: userId });
      const dealer = await AdminUser.findOne({ _id: userId, companyId, role: "dealer" }).select("dealerTier createdAt").lean();
      if (!dealer) throw new ApiError("NOT_FOUND", "Dealer not found.");

      const qualified = await countQualifiedQuotations(companyId, userId);
      const performance = dealerPerformance(dealer as Parameters<typeof dealerPerformance>[0], qualified);
      const rank = tierRank(performance.category);

      return apiSuccess({
        ...performance,
        qualifyingStatus: QUALIFYING_QUOTATION_STATUS,
        ladder: DEALER_TIERS.map((tier, index) => ({
          key: tier.key,
          label: tier.label,
          minQualified: tier.minQualified,
          state: index < rank ? "reached" : index === rank ? "current" : "upcoming",
        })),
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/dealer/tier" });
  }
}
