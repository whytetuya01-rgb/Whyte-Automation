import { QuotationRoom } from "@/models";
import { calculateQuotationGst } from "@/lib/pricing";
import { calculateDealerEarning } from "@/lib/dealerEarnings";

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
 */
export async function aggregateQuotationRoomTotals(
  quotationIds: string[]
): Promise<Map<string, QuotationRoomAggregateTotals>> {
  const result = new Map<string, QuotationRoomAggregateTotals>();
  if (quotationIds.length === 0) return result;

  const rows = await QuotationRoom.aggregate<AggregateRow>([
    { $match: { quotationId: { $in: quotationIds } } },
    {
      $lookup: {
        from: "quotationitems",
        localField: "_id",
        foreignField: "quotationRoomId",
        as: "items",
      },
    },
    {
      $addFields: {
        itemTotals: {
          $map: {
            input: "$items",
            as: "it",
            in: {
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
      $group: {
        _id: "$quotationId",
        roomsCount: { $sum: 1 },
        productsCount: { $sum: { $sum: "$itemTotals.qty" } },
        subtotal: {
          $sum: {
            $sum: {
              $map: { input: "$itemTotals", as: "t", in: { $multiply: ["$$t.qty", "$$t.price"] } },
            },
          },
        },
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
