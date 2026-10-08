import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, HouseType } from "@/models";
import { dealerVisibilityFilter } from "@/lib/quotationAccess";
import { getConfirmedEarningsForDealer } from "@/lib/dealerEarningsService";
import { aggregateQuotationRoomTotals, totalsForQuotation } from "@/lib/quotationTotals";
import QuotationsListing, {
  QuotationRowData,
  QuotationSummaryMetrics,
  QuotationPaginationMeta,
} from "@/components/quotations/QuotationsListing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Generous on purpose: at today's data volume every visible quotation set
 * fits on one page, so pagination stays invisible (see `QuotationsListing`,
 * which only renders a pager once `totalPages > 1`). Once a dealer's or the
 * admin's quotation count passes this, page 2+ becomes reachable with no
 * further code change.
 */
const DEFAULT_PAGE_SIZE = 50;

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "object" && v && typeof (v as { toString: () => string }).toString === "function") {
    return Number((v as { toString: () => string }).toString());
  }
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * The exact discount formula `(app)/page.tsx` has always used for its
 * "Value" column (pre-GST, subtotal minus discount — see Phase 1 audit:
 * this intentionally differs from the GST-inclusive Grand Total shown on
 * the proposal/PDF, and is left unchanged here). Shared by the per-row
 * mapping and the full-set summary total so the two can never disagree.
 */
function rowTotalAmount(subtotal: number, discountType: unknown, discountValue: unknown): number {
  let discount = 0;
  if (discountType === "percentage") {
    discount = (subtotal * toNum(discountValue)) / 100;
  } else if (discountType === "fixed") {
    discount = toNum(discountValue);
  }
  return Math.max(0, subtotal - discount);
}

