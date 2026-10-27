import mongoose from "mongoose";
import { Product, ProductVariant, QuotationItem, QuotationRoom, RoomType } from "@/models";
import { historicalReferenceOptions } from "@/lib/softDelete/scope";
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
 * LEGACY IMPLEMENTATION, kept for one release as the parity-test reference and as the rollback target.
 *
 * Do not call this from application code. It is the original single aggregation with correlated pipeline
 * `$lookup`s; it returns the same result as {@link aggregateQuotationRoomTotals} but costs roughly 2 ms of
 * database CPU per room (measured locally: about 800-1,000 ms vs about 60-110 ms for 52 quotations on the same data). Rollback is a one-line
 * change: have `aggregateQuotationRoomTotals` delegate to this function (see tests/quotation-room-totals-golden.test.ts,
 * which asserts both return identical results). Remove it once the new implementation has been in production for a release.
 *
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
export async function aggregateQuotationRoomTotalsLegacy(
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

/**
 * In-process fallback summation (MongoDB-style double-double accumulation). The values that are returned come from
 * {@link sumOnServer}, which uses MongoDB's own `$sum`; this class only supplies the result in the unlikely case the
 * server returns nothing for a quotation, and is close to, but not bit-for-bit identical with, the server's
 * `$group` summation (it differs from it in about 9% of quotations with very large line amounts).
 */
class DoubleDoubleSum {
  private hi = 0;
  private lo = 0;
  private nonFinite = 0;
  private sawNonFinite = false;

  add(x: number): void {
    if (!Number.isFinite(x)) {
      this.nonFinite += x;
      this.sawNonFinite = true;
      return;
    }
    const sum = this.hi + x;
    const virtual = sum - this.hi;
    const error = this.hi - (sum - virtual) + (x - virtual);
    const tail = this.lo + error;
    const head = sum + tail;
    this.lo = tail - (head - sum);
    this.hi = head;
  }

  value(): number {
    if (this.sawNonFinite) return this.nonFinite + (Number.isFinite(this.hi) ? 0 : this.hi);
    return this.hi + this.lo;
  }
}

/** Quotations processed per batch: bounds how many rooms and items are held in memory at once. */
export const ROOM_TOTALS_CHUNK_SIZE = 500;
/**
 * Mongo returns only 101 documents in a cursor's first batch; asking for more up front keeps each query to one
 * network round trip for result sets that fit in a single 16 MB batch (a larger set simply needs more getMore calls).
 */
const ROOM_TOTALS_BATCH_SIZE = 10_000;
/** Upper bound on line items sent to one server-side summation command, far below MongoDB's 16 MB command limit. */
export const ROOM_TOTALS_SUM_BATCH_ITEMS = 100_000;

interface TotalsRoom {
  _id: number;
  quotationId: string;
  roomTypeId?: number | null;
  companyId?: number | null;
}
interface TotalsItem {
  quotationRoomId: number;
  productId?: number | null;
  productVariantId?: number | null;
  quantity?: unknown;
  unitPrice?: unknown;
  companyId?: number | null;
}
interface DeletionFlag {
  _id: number;
  isDeleted?: boolean;
  companyId?: number | null;
}

const flagsById = (docs: DeletionFlag[]): Map<number, DeletionFlag> => new Map(docs.map((doc) => [doc._id, doc]));
const definedIds = (values: Array<number | null | undefined>): number[] => [
  ...new Set(values.filter((value): value is number => typeof value === "number")),
];

/** Same rule as the legacy pipeline: a number above 0 counts as itself, anything else as 1. */
const effectiveQuantity = (quantity: unknown): number => (typeof quantity === "number" && quantity > 0 ? quantity : 1);

/**
 * Same conversion as the legacy `$toDouble`: missing/null is 0 and Decimal128 / numbers / numeric strings convert
 * to the nearest double. A non-numeric string made the legacy aggregation throw for the whole request; here it
 * counts as 0 instead so one corrupt row cannot take a dashboard down (the schema stores Decimal128, so this is
 * not expected to occur).
 */
function priceAsDouble(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value));
  return Number.isNaN(parsed) && typeof value === "string" ? 0 : parsed;
}

