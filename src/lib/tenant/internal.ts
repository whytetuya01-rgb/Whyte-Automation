/**
 * Tenant-scope internals. Only `src/lib/tenant/**` may import this module —
 * enforced by `no-restricted-imports` in eslint.config.mjs, mirroring the
 * same restriction already in place for `src/lib/softDelete/internal.ts`.
 *
 * `WRITE_OPTION` is the one escape hatch: it lets an authorized caller (the
 * migration backfill script, and only it) write/overwrite `companyId` once.
 * Everywhere else, `companyId` is immutable after a document is created.
 */

/** Query option that authorises a write to the otherwise-immutable `companyId` field. */
export const TENANT_WRITE_OPTION = "__whyteTenantWrite";
