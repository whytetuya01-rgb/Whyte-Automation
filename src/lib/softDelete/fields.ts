/**
 * The soft-delete contract shared by every soft-deletable model.
 *
 * A record is soft-deleted only when `isDeleted === true`. Records written
 * before soft delete existed have no `isDeleted` field at all and are active,
 * which is why every filter uses `{ $ne: true }` and never `{ isDeleted: false }`.
 *
 * `isDeleted` is independent of the existing `isActive` flag: `isActive` is the
 * reversible Active/Inactive business toggle, `isDeleted` means "moved to the
 * Trash". Deleting never changes `isActive`, so a restore returns the record in
 * exactly the state it was deleted in.
 */
export const SOFT_DELETE_FIELDS = [
  "isDeleted",
  "deletedAt",
  "deletedBy",
  "deletionReason",
  "deletionGroupId",
  "deletedViaCascade",
] as const;

export type SoftDeleteField = (typeof SOFT_DELETE_FIELDS)[number];

const SOFT_DELETE_FIELD_SET: ReadonlySet<string> = new Set(SOFT_DELETE_FIELDS);

export function isSoftDeleteField(path: string): boolean {
  return SOFT_DELETE_FIELD_SET.has(path.split(".")[0]);
}

/**
 * Soft-delete fields as they appear on a model's raw document type. Optional
 * because records created before soft delete existed do not carry them.
 *
 * `deletedBy`, `deletionReason`, `deletionGroupId` and `deletedViaCascade` are
 * `select: false`: they are only returned when a query explicitly selects them.
 */
export interface SoftDeleteFields {
  isDeleted?: boolean;
  deletedAt?: Date | null;
  /** AdminUser `_id` taken from the server session — never from request input. */
  deletedBy?: number | null;
  deletionReason?: string | null;
  /** Shared by every record soft-deleted in one operation (a parent and its cascaded children). */
  deletionGroupId?: string | null;
  /** True when the record was deleted as part of its parent's deletion. */
  deletedViaCascade?: boolean;
}

/*
 * Filters and states are factories, not shared constants: Mongoose casts
 * filters and updates in place, so a shared (or frozen) object would be
 * mutated by one query and leak into the next — or throw.
 */

/** The only filter that correctly treats legacy records (no `isDeleted` field) as active. */
export function activeRecordFilter(): { isDeleted: { $ne: true } } {
  return { isDeleted: { $ne: true } };
}

export function isSoftDeleted(doc: { isDeleted?: boolean | null } | null | undefined): boolean {
  return doc?.isDeleted === true;
}

export const DELETION_REASON_MAX_LENGTH = 500;

/** Field values of a live record. A restore writes exactly these. */
export function liveState() {
  return {
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    deletionGroupId: null,
    deletedViaCascade: false,
  };
}

/** Thrown when code tries to bypass the soft-delete rules. Always a programming error (HTTP 500). */
export class SoftDeleteViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoftDeleteViolationError";
  }
}
