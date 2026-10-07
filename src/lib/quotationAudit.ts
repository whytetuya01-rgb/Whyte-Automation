import type { ClientSession } from "mongoose";
import { AdminUser, QuotationAuditEvent } from "@/models";
import type { QuotationAuditAction } from "@/models";

export interface QuotationAuditInput {
  quotationId: string;
  action: QuotationAuditAction;
  /** Authenticated user id, taken from the server session. */
  performedBy: number;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  /** Reuse an already-resolved display name to save a lookup. */
  performedByName?: string | null;
}

export function displayNameOf(
  user: { name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined
): string | null {
  if (!user) return null;
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return user.name?.trim() || full || user.email || null;
}

function newEventId(): string {
  return "qa_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Appends one audit event. `performedOn` is always generated here, never taken
 * from a request.
 */
export async function recordQuotationEvents(
  inputs: QuotationAuditInput[],
  dbSession?: ClientSession
): Promise<void> {
  if (inputs.length === 0) return;

  const nameCache = new Map<number, string | null>();
  for (const input of inputs) {
    if (input.performedByName !== undefined) nameCache.set(input.performedBy, input.performedByName);
  }
  const missing = [...new Set(inputs.map((i) => i.performedBy))].filter((id) => !nameCache.has(id));
  if (missing.length > 0) {
    const users = await AdminUser.find({ _id: { $in: missing } })
      .select("name firstName lastName email")
      .lean();
    for (const u of users) nameCache.set(u._id, displayNameOf(u));
  }

  const now = new Date();
  const docs = inputs.map((input, index) => ({
    // A small offset keeps events recorded together in a stable order.
    _id: newEventId() + index,
    quotationId: input.quotationId,
    action: input.action,
    performedBy: input.performedBy,
    performedByName: nameCache.get(input.performedBy) ?? null,
    performedOn: new Date(now.getTime() + index),
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    metadata: input.metadata ?? null,
  }));

  if (dbSession) {
    await QuotationAuditEvent.insertMany(docs, { session: dbSession });
  } else {
    await QuotationAuditEvent.insertMany(docs);
  }
}

export function recordQuotationEvent(input: QuotationAuditInput, dbSession?: ClientSession): Promise<void> {
  return recordQuotationEvents([input], dbSession);
}

/** Summary of a dealer for audit previous/new values: id plus a readable name. */
export function dealerSnapshot(
  dealer: { _id: number; name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined
): Record<string, unknown> | null {
  if (!dealer) return null;
  return { dealerId: dealer._id, dealerName: displayNameOf(dealer) };
}
