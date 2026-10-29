import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { withPermission, withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { getOnboardingState } from "@/lib/companyOnboarding";

export const dynamic = "force-dynamic";

/** GET /api/company/onboarding — the caller's company setup guide (steps worked out from its own data). */
export async function GET() {
  try {
    return await withSession(async (actor) => {
      if (!actor.companyId) throw new ApiError("FORBIDDEN", "An active company context is required.");
      await connectMongoDB();
      return apiSuccess(await getOnboardingState(actor.companyId));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/company/onboarding" });
  }
}

/** DELETE /api/company/onboarding — hides the setup guide for the caller's company. */
export async function DELETE() {
  try {
    return await withPermission("company:edit", async (actor) => {
      if (!actor.companyId) throw new ApiError("FORBIDDEN", "An active company context is required.");
      await connectMongoDB();
      await Company.updateOne({ _id: actor.companyId }, { $set: { onboardingDismissedAt: new Date(), updatedAt: new Date() } });
      return apiSuccess({ dismissed: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/company/onboarding" });
  }
}
