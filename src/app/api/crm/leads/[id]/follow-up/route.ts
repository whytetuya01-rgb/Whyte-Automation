import { z } from "zod";
import { connectMongoDB } from "@/lib/mongodb";
import { Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { numericIdSchema, optionalText, strictObject } from "@/lib/validation/common";
import { crmVisibilityFilter } from "@/lib/crmService";
import { withRequiredTransaction } from "@/lib/transaction";
import { assertSchedulableDate, cancelFollowUp, completeFollowUp, describeFollowUp, ensureFollowUpTaskIndexes, rescheduleFollowUp } from "@/lib/followUpService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const isoOrNull = z.union([z.string().trim().min(1), z.null()]);

const followUpActionSchema = strictObject({
  action: z.enum(["done", "reschedule", "cancel"]),
  note: optionalText(1000),
  /** The next follow-up. `null` (done only) means there is no next follow-up. */
  nextFollowUpAt: isoOrNull.optional(),
  /** Hands the follow-up to this person (an active team member who can manage leads). Default: it stays with its owner. */
  ownerId: numericIdSchema.optional().nullable(),
  /** The date the person was looking at. If someone changed the follow-up since, the request is refused (409). */
  expectedNextFollowUpAt: isoOrNull.optional(),
});

function parseWhen(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError("VALIDATION_ERROR", "That date is not valid.", { field });
  return date;
}

/**
 * GET /api/crm/leads/[id]/follow-up — the lead's current follow-up: its date, who owns it, and whether it is an old
 * follow-up that has no task yet.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:read")) throw new ApiError("FORBIDDEN", "You do not have permission to view follow-ups.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { id } = await context.params;
      await connectMongoDB();
      const lead = await Lead.findOne({ _id: id, companyId, ...crmVisibilityFilter({ role, userId }) }).select("nextFollowUpAt").lean();
      if (!lead) throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
      return apiSuccess(await describeFollowUp(companyId, lead));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/leads/[id]/follow-up" });
  }
}

/**
 * POST /api/crm/leads/[id]/follow-up
 *   { action: "done", note?, nextFollowUpAt: ISO | null }   marks the follow-up as done (recorded in the timeline, the
 *                                                          lead's last contact is now) and sets or clears the next one
 *   { action: "reschedule", note?, nextFollowUpAt: ISO }   moves the date without marking it done
 *   { action: "cancel", note? }                            removes the follow-up without marking it done
 * `ownerId` (done, reschedule) hands the follow-up to someone else; `expectedNextFollowUpAt` refuses the request if the
 * follow-up changed since the person last saw it. Open leads only; a new date must not have passed and must be within
 * two years. The task, the lead and the timeline entry are written together or not at all.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId, timeZone }) => {
      if (!hasPermission(role, permissions, "leads:manage")) throw new ApiError("FORBIDDEN", "You do not have permission to update follow-ups.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { id } = await context.params;
      const input = followUpActionSchema.parse(await readJsonBody(req));

      const next = input.nextFollowUpAt ? parseWhen(input.nextFollowUpAt, "nextFollowUpAt") : null;
      if (input.action === "reschedule" && !next) throw new ApiError("VALIDATION_ERROR", "Pick the new follow-up date.", { field: "nextFollowUpAt" });
      if (input.action === "done" && input.nextFollowUpAt === undefined) {
        throw new ApiError("VALIDATION_ERROR", "Say when the next follow-up is, or send null for none.", { field: "nextFollowUpAt" });
      }
      if (next && input.action !== "cancel") assertSchedulableDate(next);
      const expected = input.expectedNextFollowUpAt === undefined ? undefined : input.expectedNextFollowUpAt === null ? null : parseWhen(input.expectedNextFollowUpAt, "expectedNextFollowUpAt");

      await connectMongoDB();
      await ensureFollowUpTaskIndexes();
      const result = await withRequiredTransaction(async (session) => {
        const lead = await Lead.findOne({ _id: id, companyId, ...crmVisibilityFilter({ role, userId }) }).session(session ?? null);
        if (!lead) throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
        if (lead.status === "won" || lead.status === "lost") {
          throw new ApiError("CONFLICT", `This lead is already ${lead.status}, so it has no follow-up to update.`);
        }

        const ctx = { actor: { userId, role, permissions, companyId, timeZone }, session };
        const note = input.note ?? undefined;
        if (input.action === "done") await completeFollowUp(ctx, lead, { next, note, ownerId: input.ownerId, expectedNextFollowUpAt: expected });
        else if (input.action === "reschedule") await rescheduleFollowUp(ctx, lead, { to: next as Date, note, ownerId: input.ownerId, expectedNextFollowUpAt: expected });
        else await cancelFollowUp(ctx, lead, { note, expectedNextFollowUpAt: expected });
        await lead.save({ session });

        return {
          id: lead._id,
          nextFollowUpAt: lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toISOString() : null,
          lastContactedAt: lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString() : null,
        };
      });

      return apiSuccess(result);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/leads/[id]/follow-up" });
  }
}
