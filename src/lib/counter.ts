import mongoose, { Schema, Document, Model } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";

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
 * Atomically increments and returns the next sequential integer for a given sequence name.
 *
 * Safety guarantee: before incrementing, the stored sequence is advanced to at least the
 * current maximum _id in the collection via $max.  This prevents duplicate-key errors
 * when the counter is stale (e.g. catalog/import data was inserted after the counter was
 * last used, leaving the counter behind the real maximum _id).
 *
 * @param sequenceName    - unique key for this counter (e.g. "product", "productVariant")
 * @param modelForMaxCheck - Mongoose model used to find the current max _id
 * @param session         - optional ClientSession for transactions
 */
export async function getNextSequence(
  sequenceName: string,
  modelForMaxCheck?: Model<any>,
  session?: mongoose.ClientSession
): Promise<number> {
  await connectMongoDB();

  // 1. Determine the current maximum _id so we never re-issue an existing ID.
  let currentMax = 0;
  if (modelForMaxCheck) {
    const highestDoc = await modelForMaxCheck
      .findOne({}, { _id: 1 })
      .sort({ _id: -1 })
      .session(session || null)
      .lean();
    if (highestDoc && typeof (highestDoc as any)._id === "number") {
      currentMax = (highestDoc as any)._id as number;
    }
  }

  // 2. Ensure the counter document exists (initialise seq = currentMax when brand-new).
  await Counter.findByIdAndUpdate(
    sequenceName,
    { $setOnInsert: { seq: currentMax } },
    { upsert: true, session: session || null }
  );

  // 3. Advance the counter to currentMax if it is behind (handles stale counters).
  //    $max is a no-op when the stored value is already higher.
  if (currentMax > 0) {
    await Counter.findByIdAndUpdate(
      sequenceName,
      { $max: { seq: currentMax } },
      { session: session || null }
    );
  }

  // 4. Atomically increment and return the next value.
  const counter = await Counter.findByIdAndUpdate(
    sequenceName,
    { $inc: { seq: 1 } },
    {
      returnDocument: "after",
      upsert: true,
      setDefaultsOnInsert: true,
      session: session || null,
    }
  );

  if (!counter) {
    throw new Error(`Failed to generate sequence for ${sequenceName}`);
  }

  return counter.seq;
}
