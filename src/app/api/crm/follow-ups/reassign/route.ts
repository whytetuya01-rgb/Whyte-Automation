import { z } from "zod";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { numericIdSchema, optionalText, strictObject } from "@/lib/validation/common";
import { withRequiredTransaction } from "@/lib/transaction";
import { canReassignFollowUps, MAX_REASSIGN_BATCH, reassignFollowUps } from "@/lib/followUpReassignment";

export const dynamic = "force-dynamic";

const reassignSchema = strictObject({
  toOwnerId: numericIdSchema,
  tasks: z.array(strictObject({ id: z.string().trim().min(1).max(64), version: z.number().int().min(1).optional() })).min(1).max(MAX_REASSIGN_BATCH),
  note: optionalText(300),
});

/**
 * POST /api/crm/follow-ups/reassign { toOwnerId, tasks: [{ id, version? }], note? }
 *
 * The explicit action that gives follow-ups whose owner can no longer own them to a new owner. Nothing ever does this
 * automatically. The new owner must be an active person who can manage leads. Follow-ups whose current owner is still able
 * to own them, that changed since `version`, or that are no longer open are skipped and listed in the answer. The owner
 * change, the task's history and the lead's timeline are saved together or not at all.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId, timeZone }) => {
      if (!canReassignFollowUps(role, permissions)) throw new ApiError("FORBIDDEN", "Only people who can manage users and leads can reassign follow-ups.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");
      const input = reassignSchema.parse(await readJsonBody(req));
      const result = await withRequiredTransaction((session) =>
        reassignFollowUps({ actor: { userId, role, permissions, companyId, timeZone }, session }, { tasks: input.tasks, toOwnerId: input.toOwnerId, note: input.note ?? null })
      );
      return apiSuccess(result);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/follow-ups/reassign" });
  }
}