async function aggregateTotalsChunk(
  quotationIds: string[],
  protectedIds: ReadonlySet<string>,
  into: Map<string, QuotationRoomAggregateTotals>,
  sumBatchItems: number
): Promise<void> {
  // Wave 1: the rooms. The tenant-scope and soft-delete plugins add their companyId / isDeleted conditions to
  // every query below exactly as they did for the aggregation's leading $match.
  const rooms = await QuotationRoom.find({ quotationId: { $in: quotationIds } })
    .select("quotationId roomTypeId companyId")
    .sort({ quotationId: 1, sortOrder: 1, _id: 1 })
    .batchSize(ROOM_TOTALS_BATCH_SIZE)
    .lean<TotalsRoom[]>();
  if (rooms.length === 0) return;

  // Wave 2: items and room-type flags both depend only on the rooms. Soft-deleted room types, products and
  // variants must stay visible because their isDeleted flag is what decides eligibility (the legacy pipeline's
  // "include scope" lookups); only their flag is read.
  const [items, roomTypes] = await Promise.all([
    QuotationItem.find({ quotationRoomId: { $in: rooms.map((room) => room._id) } })
      .select("quotationRoomId productId productVariantId quantity unitPrice companyId")
      .sort({ quotationRoomId: 1, sortOrder: 1, _id: 1 })
      .batchSize(ROOM_TOTALS_BATCH_SIZE)
      .lean<TotalsItem[]>(),
    RoomType.find({ _id: { $in: definedIds(rooms.map((room) => room.roomTypeId)) } })
      .select("isDeleted companyId")
      .batchSize(ROOM_TOTALS_BATCH_SIZE)
      .setOptions(historicalReferenceOptions())
      .lean<DeletionFlag[]>(),
  ]);

  // Wave 3: product and variant flags depend on the items.
  const [products, variants] = await Promise.all([
    Product.find({ _id: { $in: definedIds(items.map((item) => item.productId)) } })
      .select("isDeleted companyId")
      .batchSize(ROOM_TOTALS_BATCH_SIZE)
      .setOptions(historicalReferenceOptions())
      .lean<DeletionFlag[]>(),
    ProductVariant.find({ _id: { $in: definedIds(items.map((item) => item.productVariantId)) } })
      .select("isDeleted companyId")
      .batchSize(ROOM_TOTALS_BATCH_SIZE)
      .setOptions(historicalReferenceOptions())
      .lean<DeletionFlag[]>(),
  ]);
  const roomTypeFlags = flagsById(roomTypes);
  const productFlags = flagsById(products);
  const variantFlags = flagsById(variants);

  const itemsByRoom = new Map<number, TotalsItem[]>();
  for (const item of items) {
    const bucket = itemsByRoom.get(item.quotationRoomId);
    if (bucket) bucket.push(item);
    else itemsByRoom.set(item.quotationRoomId, [item]);
  }

  const running = new Map<string, { roomsCount: number; productsCount: DoubleDoubleSum; subtotal: DoubleDoubleSum }>();
  // One row per room for the server-side summation below: the quantities and the line amounts that count.
  const sumRows: Array<{ q: string; n: number[]; a: Array<number | mongoose.mongo.Double> }> = [];
  for (const room of rooms) {
    let entry = running.get(room.quotationId);
    if (!entry) {
      entry = { roomsCount: 0, productsCount: new DoubleDoubleSum(), subtotal: new DoubleDoubleSum() };
      running.set(room.quotationId, entry);
    }
    entry.roomsCount += 1;

    // Approved/Delivered keep every item and room; everything else drops what the catalog has since deleted.
    const isProtected = protectedIds.has(room.quotationId);
    // A flag only counts when it belongs to the same company as the record pointing at it (the legacy lookups
    // matched on companyId as well).
    const roomType = room.roomTypeId != null ? roomTypeFlags.get(room.roomTypeId) : undefined;
    const roomUnavailable = Boolean(roomType && roomType.companyId === room.companyId && roomType.isDeleted === true);

    const roomQuantity = new DoubleDoubleSum();
    const roomAmount = new DoubleDoubleSum();
    const row: { q: string; n: number[]; a: Array<number | mongoose.mongo.Double> } = { q: room.quotationId, n: [], a: [] };
    sumRows.push(row);
    for (const item of itemsByRoom.get(room._id) ?? []) {
      if (item.companyId !== room.companyId) continue;
      const product = item.productId != null ? productFlags.get(item.productId) : undefined;
      const variant = item.productVariantId != null ? variantFlags.get(item.productVariantId) : undefined;
      const itemUnavailable = Boolean(
        (product && product.companyId === item.companyId && product.isDeleted === true) ||
          (variant && variant.companyId === item.companyId && variant.isDeleted === true)
      );
      const eligible = isProtected || !(roomUnavailable || itemUnavailable);
      const quantity = effectiveQuantity(item.quantity);
      const amount = quantity * priceAsDouble(item.unitPrice);
      roomQuantity.add(eligible ? quantity : 0);
      roomAmount.add(eligible ? amount : 0);
      // Same BSON types the legacy pipeline summed: a double for a counted line, the integer 0 for an excluded one.
      row.n.push(eligible ? quantity : 0);
      row.a.push(eligible ? new mongoose.mongo.Double(amount) : 0);
    }
    entry.productsCount.add(roomQuantity.value());
    entry.subtotal.add(roomAmount.value());
  }

  // The in-process double-double sums above are a fallback. The sums that are returned are produced by MongoDB's
  // own $sum over the same values, so they match the legacy aggregation exactly (its per-quotation $group $sum is
  // not reproducible bit-for-bit outside the server, and a one-bit difference can move a percentage discount or a
  // dealer earning by one paisa when it lands on a half-paisa boundary).
  const serverSums = await sumOnServer(sumRows, sumBatchItems);
  for (const [quotationId, entry] of running) {
    into.set(
      quotationId,
      serverSums.get(quotationId) ?? {
        roomsCount: entry.roomsCount,
        productsCount: entry.productsCount.value(),
        subtotal: entry.subtotal.value(),
      }
    );
  }
}

