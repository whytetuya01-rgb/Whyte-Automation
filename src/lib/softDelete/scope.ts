import type { Schema } from "mongoose";
import { SoftDeleteViolationError } from "./fields";
import { SCOPE_OPTION } from "./internal";
import { isSoftDeleteSchema } from "./plugin";

/**
 * Why a query may see soft-deleted records. Listings, selectors, dashboards
 * and any new reference must never use these — they rely on the default scope.
 *
 * - `historical-reference` following a reference OUT of an existing record
 *   (a quotation's product, variant, room type, house type), so history keeps
 *   rendering after the referenced record is deleted.
 * - `id-allocation` computing the highest `_id` so a counter never re-issues
 *   the id of a record that sits in the Trash.
 */
export type IncludeDeletedPurpose = "historical-reference" | "id-allocation";

const INCLUDE_DELETED_PURPOSES: ReadonlySet<string> = new Set<IncludeDeletedPurpose>([
  "historical-reference",
  "id-allocation",
]);

interface ScopableQuery {
  setOptions(options: Record<string, unknown>): unknown;
  model: { schema: Schema };
}

/** Lets one query see soft-deleted records as well as live ones. */
export function includeSoftDeleted<Q extends ScopableQuery>(query: Q, purpose: IncludeDeletedPurpose): Q {
  // The purpose documents (and makes greppable) why a call site sees deleted
  // records; reject anything else so untyped callers cannot widen the escape hatch.
  if (!INCLUDE_DELETED_PURPOSES.has(purpose)) {
    throw new SoftDeleteViolationError(`Unknown reason to include soft-deleted records: "${String(purpose)}".`);
  }
  // Models without the plugin would forward the option to the driver; skip them.
  if (isSoftDeleteSchema(query.model.schema)) {
    query.setOptions({ [SCOPE_OPTION]: "include" });
  }
  return query;
}

/**
 * Populate options for a virtual that follows a reference out of a historical
 * record. Declared on the schema virtual itself, so every populate of that
 * path keeps resolving after the target is soft-deleted.
 */
export function historicalReferenceOptions(): Record<string, unknown> {
  return { [SCOPE_OPTION]: "include" };
}
