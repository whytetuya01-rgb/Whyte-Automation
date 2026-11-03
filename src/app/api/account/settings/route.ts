import { z } from "zod";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { strictObject } from "@/lib/validation/common";
import { FOLLOW_UP_TIME_ZONE, isValidTimeZone, resolveFollowUpTimeZone } from "@/lib/followUps";
import { invalidateSessionActor } from "@/lib/sessionGuard";
import { runUnscoped } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

/** Dealers and Sales Executives have no admin panel (dealers have their own profile page). */
const NO_ACCOUNT_PAGE_ROLES = new Set(["dealer", "sales_executive", "sales"]);

const updateSchema = strictObject({
  /** An IANA time zone name, or null to go back to the default (Asia/Kolkata). */
  timeZone: z.union([z.string().trim().min(1).max(64), z.null()]).optional(),
  /** The morning email of follow-ups due today and overdue: on (default) or off. */
  followUpReminderEmails: z.boolean().optional(),
}).refine((input) => input.timeZone !== undefined || input.followUpReminderEmails !== undefined, { message: "Nothing to change." });

interface Row {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  role?: string | null;
  timeZone?: string | null;
  followUpReminderEmails?: boolean | null;
}

async function describe(userId: number) {
  await connectMongoDB();
  // Reading the signed-in person's own record: the same lookup the sign-in check uses (works for a platform Super Admin too).
  const row = await runUnscoped("auth-lookup", async () => await AdminUser.findById(userId).select("name firstName lastName email role timeZone followUpReminderEmails").lean<Row>());
  if (!row) throw new ApiError("NOT_FOUND", "Account not found.");
  const chosen = row.timeZone && isValidTimeZone(row.timeZone) ? row.timeZone : null;
  return {
    profile: {
      name: row.name || `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.email || "",
      email: row.email ?? "",
      role: row.role ?? "",
    },
    timeZone: { chosen, effective: resolveFollowUpTimeZone(chosen), default: FOLLOW_UP_TIME_ZONE },
    reminders: { followUpEmails: row.followUpReminderEmails !== false },
  };
}

/**
 * GET /api/account/settings — the signed-in person's own account settings: their time zone and the morning follow-up email.
 * PATCH /api/account/settings { timeZone?, followUpReminderEmails? } — change either. timeZone null = back to the default,
 * Asia/Kolkata.
 * Nobody can read or change anyone else's here: the person is always the one signed in.
 */
export async function GET() {
  try {
    return await withSession(async ({ userId, role }) => {
      if (NO_ACCOUNT_PAGE_ROLES.has(role)) throw new ApiError("FORBIDDEN", "This page is for administrators.");
      return apiSuccess(await describe(userId));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/account/settings" });
  }
}

export async function PATCH(req: Request) {
  try {
    return await withSession(async ({ userId, role }) => {
      if (NO_ACCOUNT_PAGE_ROLES.has(role)) throw new ApiError("FORBIDDEN", "This page is for administrators.");
      const input = updateSchema.parse(await readJsonBody(req));
      const set: Record<string, unknown> = {};
      const unset: Record<string, 1> = {};
      if (input.timeZone !== undefined) {
        if (input.timeZone !== null && !isValidTimeZone(input.timeZone)) {
          throw new ApiError("VALIDATION_ERROR", "That is not a known time zone. Pick one from the list, for example Asia/Kolkata.", { field: "timeZone" });
        }
        if (input.timeZone === null) unset.timeZone = 1;
        else set.timeZone = resolveFollowUpTimeZone(input.timeZone);
      }
      // On is the default, so turning it back on removes the field rather than storing true.
      if (input.followUpReminderEmails === false) set.followUpReminderEmails = false;
      else if (input.followUpReminderEmails === true) unset.followUpReminderEmails = 1;

      await connectMongoDB();
      const changes = { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
      // A company's person is updated inside their own company; the platform Super Admin has no company.
      const run = () => AdminUser.updateOne({ _id: userId }, changes);
      if (role === "super_admin") await runUnscoped("platform-admin", async () => await run());
      else await run();

      invalidateSessionActor(userId);
      return apiSuccess(await describe(userId));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/account/settings" });
  }
}
