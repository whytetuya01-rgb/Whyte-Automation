import { QuotationRoom } from "@/models";
import { calculateQuotationGst } from "@/lib/pricing";
import { calculateDealerEarning } from "@/lib/dealerEarnings";
import {
  isItemUnavailable,
  isProtectedQuotationStatus,
  type UnavailabilityCheckItem,
  type UnavailabilityCheckRoom,
} from "@/lib/quotationAvailability";

// Re-exported so existing server-side callers of this module keep working
// unchanged; the predicates themselves now live in `quotationAvailability.ts`
// (see that file's doc comment) so client components can import them too
// without pulling the Mongoose model import below into a browser bundle.
export {
  isProtectedQuotationStatus,
  isProductUnavailable,
  isVariantUnavailable,
  isRoomTypeUnavailable,
  isRoomUnavailable,
  isItemUnavailable,
  unavailabilityReason,
  type UnavailabilityCheckItem,
  type UnavailabilityCheckRoom,
} from "@/lib/quotationAvailability";

/**
 * Shared, read-only aggregation for the one expensive step every quotation
 * list/summary screen repeats: walking `rooms[].items[]` to get a
 * quotation's subtotal, room count and product count.
 *
 * This module does ONLY that step, as a single MongoDB aggregation instead
 * of `populate()`-ing every room and item into Node and reducing them in JS.
 * It intentionally does NOT touch discount, GST or dealer-earning math —
 * those stay exactly where they are (`calculateQuotationGst` in
 * `@/lib/pricing`, `calculateDealerEarning` in `@/lib/dealerEarnings`,
 * and the per-screen formulas in `normalizeQuotation` / `(app)/page.tsx` /
 * `api/quotations/route.ts`), called by each caller on the subtotal this
 * returns, exactly as they already call it on their own JS-reduced subtotal
 * today.
 *
 * Matches the existing JS reducers' semantics exactly (see
 * `normalizeQuotation`, `subtotalFromRooms` in `@/lib/dealerEarnings`,
 * and the inline reducer in `(app)/page.tsx`):
 *
 *   effectiveQuantity = (quantity is a number > 0) ? quantity : 1
 *   subtotal          = Σ effectiveQuantity * unitPrice
 *   productsCount     = Σ effectiveQuantity
 *   roomsCount        = number of rooms (even a room with zero items counts)
 *
 * No rounding is applied here, to match the JS reducers (none of which round
 * the raw accumulated subtotal either — each caller rounds downstream
 * exactly where it already does today, e.g. inside `calculateQuotationGst`).
 */

export interface QuotationRoomAggregateTotals {
  roomsCount: number;
  productsCount: number;
  subtotal: number;
}

const EMPTY_TOTALS: QuotationRoomAggregateTotals = { roomsCount: 0, productsCount: 0, subtotal: 0 };

interface AggregateRow {
  _id: string;
  roomsCount: number;
  productsCount: number;
  subtotal: number;
}

/**
 * Looks up {roomsCount, productsCount, subtotal} for each of `quotationIds`
 * in one round trip. A quotation with no rooms simply has no entry in the
 * returned map; use {@link totalsForQuotation} to read it with the correct
 * all-zero default.
 *
 * `protectedQuotationIds` names the ids (out of `quotationIds`) whose status
 * is Approved or Delivered — see {@link isProtectedQuotationStatus}. Their
 * totals include every item/room exactly as stored (the historical-amount
 * rule); every other quotation's totals exclude a room/item whose RoomType,
 * Product or ProductVariant has since been soft-deleted — mirrored exactly
 * from the Node-side `isItemUnavailable`/`isRoomUnavailable` predicates
 * above, just expressed as an aggregation pipeline instead of a JS reduce.
 * `roomsCount` is never affected: the room still exists, it just stops
 * contributing to the financial figures.
 */
