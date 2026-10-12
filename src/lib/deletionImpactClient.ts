import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { ConfirmOptions } from "@/components/providers/ConfirmProvider";

export interface DeletionBlocker {
  type: string;
  label: string;
  count: number;
  blocking?: boolean;
}

/** Mirrors `DeletionImpactResult` in `@/lib/deletionImpact` (server). */
export interface DeletionImpactResult {
  canDelete: boolean;
  blockers: DeletionBlocker[];
  totalReferences: number;
  archiveOnly: boolean;
}

function joinBlockers(blockers: DeletionBlocker[]): string {
  return blockers.map((b) => `${b.count} ${b.label}`).join(" and ");
}

/**
 * The single "review deletion impact, then delete" flow every delete entry
 * point in the app shares (Products, Product Variants, Categories, Room
 * Types, House Types) — one place for the UI policy, so no page re-derives
 * its own wording or skips the server-verified counts.
 *
 * Every delete here is a SOFT delete: the record is archived (hidden from
 * new selections), never destroyed. Existing references — a quotation item,
 * a house-type template, a subcategory — keep resolving it exactly as
 * before; it just stops being offered for anything NEW.
 *
 * 1. Fetches the real, server-computed impact (never a client-guessed count).
 * 2. If blocked: shows an informational dialog naming the real reason (today
 *    this only happens for a product variant that is the last one left).
 * 3. If clear: shows the destructive confirm with the real reference count,
 *    phrased as an archive action rather than a permanent erasure, then runs
 *    the delete.
 */
export async function confirmDeletionWithImpact(params: {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  impactUrl: string;
  /** e.g. `"Living Room"` — the record's display name. */
  recordLabel: string;
  /** e.g. `"room type"` — lowercase, singular, used mid-sentence. */
  entityName: string;
  /** e.g. `"Delete Room Type"` — the destructive button's label. */
  confirmText: string;
  onConfirmedDelete: () => Promise<void>;
}): Promise<void> {
  const { confirm, impactUrl, recordLabel, entityName, confirmText, onConfirmedDelete } = params;

  let impact: DeletionImpactResult;
  try {
    impact = await apiJson.get<DeletionImpactResult>(impactUrl);
  } catch (err) {
    notifyApiError(err, "Unable to check deletion impact", "Please try again.");
    return;
  }

  if (!impact.canDelete) {
    const blocking = impact.blockers.filter((b) => b.blocking);
    await confirm({
      title: "Cannot delete",
      message: `"${recordLabel}" cannot be deleted: it is still referenced by ${joinBlockers(blocking)}.`,
      detail: "Resolve that first, then try again.",
      confirmText: "OK",
      cancelText: "Close",
      variant: "primary",
    });
    return;
  }

  const informational = impact.blockers.filter((b) => !b.blocking);
  await confirm({
    title: `Delete ${entityName.charAt(0).toUpperCase()}${entityName.slice(1)}`,
    message: `Are you sure you want to delete "${recordLabel}"?`,
    detail:
      informational.length > 0
        ? `It is still referenced by ${joinBlockers(informational)} — those keep working unchanged. This ${entityName} will just stop appearing in new selections.`
        : `It has no references anywhere in the system. This ${entityName} will stop appearing in new selections.`,
    confirmText,
    cancelText: "Cancel",
    variant: "danger",
    onConfirm: onConfirmedDelete,
  });
}
