import type { Schema } from "mongoose";
import { SoftDeleteViolationError } from "./fields";
import { SCOPE_OPTION } from "./internal";
import { isSoftDeleteSchema } from "./plugin";

/**
 * Trash access. Importable only from `src/lib/softDelete/**` and the Trash /
 * restore API routes (eslint `no-restricted-imports`); those routes enforce
 * role-based authorization before calling it.
 */

interface ScopableQuery {
  setOptions(options: Record<string, unknown>): unknown;
  model: { schema: Schema; modelName: string };
}

/** Restricts one query to soft-deleted records. */
export function onlySoftDeleted<Q extends ScopableQuery>(query: Q): Q {
  if (!isSoftDeleteSchema(query.model.schema)) {
    throw new SoftDeleteViolationError(`${query.model.modelName} is not soft-deletable.`);
  }
  query.setOptions({ [SCOPE_OPTION]: "only" });
  return query;
}
