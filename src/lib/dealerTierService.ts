import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, DealerCategoryEvent, Quotation } from "@/models";
import { ApiError } from "@/lib/api-response";
import {
  DEALER_TIER_KEYS,
  QUALIFYING_QUOTATION_STATUS,
  describeTierProgress,
  isDealerTierKey,
  tierForCount,
  tierRank,
  type DealerTierKey,
  type DealerTierProgress,
} from "@/lib/dealerTiers";

/**
 * Dealer tier logic, server side. The backend is the source of truth: a screen only displays what is returned here.
 *
 *  - The lifetime qualified count is never stored. It is counted from the dealer's delivered quotations (same company,
 *    same dealer, not deleted), so editing, cloning, retrying an event or running an evaluation twice cannot change it.
 *  - The category a dealer has EARNED is stored on the dealer and only ever goes up automatically: inactivity or a
 *    quotation that later stops qualifying never lowers it. A Super Admin can correct it, always with a recorded reason.
 *  - Every change is written to DealerCategoryEvent.
 *
 * All functions must run inside the company's tenant context (every API route already does); the company is also passed
 * explicitly and checked against the dealer and the quotation.
 */

type DealerTierDoc = { category: DealerTierKey; achievedAt: Date | null; lastEvaluatedAt: Date | null; countAtLastEvaluation: number } | null | undefined;

export interface DealerPerformance extends DealerTierProgress {
  /** When the current category was reached (a Bronze dealer that was never evaluated: when the dealer joined). */
  categoryAchievedAt: Date | null;
  lastCategoryEvaluationAt: Date | null;
}

export type TierEvaluation =
  | { evaluated: false; reason: "dealer_not_found" | "not_qualifying" }
  | { evaluated: true; changed: boolean; from: DealerTierKey; to: DealerTierKey; qualifiedCount: number };

