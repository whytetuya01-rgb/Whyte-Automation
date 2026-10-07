import { AdminUser } from "@/models";
import { displayNameOf } from "@/lib/quotationAudit";

export interface QuotationActor {
  id: number;
  name: string;
}

interface ActorSource {
  createdBy?: unknown;
  assignedBy?: unknown;
}

function toUserId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Adds readable `createdByUser` / `assignedByUser` objects ({ id, name }) to
 * quotation records. `createdBy` is stored as a string and `assignedBy` as a
 * number, so names are resolved with one batched lookup instead of populate().
 * Users that can no longer be resolved (or historical rows with no creator)
 * simply get `null`; nothing is invented.
 */
export async function attachQuotationActors<T extends ActorSource>(
  records: T[]
): Promise<Array<T & { createdByUser: QuotationActor | null; assignedByUser: QuotationActor | null }>> {
  const ids = new Set<number>();
  for (const record of records) {
    const created = toUserId(record.createdBy);
    const assigned = toUserId(record.assignedBy);
    if (created !== null) ids.add(created);
    if (assigned !== null) ids.add(assigned);
  }

  const names = new Map<number, string>();
  if (ids.size > 0) {
    const users = await AdminUser.find({ _id: { $in: [...ids] } })
      .select("name firstName lastName email")
      .lean();
    for (const user of users) {
      const name = displayNameOf(user);
      if (name) names.set(user._id, name);
    }
  }

  const toActor = (value: unknown): QuotationActor | null => {
    const id = toUserId(value);
    if (id === null) return null;
    const name = names.get(id);
    return name ? { id, name } : null;
  };

  return records.map((record) => ({
    ...record,
    createdByUser: toActor(record.createdBy),
    assignedByUser: toActor(record.assignedBy),
  }));
}
