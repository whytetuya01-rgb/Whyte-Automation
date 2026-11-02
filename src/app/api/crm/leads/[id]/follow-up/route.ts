import { z } from "zod";
import { connectMongoDB } from "@/lib/mongodb";
import { Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { optionalText, strictObject } from "@/lib/validation/common";
import { crmVisibilityFilter, recordCrmActivity } from "@/lib/crmService";
import { FOLLOW_UP_TIME_ZONE, followUpBucket } from "@/lib/followUps";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_DAYS_AHEAD = 730;

const followUpActionSchema = strictObject({
  action: z.enum(["done", "reschedule"]),
  note: optionalText(1000),
  /** The next follow-up. `null` (done only) means there is no next follow-up. */
  nextFollowUpAt: z.union([z.string().trim().min(1), z.null()]).optional(),
});

const when = (date: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: FOLLOW_UP_TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);

/**
 * POST /api/crm/leads/[id]/follow-up
 *   { action: "done", note?, nextFollowUpAt: ISO | null }   marks the follow-up as done (recorded in the timeline, the
 *                                                          lead's last contact is now) and sets or clears the next one
 *   { action: "reschedule", note?, nextFollowUpAt: ISO }   moves the date without marking it done
 * Open leads only; the date must be today or later (Indian business day) and within two years.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "leads:manage")) throw new ApiError("FORBIDDEN", "You do not have permission to update follow-ups.");
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { id } = await context.params;
      const input = followUpActionSchema.parse(await readJsonBody(req));

      let next: Date | null = null;
      if (input.nextFollowUpAt) {
        next = new Date(input.nextFollowUpAt);
        if (Number.isNaN(next.getTime())) throw new ApiError("VALIDATION_ERROR", "That date is not valid.", { field: "nextFollowUpAt" });
        if (followUpBucket(next) === "overdue") throw new ApiError("VALIDATION_ERROR", "Pick today or a later date for the next follow-up.", { field: "nextFollowUpAt" });
        if (next.getTime() - Date.now() > MAX_DAYS_AHEAD * 24 * 3600 * 1000) throw new ApiError("VALIDATION_ERROR", "The next follow-up must be within two years.", { field: "nextFollowUpAt" });
      }
      if (input.action === "reschedule" && !next) throw new ApiError("VALIDATION_ERROR", "Pick the new follow-up date.", { field: "nextFollowUpAt" });
      if (input.action === "done" && input.nextFollowUpAt === undefined) {
        throw new ApiError("VALIDATION_ERROR", "Say when the next follow-up is, or send null for none.", { field: "nextFollowUpAt" });
      }

      await connectMongoDB();
      const lead = await Lead.findOne({ _id: id, companyId, ...crmVisibilityFilter({ role, userId }) });
      if (!lead) throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
      if (lead.status === "won" || lead.status === "lost") {
        throw new ApiError("CONFLICT", `This lead is already ${lead.status}, so it has no follow-up to update.`);
      }

      const previous = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
      const now = new Date();
      lead.nextFollowUpAt = next;
      if (input.action === "done") lead.lastContactedAt = now;
      lead.updatedAt = now;
      await lead.save();

      const nextText = next ? `Next follow-up: ${when(next)}.` : "No next follow-up planned.";
      await recordCrmActivity({
        companyId,
        leadId: lead._id,
        customerId: lead.customerId,
        type: "follow_up",
        title: input.action === "done" ? "Follow-up done" : "Follow-up rescheduled",
        description:
          input.action === "done"
            ? [input.note?.trim(), nextText].filter(Boolean).join(" ")
            : [`Moved from ${previous ? when(previous) : "no date"} to ${when(next as Date)}.`, input.note?.trim()].filter(Boolean).join(" "),
        performedBy: userId,
      });

      return apiSuccess({ id: lead._id, nextFollowUpAt: next ? next.toISOString() : null, lastContactedAt: lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString() : null });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/leads/[id]/follow-up" });
  }
}
