import { ApiError } from "@/lib/api-response";

/** The part of a Mongoose model this file needs (kept structural so any model fits). */
interface IndexedModel {
  modelName: string;
  init(): Promise<unknown>;
  collection: { indexes(): Promise<Array<{ name?: string }>> };
}

/**
 * Who may create MongoDB collections and indexes, and when.
 *
 * Mongoose creates every model's collection and indexes by itself when the app connects. In development and in tests that
 * is convenient. In production it means a normal page request can start building indexes (a unique index on a big
 * collection can lock writes, or fail on duplicates) at a moment nobody chose. So in production it is OFF: collections and
 * indexes are created only by the controlled procedure (`scripts/indexes.ts`, see docs/index-deployment.md), which only
 * ever ADDS missing indexes and never drops or rebuilds one.
 *
 *   MONGOOSE_AUTO_INDEX=1   force it on  (the isolated test servers do this: they run production builds on a throwaway database)
 *   MONGOOSE_AUTO_INDEX=0   force it off (the scripts that must not change a database's structure do this)
 *   unset                   on everywhere except NODE_ENV=production
 */
export function autoIndexEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.MONGOOSE_AUTO_INDEX?.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return env.NODE_ENV !== "production";
}

export function describeIndexPolicy(env: NodeJS.ProcessEnv = process.env): string {
  return autoIndexEnabled(env)
    ? "automatic (collections and indexes are created on connect)"
    : "controlled (collections and indexes are created only by scripts/indexes.ts)";
}

const verified = new Set<string>();
const failedAt = new Map<string, number>();
const RECHECK_AFTER_MS = 10_000;

/** MongoDB's "collection does not exist" error. */
const isMissingCollection = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === 26;

/**
 * Makes sure the indexes a feature's correctness depends on exist, WITHOUT creating anything in production.
 *
 *  - Where Mongoose builds indexes itself (development, tests), this waits for that to finish.
 *  - In production it only LOOKS: if a required index is missing it stops with a clear 503 and changes nothing. The fix is
 *    to run the controlled index deployment, never to let a request build the index.
 *
 * A good result is remembered for the life of the process; a failure is re-checked after a few seconds (so deploying the
 * index fixes the running app without a restart).
 */
export async function assertIndexesDeployed(model: IndexedModel, requiredNames: readonly string[]): Promise<void> {
  const key = `${model.modelName}:${requiredNames.join(",")}`;
  if (autoIndexEnabled()) {
    if (!verified.has(key)) {
      await model.init();
      verified.add(key);
    }
    return;
  }
  if (verified.has(key)) return;

  const last = failedAt.get(key);
  if (last !== undefined && Date.now() - last < RECHECK_AFTER_MS) throw missingIndexError(model.modelName, requiredNames);

  let existing: string[] = [];
  try {
    existing = (await model.collection.indexes()).map((index) => String(index.name));
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
  }
  const missing = requiredNames.filter((name) => !existing.includes(name));
  if (missing.length > 0) {
    failedAt.set(key, Date.now());
    throw missingIndexError(model.modelName, missing);
  }
  failedAt.delete(key);
  verified.add(key);
}

function missingIndexError(modelName: string, missing: readonly string[]): ApiError {
  return new ApiError(
    "SERVICE_UNAVAILABLE",
    "This feature needs a database index that has not been deployed yet, so nothing was changed. An administrator must run the index deployment (see docs/index-deployment.md).",
    { details: { model: modelName, missingIndexes: [...missing] } }
  );
}

/** For tests: forget what was verified. */
export function resetIndexChecksForTests(): void {
  verified.clear();
  failedAt.clear();
}
