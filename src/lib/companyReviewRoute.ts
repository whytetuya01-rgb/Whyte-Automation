import { z } from "zod";
import type { Session } from "next-auth";
import { ApiError } from "@/lib/api-response";
import { requireRole } from "@/lib/api-auth";
import type { ReviewActor } from "@/lib/companyReview";

/**
 * Shared guard for every company-review endpoint. Review is a platform decision: only a signed-in Super Admin
 * passes, checked on the server from the verified session (never from the request), so hiding a button is never
 * the only protection.
 */
export async function requireReviewer(): Promise<ReviewActor> {
  const session: Session = await requireRole("super_admin");
  const user = session.user as { id?: string; name?: string | null; email?: string | null };
  const id = Number(user.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError("FORBIDDEN", "You do not have permission to perform this action.");
  return { id, name: user.name ?? user.email ?? `Super Admin ${id}` };
}

const idSchema = z.coerce.number().int().positive();

export function parseCompanyId(raw: string): number {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("INVALID_ID", "Invalid company id.", { field: "id" });
  return parsed.data;
}