export async function aggregateQuotationRoomTotals(
  quotationIds: string[],
  protectedQuotationIds: Iterable<string> = []
): Promise<Map<string, QuotationRoomAggregateTotals>> {
  const result = new Map<string, QuotationRoomAggregateTotals>();
  if (quotationIds.length === 0) return result;
  const protectedIds = [...new Set(protectedQuotationIds)];

  const rows = await QuotationRoom.aggregate<AggregateRow>([
    { $match: { quotationId: { $in: quotationIds } } },
    {
      // include scope: a soft-deleted RoomType must still be fetched here —
      // its isDeleted flag is exactly what decides eligibility below.
      $lookup: {
        from: "roomtypes",
        let: { rtId: "$roomTypeId", compId: "$companyId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$rtId"] },
                  { $eq: ["$companyId", "$$compId"] },
                ],
              },
            },
          },
          { $project: { isDeleted: 1, companyId: 1 } },
        ],
        as: "roomTypeDoc",
      },
    },
    {
      $addFields: {
        roomUnavailable: {
          $and: [
            { $ne: ["$roomTypeId", null] },
            { $eq: [{ $ifNull: [{ $arrayElemAt: ["$roomTypeDoc.isDeleted", 0] }, false] }, true] },
          ],
        },
      },
    },
    {
      // A pipeline-form $lookup (rather than localField/foreignField) so it
      // explicitly excludes soft-deleted items itself — required by the
      // soft-delete and tenant-scope plugins, since they cannot scope a $lookup into another
      // collection for you. The nested lookups below additionally fetch
      // (in include scope) each item's own Product/ProductVariant isDeleted
      // flag, which is what makes this pipeline eligibility-aware.
      $lookup: {
        from: "quotationitems",
        let: { roomId: "$_id", compId: "$companyId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$quotationRoomId", "$$roomId"] },
                  { $eq: ["$companyId", "$$compId"] },
                ],
              },
              isDeleted: { $ne: true },
            },
          },
          {
            $lookup: {
              from: "products",
              let: { pid: "$productId", itemCompId: "$companyId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$_id", "$$pid"] },
                        { $eq: ["$companyId", "$$itemCompId"] },
                      ],
                    },
                  },
                },
                { $project: { isDeleted: 1, companyId: 1 } },
              ],
              as: "productDoc",
            },
          },
          {
            $lookup: {
              from: "productvariants",
              let: { vid: "$productVariantId", itemCompId: "$companyId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$_id", "$$vid"] },
                        { $eq: ["$companyId", "$$itemCompId"] },
                      ],
                    },
                  },
                },
                { $project: { isDeleted: 1, companyId: 1 } },
              ],
              as: "variantDoc",
            },
          },
          {
            $addFields: {
              itemUnavailable: {
                $or: [
                  { $eq: [{ $ifNull: [{ $arrayElemAt: ["$productDoc.isDeleted", 0] }, false] }, true] },
                  {
                    $and: [
                      { $ne: ["$productVariantId", null] },
                      { $eq: [{ $ifNull: [{ $arrayElemAt: ["$variantDoc.isDeleted", 0] }, false] }, true] },
                    ],
                  },
                ],
              },
            },
          },
        ],
        as: "items",
      },
    },
    { $addFields: { isProtected: { $in: ["$quotationId", protectedIds] } } },
    {
      $addFields: {
        itemTotals: {
          $map: {
            input: "$items",
            as: "it",
            in: {
              eligible: { $or: ["$isProtected", { $not: [{ $or: ["$roomUnavailable", "$$it.itemUnavailable"] }] }] },
              qty: {
                $cond: [
                  { $and: [{ $isNumber: "$$it.quantity" }, { $gt: ["$$it.quantity", 0] }] },
                  "$$it.quantity",
                  1,
                ],
              },
              price: { $ifNull: [{ $toDouble: "$$it.unitPrice" }, 0] },
            },
          },
        },
      },
    },
    {
      $addFields: {
        eligibleTotals: {
          $map: {
            input: "$itemTotals",
            as: "t",
            in: {
              qty: { $cond: ["$$t.eligible", "$$t.qty", 0] },
              amount: { $cond: ["$$t.eligible", { $multiply: ["$$t.qty", "$$t.price"] }, 0] },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: "$quotationId",
        roomsCount: { $sum: 1 },
        productsCount: { $sum: { $sum: "$eligibleTotals.qty" } },
        subtotal: { $sum: { $sum: "$eligibleTotals.amount" } },
      },
    },
  ]);

  for (const row of rows) {
    result.set(row._id, {
      roomsCount: row.roomsCount,
      productsCount: row.productsCount,
      subtotal: row.subtotal ?? 0,
    });
  }
  return result;
}

/** Reads one quotation's totals out of the map, defaulting to all-zero when it has no rooms. */
export function totalsForQuotation(
  map: Map<string, QuotationRoomAggregateTotals>,
  quotationId: string
): QuotationRoomAggregateTotals {
  return map.get(quotationId) ?? EMPTY_TOTALS;
}

interface RoomWithAvailability extends UnavailabilityCheckRoom {
  items?: Array<UnavailabilityCheckItem & { quantity?: unknown; unitPrice?: unknown }> | null;
}

/**
 * Node-side twin of the aggregation above, for the one caller that already
 * has rooms/items populated in memory (`PATCH /api/quotations/[id]`, which
 * only ever runs on a non-protected quotation — the lock above rejects it
 * otherwise, so `status` there is always the non-protected branch; it is
 * still threaded through explicitly rather than assumed, so this stays
 * correct if that ever changes).
 */
