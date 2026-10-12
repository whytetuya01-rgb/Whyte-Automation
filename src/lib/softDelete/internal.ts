/**
 * Soft-delete internals. Only `src/lib/softDelete/**` may import this module —
 * enforced by `no-restricted-imports` in eslint.config.mjs.
 *
 * The option keys below are deliberately not exported from the public entry
 * point: application code reaches deleted records only through the explicit
 * helpers in `./scope` (historical references) and `./privileged` (Trash).
 */

/** Query / aggregate option that carries the soft-delete scope of one operation. */
export const SCOPE_OPTION = "__whyteSoftDeleteScope";

/** Authorises an update to touch soft-delete fields. Set only by the soft-delete service. */
export const WRITE_OPTION = "__whyteSoftDeleteWrite";

/** Authorises a permanent delete on a model registered with `blockHardDelete`. */
export const HARD_DELETE_OPTION = "__whyteSoftDeleteHardDelete";

/**
 * - `active`  (default) only records that are not soft-deleted
 * - `include` every record, deleted or not
 * - `only`    only soft-deleted records (Trash)
 */
export type SoftDeleteScope = "active" | "include" | "only";

export const SOFT_DELETE_SCOPES: readonly SoftDeleteScope[] = ["active", "include", "only"];

/** Why a permanent delete was authorised; recorded in the error message if misused. */
export type HardDeleteAuthorisation = "purge" | "rollback";
