import mongoose, { Schema, Document, Model } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models/Quotation";
import { getTenantContext, TenantScopeViolationError } from "@/lib/tenant/context";

export interface ICounter {
  _id: string;
  seq: number;
}

export interface ICounterDocument extends Document<string> {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounterDocument>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { _id: false, versionKey: false }
);

export const Counter: Model<ICounterDocument> =
  mongoose.models.Counter || mongoose.model<ICounterDocument>("Counter", CounterSchema);

/**
 * ID allocation, in two deliberately different scopes.
 *
 * 1. Row ids (`product`, `productVariant`, `quotationRoom`, ...): one counter per
 *    COLLECTION, shared by every company. A row's `_id` is the collection's
 *    primary key — unique across all companies by construction — so a
 *    per-company `_id` sequence would hand two companies the same id and
 *    collide on insert. Every foreign key (`productId`, `quotationRoomId`, ...)
 *    is a plain number into that same global space, which is why existing ids
 *    and relationships need no change.
 *
 * 2. Quotation numbers (`QT-<year>-<seq>`): one counter per COMPANY per year
 *    (`quotationNumber_<companyId>_<year>`), because each company numbers its
 *    own proposals from 1 and `(companyId, quotationNumber)` is unique.
 *
 * Both are allocated by ONE atomic update (see `allocate`): "create the
 * counter if missing, lift it to at least the highest value already in use,
 * then add". No separate read-modify-write step exists to race, so concurrent
 * callers always receive distinct values and a missing or stale counter can
 * never hand out an id that is already taken.
 *
 * The "highest value already in use" is read straight from the native
 * collection, never through Mongoose: the tenant-scope and soft-delete plugins
 * would otherwise narrow that read to ONE company and hide deleted rows, and a
 * floor computed from a subset of the ids is exactly how a collision happens.
 * The read returns a single number, never a document.
 */

/** Highest numeric `_id` in a collection across ALL companies, soft-deleted rows included. */
export async function maxNumericId(model: Model<any>, session?: mongoose.ClientSession): Promise<number> {
  const highest = await model.collection.findOne(
    {},
    { sort: { _id: -1 }, projection: { _id: 1 }, session: session ?? undefined }
  );
  const id = (highest as { _id?: unknown } | null)?._id;
  return typeof id === "number" && Number.isFinite(id) ? id : 0;
}

/**
 * Atomically sets `seq = max(seq (0 if the counter is new), floor) + count`
 * and returns the new value. A single `findOneAndUpdate` with an update
 * pipeline: safe to run concurrently, safe on a missing counter, and it can
 * only ever move a counter forward.
 */
async function allocate(
  sequenceName: string,
  count: number,
  floor: number,
  session?: mongoose.ClientSession
): Promise<number> {
  const updated = await Counter.collection.findOneAndUpdate(
    { _id: sequenceName as unknown as never },
    [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ["$seq", 0] }, floor] }, count] } } }],
    { upsert: true, returnDocument: "after", session: session ?? undefined }
  );
  const seq = (updated as { seq?: unknown } | null)?.seq;
  if (typeof seq !== "number") {
    throw new Error(`Failed to allocate sequence ${sequenceName}`);
  }
  return seq;
}

/**
 * Reserves `count` consecutive row ids in one atomic step and returns them
 * ascending. `modelForMaxCheck` supplies the "already in use" floor.
 */
export async function reserveSequenceBlock(
  sequenceName: string,
  count: number,
  modelForMaxCheck?: Model<any>,
  session?: mongoose.ClientSession
): Promise<number[]> {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Invalid sequence block size for ${sequenceName}: ${count}`);
  }
  if (count === 0) return [];

  await connectMongoDB();
  const floor = modelForMaxCheck ? await maxNumericId(modelForMaxCheck, session) : 0;
  const last = await allocate(sequenceName, count, floor, session);
  const first = last - count + 1;
  return Array.from({ length: count }, (_, i) => first + i);
}

/**
 * Atomically allocates the next row id for `sequenceName` (e.g. "product").
 * Safe against a missing counter and against a counter that has fallen behind
 * the data (imports, restores): the result is always above every existing id.
 */
export async function getNextSequence(
  sequenceName: string,
  modelForMaxCheck?: Model<any>,
  session?: mongoose.ClientSession
): Promise<number> {
  const [id] = await reserveSequenceBlock(sequenceName, 1, modelForMaxCheck, session);
  return id;
}

/** Counter name for one company's quotation numbers in one year. */
export function quotationCounterName(companyId: number, year: number): string {
  return `quotationNumber_${companyId}_${year}`;
}

/**
 * Highest `QT-<year>-<n>` already issued to `companyId` — soft-deleted
 * quotations included, since their numbers must never be reused.
 */
export async function maxQuotationSequence(
  companyId: number,
  year: number,
  session?: mongoose.ClientSession
): Promise<number> {
  const prefix = `QT-${year}-`;
  const rows = await Quotation.collection
    .aggregate<{ max: number }>(
      [
        { $match: { companyId, quotationNumber: { $regex: `^QT-${year}-[0-9]+$` } } },
        {
          $group: {
            _id: null,
            max: {
              $max: {
                $convert: { input: { $substrCP: ["$quotationNumber", prefix.length, 20] }, to: "int", onError: 0, onNull: 0 },
              },
            },
          },
        },
      ],
      { session: session ?? undefined }
    )
    .toArray();
  return rows[0]?.max ?? 0;
}

/**
 * Next quotation sequence number for the CALLING company (taken from the
 * request's tenant context — never from client input) in `year`.
 */
export async function getNextQuotationSequence(year: number, session?: mongoose.ClientSession): Promise<number> {
  const companyId = getTenantContext()?.companyId ?? null;
  if (companyId === null) {
    throw new TenantScopeViolationError(
      "Quotation numbers are issued per company, but this request has no company context."
    );
  }

  await connectMongoDB();
  const floor = await maxQuotationSequence(companyId, year, session);
  return allocate(quotationCounterName(companyId, year), 1, floor, session);
}
