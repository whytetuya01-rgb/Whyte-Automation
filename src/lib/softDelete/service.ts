import type { ClientSession, Model } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { withTransaction } from "@/lib/transaction";
import { ApiError, type ApiErrorCode } from "@/lib/api-response";
import {
  DeletionAuditEvent,
  type DeletionAuditAction,
  type IDeletionAuditCascade,
  type SoftDeleteEntityType,
} from "@/models/DeletionAuditEvent";
import type { DeletionActor } from "./actor";
import { DELETION_REASON_MAX_LENGTH, liveState } from "./fields";
import { HARD_DELETE_OPTION, SCOPE_OPTION, WRITE_OPTION } from "./internal";

/**
 * The centralized soft-delete / restore service. This is the ONLY code
 * allowed to write `isDeleted` / `deletedAt` / `deletedBy` / `deletionReason`
 * (the schema plugin in `./plugin` rejects that write from anywhere else).
 *
 * Concurrency model (validated empirically — see
 * `tests/soft-delete-concurrency.test.mjs` — against both a real single-node
 * replica set and the standalone loopback MongoDB this project runs on):
 *
 *   1. ANNOUNCE — flip `isDeleted` with a single `findOneAndUpdate` filtered
 *      on `{ _id, isDeleted: { $ne: true } }`. MongoDB guarantees this one
 *      document write is atomic even with no replica set, so two concurrent
 *      deletes of the SAME record can never both report success.
 *   2. VERIFY — if the caller supplied a cross-document invariant (e.g. "a
 *      product must keep at least one live variant"), re-read the live state
 *      with a fresh, uncached query.
 *   3. COMPENSATE — if the invariant is violated, flip the record back to
 *      live and record a `*_reverted` audit row instead of silently
 *      swallowing the problem.
 *
 * This protocol does NOT depend on multi-document transactions, so it is
 * exactly as safe on standalone MongoDB as on a replica set — unlike the
 * existing check-then-act-in-a-transaction pattern (`withTransaction`), whose
 * protection against this exact race degrades to nothing at all without a
 * replica set (see the dedicated test for the measured comparison). Cascade
 * writes (parent + owned children) still use `withTransaction` for the
 * multi-document write itself: that part does not need to defend against a
 * NEW reference appearing mid-operation the way the invariant check does, so
 * the existing "real transaction when available, sequential otherwise"
 * fallback is an acceptable, already-documented limitation for it.
 */

