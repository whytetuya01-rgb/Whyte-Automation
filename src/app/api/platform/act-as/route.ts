import { z } from "zod";
import { requireRole } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { startActAsSession, endActAsSession, resolveActAsGrant } from "@/lib/tenant/actAs";

export const dynamic = "force-dynamic";

const startSchema = z.object({
  companyId: z.number().int().positive(),
  reason: z.string().trim().min(1, "A reason is required for every act-as session.").max(500),
});

/**
 * GET /api/platform/act-as
 * Reports whether this Super Admin currently has a valid "act as company"
 * grant, so the UI can tell company-specific actions are unavailable until a
 * company is selected. Read-only; the grant itself is validated server-side
 * on every request, never taken from this response.
 */
export async function GET() {
  try {
    const session = await requireRole("super_admin");
    const userId = Number((session.user as { id?: string }).id);

    const grant = await resolveActAsGrant(userId);
    if (grant === null) {
      return apiSuccess({ actingAsCompany: false, companyId: null, companyName: null, reason: null, expiresAt: null });
    }
    const company = await Company.findById(grant.companyId).select("name").lean();
    return apiSuccess({
      actingAsCompany: true,
      companyId: grant.companyId,
      companyName: company?.name ?? null,
      reason: grant.reason,
      expiresAt: grant.expiresAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/platform/act-as" });
  }
}

/**
 * POST /api/platform/act-as
 * Starts a Super Admin "act as company" session (Phase 1 decision #4): every
 * switch is audit-logged (`src/models/PlatformAccessLog.ts` IS the log, not
 * a separate record of it). Strictly Super Admin only.
 */
export async function POST(req: Request) {
  try {
    const session = await requireRole("super_admin");
    const userId = Number((session.user as { id?: string }).id);

    const { companyId, reason } = startSchema.parse(await readJsonBody(req));

    await connectMongoDB();
    const company = await Company.findById(companyId).select("status name").lean();
    if (!company) {
      throw new ApiError("NOT_FOUND", "Company not found.", { field: "companyId" });
    }

    const sessionId = await startActAsSession(userId, companyId, reason);

    return apiSuccess({ companyId, companyName: company.name, sessionId });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/platform/act-as" });
  }
}

/**
 * DELETE /api/platform/act-as
 * Ends the current act-as session, if any, returning Super Admin to the
 * default "sees no company business data" state.
 */
export async function DELETE() {
  try {
    const session = await requireRole("super_admin");
    const userId = Number((session.user as { id?: string }).id);

    await connectMongoDB();
    await endActAsSession(userId);

    return apiSuccess({ actingAsCompany: false });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/platform/act-as" });
  }
}