/**
 * Sums the per-room quantities and amounts with the same operators the legacy pipeline used (`$sum` of each room's
 * array, then `$sum` per quotation in `$group`), over literal values. It reads no catalog data: it runs through the
 * QuotationRoom model, so the tenant-scope and soft-delete plugins still apply, and `$limit: 1` only gives the
 * pipeline a document to start from. Returns an empty map if the scoped room vanished in between, in which case the
 * caller keeps its own sums.
 */
async function sumOnServer(
  rows: Array<{ q: string; n: number[]; a: Array<number | mongoose.mongo.Double> }>,
  maxItemsPerCommand: number
): Promise<Map<string, QuotationRoomAggregateTotals>> {
  const sums = new Map<string, QuotationRoomAggregateTotals>();
  if (rows.length === 0) return sums;
  // Rooms arrive grouped by quotation. Commands are cut only on a quotation boundary, so one quotation's rooms are
  // always summed together, in order, by a single $group.
  const batches: Array<typeof rows> = [];
  let batch: typeof rows = [];
  let batchItems = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const startsNewQuotation = i === 0 || rows[i].q !== rows[i - 1].q;
    if (startsNewQuotation && batch.length > 0 && batchItems >= maxItemsPerCommand) {
      batches.push(batch);
      batch = [];
      batchItems = 0;
    }
    batch.push(rows[i]);
    batchItems += rows[i].n.length;
  }
  if (batch.length > 0) batches.push(batch);

  for (const part of batches) {
    const grouped = await QuotationRoom.aggregate<{ _id: string; roomsCount: number; productsCount: number; subtotal: number }>([
      { $limit: 1 },
      { $project: { _id: 0, rows: { $literal: part } } },
      { $unwind: "$rows" },
      { $project: { q: "$rows.q", n: { $sum: "$rows.n" }, a: { $sum: "$rows.a" } } },
      { $group: { _id: "$q", roomsCount: { $sum: 1 }, productsCount: { $sum: "$n" }, subtotal: { $sum: "$a" } } },
    ]);
    for (const row of grouped) {
      sums.set(row._id, { roomsCount: row.roomsCount, productsCount: row.productsCount, subtotal: row.subtotal ?? 0 });
    }
  }
  return sums;
}

/**
 * Returns {roomsCount, productsCount, subtotal} for each of `quotationIds`. A quotation with no rooms has no entry
 * in the returned map; use {@link totalsForQuotation} to read it with the correct all-zero default.
 *
 * Replaces the single aggregation with correlated `$lookup`s (kept as
 * {@link aggregateQuotationRoomTotalsLegacy}) with scoped, indexed reads joined in memory: rooms, then items and
 * room-type flags, then product and variant flags, then one summation over literal values (four sequential
 * database waves per batch of {@link ROOM_TOTALS_CHUNK_SIZE} quotations). Eligibility, quantity, price and summation rules are the legacy ones,
 * described on that function. It runs inside the caller's tenant context and uses the caller's scope mode
 * unchanged: scoped callers see only their company, and the platform-admin dashboards that call it inside
 * `runUnscoped` keep seeing every company.
 *
 * `protectedQuotationIds` names the ids (out of `quotationIds`) whose status is Approved or Delivered; see
 * {@link isProtectedQuotationStatus}.
 */
export async function aggregateQuotationRoomTotals(
  quotationIds: string[],
  protectedQuotationIds: Iterable<string> = [],
  options: { chunkSize?: number; sumBatchItems?: number } = {}
): Promise<Map<string, QuotationRoomAggregateTotals>> {
  const result = new Map<string, QuotationRoomAggregateTotals>();
  const ids = [...new Set(quotationIds)];
  if (ids.length === 0) return result;
  const protectedIds: ReadonlySet<string> = new Set(protectedQuotationIds);
  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? ROOM_TOTALS_CHUNK_SIZE));
  const sumBatchItems = Math.max(1, Math.floor(options.sumBatchItems ?? ROOM_TOTALS_SUM_BATCH_ITEMS));

  for (let start = 0; start < ids.length; start += chunkSize) {
    await aggregateTotalsChunk(ids.slice(start, start + chunkSize), protectedIds, result, sumBatchItems);
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