export interface CascadeSpec {
  entityType: SoftDeleteEntityType;
  model: Model<any>;
  /** Field on the child that points directly at the parent's `_id`. */
  foreignField?: string;
  /**
   * For a child that does NOT point directly at the parent (e.g. a
   * QuotationItem points at its QuotationRoom, not at the Quotation) — builds
   * the match filter from the parent id. Evaluated fresh, against currently
   * live state, each time cascade runs (list this entry BEFORE a sibling
   * cascade entry it depends on, e.g. items before rooms).
   */
  match?: (parentId: number | string) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

async function cascadeMatch(spec: CascadeSpec, parentId: number | string): Promise<Record<string, unknown>> {
  if (spec.match) return spec.match(parentId);
  if (spec.foreignField) return { [spec.foreignField]: parentId };
  throw new Error(`Cascade spec for ${spec.entityType} needs either "foreignField" or "match".`);
}

export interface InvariantViolation {
  code: ApiErrorCode;
  message: string;
}

/**
 * Re-checked AFTER the announce step, against fresh (uncached) state. Return
 * `null` when the delete may stand, or a violation to compensate and reject it.
 */
export type PostDeleteInvariant = (session: ClientSession | undefined) => Promise<InvariantViolation | null>;

export interface SoftDeleteOneParams<T> {
  model: Model<T>;
  entityType: SoftDeleteEntityType;
  id: number | string;
  actor: DeletionActor;
  reason?: string | null;
  /** Human label snapshot for the audit trail (product name, quotation number, …). */
  label?: string | null;
  /** Owned children soft-deleted together with the parent, under the same deletion group. */
  cascade?: CascadeSpec[];
  /** Checked after the announce step; a violation reverts the delete. */
  invariant?: PostDeleteInvariant;
}

export interface SoftDeleteResult<T> {
  record: T;
  deletionGroupId: string;
  cascade: Array<{ entityType: SoftDeleteEntityType; count: number }>;
}

export interface RestoreOneParams<T> {
  model: Model<T>;
  entityType: SoftDeleteEntityType;
  id: number | string;
  actor: DeletionActor;
  label?: string | null;
  /** Soft-deleted alongside this record in the same group; restored together. */
  cascade?: CascadeSpec[];
  /** Checked before the restore commits (e.g. the parent record must still exist and be live). */
  precondition?: () => Promise<InvariantViolation | null>;
}

export interface RestoreOneResult<T> {
  record: T;
  cascade: Array<{ entityType: SoftDeleteEntityType; count: number }>;
}

function newDeletionGroupId(): string {
  return "dg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function newAuditId(): string {
  return "da_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function normalizeReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, DELETION_REASON_MAX_LENGTH);
}

interface AuditEventInput {
  _id?: string;
  action: DeletionAuditAction;
  entityType: SoftDeleteEntityType;
  entityId: string;
  entityLabel: string | null;
  deletionGroupId: string;
  cascade: IDeletionAuditCascade[];
  reason: string | null;
  performedBy: number;
  performedByName: string | null;
  performedByRole: string | null;
  metadata: Record<string, unknown> | null;
}

async function writeAuditEvent(input: AuditEventInput, session?: ClientSession): Promise<void> {
  const doc = {
    _id: input._id ?? newAuditId(),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    deletionGroupId: input.deletionGroupId,
    cascade: input.cascade,
    reason: input.reason,
    performedBy: input.performedBy,
    performedByName: input.performedByName,
    performedByRole: input.performedByRole,
    performedOn: new Date(),
    metadata: input.metadata,
  };
  if (session) {
    await DeletionAuditEvent.create([doc], { session });
  } else {
    await DeletionAuditEvent.create(doc);
  }
}

/**
 * Soft-deletes one record, cascades to its owned children, verifies any
 * cross-document invariant against fresh state, and records the audit trail.
 *
 * Throws `ApiError("NOT_FOUND", …)` if the record does not exist or is
 * already deleted, or the invariant's error if the post-announce check fails
 * (in which case the record is left exactly as it was).
 */
export async function softDeleteOne<T extends { _id: number | string }>(
  params: SoftDeleteOneParams<T>
): Promise<SoftDeleteResult<T>> {
  const { model, entityType, id, actor, cascade = [] } = params;
  const reason = normalizeReason(params.reason);
  const deletionGroupId = newDeletionGroupId();

  await connectMongoDB();

  // 1. ANNOUNCE — atomic regardless of topology; the filter is what makes two
  //    concurrent deletes of the same record resolve to exactly one winner.
  const announced = await model
    .findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } } as Record<string, unknown>,
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actor.id, deletionReason: reason, deletionGroupId } },
      { returnDocument: "after", [WRITE_OPTION]: true } as any
    )
    .exec();

  if (!announced) {
    throw new ApiError("NOT_FOUND", `${entityType} not found, or already deleted.`, { field: "id" });
  }

  const revert = async () => {
    await model
      .updateOne({ _id: id } as Record<string, unknown>, { $set: liveState() }, { [WRITE_OPTION]: true, [SCOPE_OPTION]: "only" } as any)
      .exec();
  };

  // 2. VERIFY — against fresh, uncached state, never the document we just wrote.
  if (params.invariant) {
    const violation = await params.invariant(undefined);
    if (violation) {
      // 3. COMPENSATE
      await revert();
      await writeAuditEvent({
        action: "soft_delete_reverted",
        entityType,
        entityId: String(id),
        entityLabel: params.label ?? null,
        deletionGroupId,
        cascade: [],
        reason: violation.message,
        performedBy: actor.id,
        performedByName: null,
        performedByRole: actor.role,
        metadata: null,
      });
      throw new ApiError(violation.code, violation.message, { field: "id" });
    }
  }

  // Cascade to owned children. A real transaction when the topology supports
  // one; sequential best-effort otherwise (same documented limitation as the
  // rest of this codebase's `withTransaction` fallback — see AGENTS audit notes).
  const cascadeCounts: Array<{ entityType: SoftDeleteEntityType; count: number }> = [];
  if (cascade.length > 0) {
    await withTransaction(async (session) => {
      for (const child of cascade) {
        const match = await cascadeMatch(child, id);
        const result = await child.model
          .updateMany(
            { ...match, isDeleted: { $ne: true } } as Record<string, unknown>,
            { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actor.id, deletionReason: reason, deletionGroupId, deletedViaCascade: true } },
            { session: session ?? undefined, [WRITE_OPTION]: true } as any
          )
          .exec();
        cascadeCounts.push({ entityType: child.entityType, count: result.modifiedCount ?? 0 });
      }
    });
  }

  await writeAuditEvent({
    action: "soft_deleted",
    entityType,
    entityId: String(id),
    entityLabel: params.label ?? null,
    deletionGroupId,
    cascade: cascadeCounts,
    reason,
    performedBy: actor.id,
    performedByName: null,
    performedByRole: actor.role,
    metadata: null,
  });

  return { record: announced as unknown as T, deletionGroupId, cascade: cascadeCounts };
}