export default async function HomePage(props: PageProps) {
  let quotations: QuotationRowData[] = [];
  let houseTypes: Array<{ id: number; name: string; description: string | null; isActive: boolean; sortOrder: number }> = [];
  let dealerEarnings = 0;
  let userRole: string | undefined;
  let summary: QuotationSummaryMetrics | undefined;
  let pagination: QuotationPaginationMeta | undefined;

  try {
    const session = await getServerSession(authOptions);
    userRole = (session?.user as { role?: string })?.role;
    const userId = Number((session?.user as { id?: string } | undefined)?.id);

    const searchParams = await props.searchParams;
    const requestedPage = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
    const pageSize = DEFAULT_PAGE_SIZE;

    await connectMongoDB();

    // Determine query filter based on verified role (unchanged).
    let filterQuery: Record<string, unknown> = {};

    if (userRole === "dealer") {
      filterQuery = dealerVisibilityFilter(userId);

      // Confirmed earnings: Approved + Delivered quotations assigned to this dealer,
      // calculated server-side from each quotation's allocation snapshot.
      dealerEarnings = await getConfirmedEarningsForDealer(userId);
    }

    // Lightweight pass over EVERY matching quotation (not just the current
    // page): just the few scalar fields the summary cards and the discount
    // formula need, never the rooms/items. This replaces what used to be a
    // single `populate(rooms -> items)` across the whole result set.
    const [allMatchingLight, htDocs] = await Promise.all([
      Quotation.find(filterQuery)
        .select("_id status discountType discountValue")
        .sort({ createdAt: -1 })
        .lean({ virtuals: true }),
      HouseType.find({ isActive: true }).sort({ sortOrder: 1 }).lean({ virtuals: true }),
    ]);

    const allIds = allMatchingLight.map((d) => String((d as { _id: unknown })._id));
    // One aggregation covers both the full-set summary below AND the current
    // page's per-row totals further down — MongoDB does the rooms/items
    // fan-out and the sum once, instead of Node loading and reducing it.
    const aggregatedTotals = await aggregateQuotationRoomTotals(allIds);

    const total = allMatchingLight.length;
    let drafts = 0;
    let completed = 0;
    let pendingSent = 0;
    let totalValue = 0;
    for (const doc of allMatchingLight as Array<{ _id: unknown; status?: string; discountType?: unknown; discountValue?: unknown }>) {
      const status = doc.status || "draft";
      if (status === "draft") drafts += 1;
      if (status === "approved" || status === "sent" || status === "delivered") completed += 1;
      if (status === "sent") pendingSent += 1;

      const { subtotal } = totalsForQuotation(aggregatedTotals, String(doc._id));
      totalValue += rowTotalAmount(subtotal, doc.discountType, doc.discountValue);
    }
    summary = { total, drafts, completed, pendingSent, totalValue };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(requestedPage, totalPages);
    pagination = { page: safePage, pageSize, total, totalPages };

    // Full quotation documents for ONLY the current page. `rooms` is a
    // virtual (not a stored field), so simply not populating it here is what
    // removes the expensive deep populate — its data comes from
    // `aggregatedTotals` instead, computed above in one database round trip.
    const quoteDocs = await Quotation.find(filterQuery)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * pageSize)
      .limit(pageSize)
      .populate({ path: "houseType", select: "id name" })
      .populate({ path: "dealer", select: "id name email firstName lastName" })
      .lean({ virtuals: true });

    quotations = (quoteDocs as unknown as Array<Record<string, unknown>>).map((q) => {
      const quotationId = String(q._id);
      const { roomsCount, productsCount, subtotal } = totalsForQuotation(aggregatedTotals, quotationId);
      const totalAmount = rowTotalAmount(subtotal, q.discountType, q.discountValue);
      const houseType = q.houseType as { id?: number; _id?: number; name?: string } | null | undefined;
      const dealer = q.dealer as { name?: string; firstName?: string; lastName?: string } | null | undefined;

      return {
        id: (q.id as string) || quotationId,
        quotationNumber: q.quotationNumber as string,
        clientName: q.clientName as string,
        clientPhone: (q.clientPhone as string | null) ?? null,
        clientEmail: (q.clientEmail as string | null) ?? null,
        clientAddress: (q.clientAddress as string | null) ?? null,
        houseTypeId: (q.houseTypeId as number | null) ?? null,
        houseType: houseType ? { id: Number(houseType.id ?? houseType._id ?? 0), name: String(houseType.name ?? "") } : null,
        status: (q.status as QuotationRowData["status"]) || "draft",
        notes: (q.notes as string | null) ?? null,
        discountType: (q.discountType as string | null) ?? null,
        discountValue: toNum(q.discountValue) || null,
        createdAt: q.createdAt ? new Date(q.createdAt as string).toISOString() : new Date().toISOString(),
        updatedAt: q.updatedAt ? new Date(q.updatedAt as string).toISOString() : undefined,
        roomsCount,
        productsCount,
        totalAmount,
        dealerId: (q.dealerId as number | null) ?? null,
        dealerName: dealer?.name || (dealer ? `${dealer.firstName || ""} ${dealer.lastName || ""}`.trim() : null),
        allocatedDiscountPercent: toNum(q.allocatedDiscountPercent),
        customerDiscountPercent: toNum(q.customerDiscountPercent),
        estimatedEarningPercent: toNum(q.estimatedEarningPercent),
        estimatedEarningAmount: toNum(q.estimatedEarningAmount),
        clonedFromQuotationId: (q.clonedFromQuotationId as string | null) ?? null,
        sentAt: q.sentAt ? new Date(q.sentAt as string).toISOString() : null,
        approvedAt: q.approvedAt ? new Date(q.approvedAt as string).toISOString() : null,
        deliveredAt: q.deliveredAt ? new Date(q.deliveredAt as string).toISOString() : null,
      };
    });

    houseTypes = htDocs.map((ht) => {
      const item = (typeof (ht as { toJSON?: () => unknown }).toJSON === "function"
        ? (ht as { toJSON: () => Record<string, unknown> }).toJSON()
        : ht) as Record<string, unknown>;
      return {
        id: Number(item.id ?? item._id ?? 0),
        name: String(item.name ?? ""),
        description: (item.description as string | null) ?? null,
        isActive: Boolean(item.isActive),
        sortOrder: Number(item.sortOrder ?? 0),
      };
    });
  } catch (error) {
    console.error("Database connection failed in HomePage:", error);
  }

  return (
    <div className="max-w-7xl mx-auto py-2">
      <QuotationsListing
        initialQuotations={quotations}
        houseTypes={houseTypes}
        userRole={userRole}
        dealerEarnings={dealerEarnings}
        summary={summary}
        pagination={pagination}
      />
    </div>
  );
}
