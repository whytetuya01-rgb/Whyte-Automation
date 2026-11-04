import { z } from "zod";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { requireActiveCompany, withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { loadStageProbabilities } from "@/lib/crmService";
import { CONFIGURABLE_PROBABILITY_STAGES, STAGE_PROBABILITY, canConfigureStageProbabilities } from "@/lib/pipelineProbability";

export const dynamic = "force-dynamic";

const wholePercent = z.number().int("Use a whole number.").min(0, "At least 0%.").max(100, "At most 100%.");

/** Every configurable stage, once; unknown keys (won, lost, anything else) are refused. */
const stageProbabilitiesSchema = z
  .object({
    new: wholePercent,
    contacted: wholePercent,
    site_visit: wholePercent,
    quoted: wholePercent,
    negotiation: wholePercent,
  })
  .strict();

/**
 * GET /api/crm/stage-probabilities
 *
 * The acting company's default win chance per pipeline stage (its own settings over the built-in defaults), the built-in
 * defaults, and whether the caller may change them. These percentages only weight the pipeline forecast: they never change
 * a quotation total or revenue.
 */
export async function GET() {
  try {
    return await withSession(async (actor) => {
      if (!hasPermission(actor.role, actor.permissions, "crm:read") && !hasPermission(actor.role, actor.permissions, "leads:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view the pipeline.");
      }
      const companyId = requireActiveCompany(actor);
      await connectMongoDB();
      return apiSuccess({
        stages: await loadStageProbabilities(companyId),
        defaults: STAGE_PROBABILITY,
        configurableStages: CONFIGURABLE_PROBABILITY_STAGES,
        canManage: canConfigureStageProbabilities(actor.role, actor.permissions),
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/stage-probabilities" });
  }
}

/** PUT /api/crm/stage-probabilities: the Company Owner, an Admin, or a CRM-managing custom admin sets the company's percentages. */
export async function PUT(req: Request) {
  try {
    return await withSession(async (actor) => {
      if (!canConfigureStageProbabilities(actor.role, actor.permissions)) {
        throw new ApiError("FORBIDDEN", "Only the Company Owner or an authorised Admin can change stage probabilities.");
      }
      const companyId = requireActiveCompany(actor);
      const parsed = stageProbabilitiesSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError("VALIDATION_ERROR", issue?.message ?? "Invalid stage probabilities.", {
          field: issue?.path.length ? String(issue.path[0]) : undefined,
          details: { issues: parsed.error.issues },
        });
      }
      await connectMongoDB();
      await Company.updateOne({ _id: companyId }, { $set: { "crmSettings.stageProbabilities": parsed.data, updatedAt: new Date() } });
      return apiSuccess({ stages: await loadStageProbabilities(companyId), defaults: STAGE_PROBABILITY });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PUT /api/crm/stage-probabilities" });
  }
}
