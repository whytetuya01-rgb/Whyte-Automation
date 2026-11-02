import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { countQualifiedQuotations, dealerPerformance, setDealerCategoryManually } from "@/lib/dealerTierService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/dealers/[id]/category { category, reason } — Super Admin correction of a dealer's earned category.
 *
 * `admins:manage` is a Super Admin-only permission, so no other role can reach this. The Super Admin must be acting as
 * the dealer's company, the reason is required, and the change (who, when, from, to, why) is written to the dealer's
 * category history. Automatic upgrades never lower a category; this is the only way to change one downwards.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withPermission("admins:manage", async (actor) => {
      const companyId = requireActiveCompany(actor);
      const dealerId = parseNumericId((await context.params).id);
      const body = (await readJsonBody(req)) as { category?: unknown; reason?: unknown } | null;

      await connectMongoDB();
      const change = await setDealerCategoryManually({
        companyId,
        dealerId,
        category: body?.category,
        reason: body?.reason,
        actor: { userId: actor.userId, name: actor.session.user?.name ?? actor.session.user?.email ?? null },
      });

      const dealer = await AdminUser.findOne({ _id: dealerId, companyId, role: "dealer" }).select("dealerTier createdAt").lean();
      const count = await countQualifiedQuotations(companyId, dealerId);
      return apiSuccess({ ...change, performance: dealer ? dealerPerformance(dealer as never, count) : null });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/dealers/[id]/category" });
  }
}