const newEventId = () => `dce_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** The filter that defines a qualified quotation. The ONE definition (see lib/dealerTiers.ts). */
export function qualifiedQuotationFilter(companyId: number, dealerId: number): Record<string, unknown> {
  return { companyId, dealerId, status: QUALIFYING_QUOTATION_STATUS };
}

export async function countQualifiedQuotations(companyId: number, dealerId: number): Promise<number> {
  await connectMongoDB();
  return Quotation.countDocuments(qualifiedQuotationFilter(companyId, dealerId));
}

/** Qualified counts for every dealer of a company in one pass. */
export async function countQualifiedByDealer(companyId: number): Promise<Map<number, number>> {
  await connectMongoDB();
  const rows = await Quotation.aggregate<{ _id: number; count: number }>([
    { $match: { companyId, status: QUALIFYING_QUOTATION_STATUS, dealerId: { $ne: null }, isDeleted: { $ne: true } } },
    { $group: { _id: "$dealerId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id, row.count]));
}

function storedCategory(tier: DealerTierDoc): DealerTierKey {
  return tier && isDealerTierKey(tier.category) ? tier.category : "bronze";
}

/** What the dealer has and how far they are from the next category. */
export function dealerPerformance(dealer: { dealerTier?: DealerTierDoc; createdAt?: Date | null }, qualifiedCount: number): DealerPerformance {
  const category = storedCategory(dealer.dealerTier);
  return {
    ...describeTierProgress(category, qualifiedCount),
    categoryAchievedAt: dealer.dealerTier?.achievedAt ?? (category === "bronze" ? dealer.createdAt ?? null : null),
    lastCategoryEvaluationAt: dealer.dealerTier?.lastEvaluatedAt ?? null,
  };
}

/**
 * Brings a dealer's earned category up to what their qualified count earns. Safe to repeat and to run at the same time
 * from several requests: the upgrade is one conditional update that only succeeds for the request that finds the dealer
 * still on a lower category, and only that request records the history entry.
 */
async function applyEvaluation(params: {
  companyId: number;
  dealerId: number;
  dealerTier: DealerTierDoc;
  qualifiedCount: number;
  quotationId: string | null;
}): Promise<{ changed: boolean; from: DealerTierKey; to: DealerTierKey }> {
  const { companyId, dealerId, dealerTier, qualifiedCount, quotationId } = params;
  const stored = storedCategory(dealerTier);
  const earned = tierForCount(qualifiedCount);
  const evaluatedCount = dealerTier?.countAtLastEvaluation ?? 0;
  const now = new Date();

  // Upgrade only when the count really earns more AND has grown since the last evaluation (so a Super Admin's
  // deliberate correction is not undone by the next routine check).
  if (tierRank(earned) > tierRank(stored) && qualifiedCount > evaluatedCount) {
    const lower = DEALER_TIER_KEYS.filter((key) => tierRank(key) < tierRank(earned));
    const before = await AdminUser.findOneAndUpdate(
      {
        _id: dealerId,
        companyId,
        role: "dealer",
        $or: [{ dealerTier: { $exists: false } }, { dealerTier: null }, { "dealerTier.category": { $in: lower } }],
      },
      { $set: { dealerTier: { category: earned, achievedAt: now, lastEvaluatedAt: now, countAtLastEvaluation: qualifiedCount } } },
      { returnDocument: "before" }
    ).lean<{ dealerTier?: DealerTierDoc } | null>();
    if (before) {
      const from = storedCategory(before.dealerTier);
      await DealerCategoryEvent.create({
        _id: newEventId(),
        companyId,
        dealerId,
        fromCategory: from,
        toCategory: earned,
        source: "automatic",
        qualifiedCount,
        quotationId,
        createdAt: now,
      });
      return { changed: true, from, to: earned };
    }
    return { changed: false, from: stored, to: stored }; // another request upgraded this dealer first
  }

  // Nothing to upgrade: just record that the dealer was checked and with what count.
  await AdminUser.updateOne(
    { _id: dealerId, companyId, role: "dealer" },
    dealerTier
      ? { $set: { "dealerTier.lastEvaluatedAt": now, "dealerTier.countAtLastEvaluation": qualifiedCount } }
      : { $set: { dealerTier: { category: "bronze", achievedAt: null, lastEvaluatedAt: now, countAtLastEvaluation: qualifiedCount } } }
  );
  return { changed: false, from: stored, to: stored };
}

/**
 * Call when a quotation reaches the qualifying status. Checks the quotation really qualifies and belongs to this dealer
 * and company, counts, and upgrades the dealer if the threshold is reached. Repeating the call changes nothing.
 */
export async function evaluateDealerCategory(params: { companyId: number; dealerId: number; quotationId?: string | null }): Promise<TierEvaluation> {
  const { companyId, dealerId } = params;
  await connectMongoDB();
  const dealer = await AdminUser.findOne({ _id: dealerId, companyId, role: "dealer" }).select("dealerTier").lean<{ dealerTier?: DealerTierDoc } | null>();
  if (!dealer) return { evaluated: false, reason: "dealer_not_found" };

  if (params.quotationId) {
    const qualifies = await Quotation.exists({ _id: params.quotationId, ...qualifiedQuotationFilter(companyId, dealerId) });
    if (!qualifies) return { evaluated: false, reason: "not_qualifying" };
  }

  const qualifiedCount = await countQualifiedQuotations(companyId, dealerId);
  const result = await applyEvaluation({ companyId, dealerId, dealerTier: dealer.dealerTier, qualifiedCount, quotationId: params.quotationId ?? null });
  return { evaluated: true, changed: result.changed, from: result.from, to: result.to, qualifiedCount };
}

const lastReconcile = new Map<number, number>();

/**
 * Catches up dealers whose history already earns a higher category than they have (quotations delivered before tiers
 * existed). One pass over the company; idempotent; throttled so listing screens can call it freely.
 */
export async function reconcileCompanyDealerCategories(companyId: number, options: { force?: boolean; minIntervalMs?: number } = {}): Promise<number> {
  const interval = options.minIntervalMs ?? 30_000;
  const last = lastReconcile.get(companyId) ?? 0;
  if (!options.force && Date.now() - last < interval) return 0;
  lastReconcile.set(companyId, Date.now());

  await connectMongoDB();
  const [counts, dealers] = await Promise.all([
    countQualifiedByDealer(companyId),
    AdminUser.find({ companyId, role: "dealer" }).select("dealerTier").lean<Array<{ _id: number; dealerTier?: DealerTierDoc }>>(),
  ]);
  let upgraded = 0;
  for (const dealer of dealers) {
    const count = counts.get(dealer._id) ?? 0;
    const stored = storedCategory(dealer.dealerTier);
    if (tierRank(tierForCount(count)) > tierRank(stored) && count > (dealer.dealerTier?.countAtLastEvaluation ?? 0)) {
      const result = await applyEvaluation({ companyId, dealerId: dealer._id, dealerTier: dealer.dealerTier, qualifiedCount: count, quotationId: null });
      if (result.changed) upgraded += 1;
    }
  }
  return upgraded;
}

/** For tests: forget the throttle. */
export function resetDealerTierReconcileThrottle(): void {
  lastReconcile.clear();
}

/**
 * Super Admin correction. Sets the earned category to exactly `category` (up or down), requires a written reason, and
 * records who did it. The dealer's current count is remembered, so the next routine check does not simply undo a
 * deliberate downgrade; only quotations delivered after it can raise the category again.
 */
export async function setDealerCategoryManually(params: {
  companyId: number;
  dealerId: number;
  category: unknown;
  reason: unknown;
  actor: { userId: number; name: string | null };
}): Promise<{ from: DealerTierKey; to: DealerTierKey; qualifiedCount: number }> {
  const { companyId, dealerId, actor } = params;
  if (!isDealerTierKey(params.category)) {
    throw new ApiError("VALIDATION_ERROR", `Category must be one of: ${DEALER_TIER_KEYS.join(", ")}.`, { field: "category" });
  }
  const reason = typeof params.reason === "string" ? params.reason.trim() : "";
  if (reason.length < 5 || reason.length > 500) {
    throw new ApiError("VALIDATION_ERROR", "Give a reason of 5 to 500 characters; it is kept in the dealer's history.", { field: "reason" });
  }
  await connectMongoDB();
  const dealer = await AdminUser.findOne({ _id: dealerId, companyId, role: "dealer" }).select("dealerTier").lean<{ dealerTier?: DealerTierDoc } | null>();
  if (!dealer) throw new ApiError("NOT_FOUND", "Dealer not found.");
  const from = storedCategory(dealer.dealerTier);
  if (from === params.category) throw new ApiError("CONFLICT", `The dealer is already ${params.category}.`, { field: "category" });

  const qualifiedCount = await countQualifiedQuotations(companyId, dealerId);
  const now = new Date();
  await AdminUser.updateOne(
    { _id: dealerId, companyId, role: "dealer" },
    { $set: { dealerTier: { category: params.category, achievedAt: now, lastEvaluatedAt: now, countAtLastEvaluation: qualifiedCount } } }
  );
  await DealerCategoryEvent.create({
    _id: newEventId(),
    companyId,
    dealerId,
    fromCategory: from,
    toCategory: params.category,
    source: "manual",
    qualifiedCount,
    quotationId: null,
    reason,
    performedBy: actor.userId,
    performedByName: actor.name,
    createdAt: now,
  });
  return { from, to: params.category, qualifiedCount };
}

export async function listDealerCategoryEvents(companyId: number, dealerId: number, limit = 50) {
  await connectMongoDB();
  return DealerCategoryEvent.find({ companyId, dealerId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
}

/** The delivered quotations that count for a dealer, newest first. */
export async function listQualifyingQuotations(companyId: number, dealerId: number, limit = 100) {
  await connectMongoDB();
  return Quotation.find(qualifiedQuotationFilter(companyId, dealerId))
    .sort({ deliveredAt: -1, _id: -1 })
    .limit(limit)
    .select("quotationNumber clientName dealerId assignedSalesId createdBy deliveredAt approvedAt")
    .lean();
}

/** Company-wide numbers for the dashboard: dealers per category, and upgrades since a date. */
export async function dealerTierAnalytics(companyId: number, since: Date) {
  await connectMongoDB();
  const [groups, events] = await Promise.all([
    AdminUser.aggregate<{ _id: DealerTierKey; count: number }>([
      { $match: { role: "dealer", isActive: true } },
      { $group: { _id: { $ifNull: ["$dealerTier.category", "bronze"] }, count: { $sum: 1 } } },
    ]),
    DealerCategoryEvent.find({ companyId, createdAt: { $gte: since } }).select("fromCategory toCategory").lean(),
  ]);
  const dealersByCategory = Object.fromEntries(DEALER_TIER_KEYS.map((key) => [key, 0])) as Record<DealerTierKey, number>;
  for (const group of groups) if (isDealerTierKey(group._id)) dealersByCategory[group._id] = group.count;
  const upgrades = events.filter((event) => tierRank(event.toCategory) > tierRank(event.fromCategory ?? "bronze")).length;
  return { dealersByCategory, upgradesInPeriod: upgrades };
}