/**
 * Restores one soft-deleted record and the children that were cascaded with
 * it (matched by `deletionGroupId`, so a child independently soft-deleted
 * later, or restored earlier, is never swept back in by accident).
 */
export async function restoreOne<T extends { _id: number | string }>(
  params: RestoreOneParams<T>
): Promise<RestoreOneResult<T>> {
  const { model, entityType, id, actor, cascade = [] } = params;

  await connectMongoDB();

  const existing = await model
    .findOne({ _id: id } as Record<string, unknown>, null, { [SCOPE_OPTION]: "only" } as any)
    .select("+deletionGroupId")
    .exec();
  if (!existing) {
    throw new ApiError("NOT_FOUND", `${entityType} not found in the Trash.`, { field: "id" });
  }
  const groupId = (existing as unknown as { deletionGroupId?: string | null }).deletionGroupId ?? null;

  if (params.precondition) {
    const violation = await params.precondition();
    if (violation) throw new ApiError(violation.code, violation.message, { field: "id" });
  }

  const restored = await model
    .findOneAndUpdate(
      { _id: id } as Record<string, unknown>,
      { $set: liveState() },
      { returnDocument: "after", [WRITE_OPTION]: true, [SCOPE_OPTION]: "only" } as any
    )
    .exec();

  if (!restored) {
    throw new ApiError("NOT_FOUND", `${entityType} not found in the Trash.`, { field: "id" });
  }

  const cascadeCounts: Array<{ entityType: SoftDeleteEntityType; count: number }> = [];
  if (cascade.length > 0 && groupId) {
    // Every child cascaded together in one softDeleteOne() call carries the
    // SAME deletionGroupId, however deep the ownership chain (an item's
    // group id came from its quotation, not its room) — so restoring by
    // deletionGroupId alone correctly reaches every depth without needing
    // the delete-side foreignField/match relationship at all.
    await withTransaction(async (session) => {
      for (const child of cascade) {
        const result = await child.model
          .updateMany(
            { deletionGroupId: groupId } as Record<string, unknown>,
            { $set: liveState() },
            { session: session ?? undefined, [WRITE_OPTION]: true, [SCOPE_OPTION]: "only" } as any
          )
          .exec();
        cascadeCounts.push({ entityType: child.entityType, count: result.modifiedCount ?? 0 });
      }
    });
  }

  await writeAuditEvent({
    action: "restored",
    entityType,
    entityId: String(id),
    entityLabel: params.label ?? null,
    deletionGroupId: groupId ?? "unknown",
    cascade: cascadeCounts,
    reason: null,
    performedBy: actor.id,
    performedByName: null,
    performedByRole: actor.role,
    metadata: null,
  });

  return { record: restored as unknown as T, cascade: cascadeCounts };
}

/**
 * Permanently deletes a record already confirmed to be in the Trash. Only
 * callable against a model registered with `blockHardDelete`, and only this
 * function may pass `HARD_DELETE_OPTION` — every other hard-delete attempt on
 * such a model throws `SoftDeleteViolationError`.
 */
export async function purgeOne<T extends { _id: number | string }>(params: {
  model: Model<T>;
  entityType: SoftDeleteEntityType;
  id: number | string;
  actor: DeletionActor;
  label?: string | null;
}): Promise<void> {
  const { model, entityType, id, actor } = params;
  await connectMongoDB();

  const existing = await model
    .findOne({ _id: id } as Record<string, unknown>, null, { [SCOPE_OPTION]: "only" } as any)
    .select("+deletionGroupId")
    .exec();
  if (!existing) {
    throw new ApiError("NOT_FOUND", `${entityType} not found in the Trash.`, { field: "id" });
  }

  await model
    .deleteOne({ _id: id } as Record<string, unknown>, { [HARD_DELETE_OPTION]: "purge", [SCOPE_OPTION]: "only" } as any)
    .exec();

  await writeAuditEvent({
    action: "purged",
    entityType,
    entityId: String(id),
    entityLabel: params.label ?? null,
    deletionGroupId: (existing as unknown as { deletionGroupId?: string | null }).deletionGroupId ?? "unknown",
    cascade: [],
    reason: null,
    performedBy: actor.id,
    performedByName: null,
    performedByRole: actor.role,
    metadata: null,
  });
}