export function eligibleSubtotalFromRooms(
  rooms: RoomWithAvailability[] | null | undefined,
  status: string | null | undefined
): number {
  if (!Array.isArray(rooms)) return 0;
  const protected_ = isProtectedQuotationStatus(status);
  return rooms.reduce((sum, room) => {
    if (!Array.isArray(room.items)) return sum;
    return (
      sum +
      room.items.reduce((itemSum, item) => {
        if (!protected_ && isItemUnavailable(item, room)) return itemSum;
        const qty = (() => {
          const n = Number(item.quantity);
          return Number.isFinite(n) && n > 0 ? n : 1;
        })();
        const price = (() => {
          const n = Number(item.unitPrice);
          return Number.isFinite(n) ? n : 0;
        })();
        return itemSum + qty * price;
      }, 0)
    );
  }, 0);
}

export interface QuotationFinancials {
  subtotal: number;
  discountAmount: number;
  netSubtotal: number;
  cgstPercent: number;
  cgstAmount: number;
  sgstPercent: number;
  sgstAmount: number;
  totalGstAmount: number;
  grandTotal: number;
  /** Alias of `grandTotal`, matching `normalizeQuotation`'s output contract. */
  totalAmount: number;
  allocatedDiscountPercent: number;
  customerDiscountPercent: number;
  estimatedEarningPercent: number;
  estimatedEarningAmount: number;
}

function toPlainNumberLoose(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object" && "$numberDecimal" in (value as Record<string, unknown>)) {
    return toPlainNumberLoose((value as { $numberDecimal: unknown }).$numberDecimal);
  }
  if (typeof value === "object" && typeof (value as { toString?: unknown }).toString === "function") {
    const n = Number((value as { toString: () => string }).toString());
    return Number.isNaN(n) ? 0 : n;
  }
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Turns an already-known `subtotal` (from {@link aggregateQuotationRoomTotals},
 * or any other source) into the full set of discount/GST/earning fields.
 *
 * This is the EXACT discount-resolution and GST logic already used by
 * `normalizeQuotation` (`@/lib/quotationNormalization`), extracted so it can
 * be called without first loading every room and item into Node — the GST
 * math itself is still `calculateQuotationGst` (`@/lib/pricing`), and the
 * earning math is still `calculateDealerEarning` (`@/lib/dealerEarnings`);
 * both are called unchanged, as the business-rule authority they already
 * are. `normalizeQuotation` itself is untouched and keeps computing its own
 * subtotal from `rooms[].items[]` exactly as before — this is an additional
 * caller of the same formulas, not a replacement for it.
 */
export function deriveQuotationFinancials(params: {
  subtotal: number;
  discountType?: string | null;
  discountValue?: unknown;
  customerDiscountPercent?: unknown;
  allocatedDiscountPercent?: unknown;
}): QuotationFinancials {
  const { subtotal } = params;
  const discountType = params.discountType ?? "none";
  const rawDiscountVal = toPlainNumberLoose(params.discountValue);

  const customerPct = Number(
    params.customerDiscountPercent !== undefined && params.customerDiscountPercent !== null
      ? params.customerDiscountPercent
      : discountType === "percentage"
      ? rawDiscountVal
      : 0
  );

  let discountAmount = 0;
  if (discountType === "percentage") {
    discountAmount = Math.round(((subtotal * customerPct) / 100) * 100) / 100;
  } else if (discountType === "fixed") {
    discountAmount = Math.min(subtotal, Math.round(rawDiscountVal * 100) / 100);
  }

  const gst = calculateQuotationGst(subtotal, discountAmount);

  const allocatedPct = Number(params.allocatedDiscountPercent || 0);
  const { earningPercent, earningAmount } = calculateDealerEarning({
    subtotal,
    allocatedPercent: allocatedPct,
    customerPercent: customerPct,
  });

  return {
    subtotal: gst.grossSubtotal,
    discountAmount: gst.discountAmount,
    netSubtotal: gst.netSubtotal,
    cgstPercent: gst.cgstPercent,
    cgstAmount: gst.cgstAmount,
    sgstPercent: gst.sgstPercent,
    sgstAmount: gst.sgstAmount,
    totalGstAmount: gst.totalGstAmount,
    grandTotal: gst.grandTotal,
    totalAmount: gst.grandTotal,
    allocatedDiscountPercent: allocatedPct,
    customerDiscountPercent: customerPct,
    estimatedEarningPercent: earningPercent,
    estimatedEarningAmount: earningAmount,
  };
}
