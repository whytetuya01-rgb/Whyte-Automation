/**
 * Explicit, auditable list of dangling references the tenant backfill planner
 * is allowed to PRESERVE instead of treating as blocking errors.
 *
 * Each entry names one exact record, the field that dangles and the missing
 * parent value it points at. Nothing is matched by pattern, so a new orphan —
 * or the same record pointing at a different missing parent — is still an
 * error and keeps the migration from being reported safe. The listed records
 * are never modified or deleted by the planner: they are kept as-is and are
 * assigned to the default company like any other legacy record.
 *
 * Source: read-only audit of the production database (documented exceptions
 * approved with the revised tenant migration plan). Add an entry only with an
 * explicit owner decision and a reason.
 */

export interface KnownOrphanException {
  /** Child collection (MongoDB name) holding the dangling reference. */
  collection: string;
  /** The child record's `_id`. */
  id: string | number;
  /** The dangling field on the child. */
  field: string;
  /** The parent id the field points at, which does not exist. */
  missingValue: string | number;
  /** Why this is understood and acceptable to keep. */
  reason: string;
}

export const KNOWN_ORPHAN_EXCEPTIONS: readonly KnownOrphanException[] = [
  {
    collection: "products",
    id: 331,
    field: "categoryId",
    missingValue: 9,
    reason: "Product 331 points at Category 9, which no longer exists in the categories collection (legacy data; category 9 was never recreated). Product kept as-is.",
  },
  ...([
    [1, 329],
    [2, 329],
    [3, 330],
    [4, 330],
    [5, 330],
    [6, 330],
  ] as const).map(
    ([id, productId]): KnownOrphanException => ({
      collection: "productvarianthistories",
      id,
      field: "productId",
      missingValue: productId,
      reason: `Variant-history record ${id} belongs to Product ${productId}, which no longer exists. Historical audit data is preserved, not deleted.`,
    })
  ),
  {
    collection: "quotationauditevents",
    id: "qa_muxohfaj_epbspc960",
    field: "quotationId",
    missingValue: "q_muxohf8v_bm58z4x",
    reason: "Audit event survives its quotation, which no longer exists. Audit history is preserved, not deleted.",
  },
  {
    collection: "quotationauditevents",
    id: "qa_mv0egai7_5p11hki60",
    field: "quotationId",
    missingValue: "q_mv0egac0_kf969om",
    reason: "Audit event survives its quotation, which no longer exists. Audit history is preserved, not deleted.",
  },
];
