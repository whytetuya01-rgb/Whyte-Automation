import { connectMongoDB } from "@/lib/mongodb";
import { Quotation } from "@/models";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { canModifyQuotation, canViewQuotation } from "@/lib/quotationAccess";
import { parseQuotationId } from "@/lib/validation/quotation";
import { requiredText, strictObject } from "@/lib/validation/common";
import { listRevisions, reviseQuotation } from "@/lib/quotationRevisionService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const reviseSchema = strictObject({ reason: requiredText(500, "Say why the quotation is being revised.") });

/** GET /api/quotations/[id]/revisions — every issued version (newest first), the current version number and any pending request. */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const quotationId = parseQuotationId((await context.params).id);
      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canViewQuotation(role, userId, quotation, permissions)) throw new ApiError("FORBIDDEN", "You do not have permission to view this quotation.");
      return apiSuccess({ ...(await listRevisions(quotationId)), canApprove: hasPermission(role, permissions, "quotations:transition") });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/quotations/[id]/revisions" });
  }
}

/**
 * POST /api/quotations/[id]/revisions { reason }
 *
 * Starts a new revision of an issued quotation: the issued version stays exactly as it was and the quotation goes back to draft
 * as the next revision, with the same quotation number. For an approved or delivered quotation only an approver does this at once;
 * anyone else who may edit it files a request (answer `kind: "requested"`) for an approver to decide.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions }) => {
      const quotationId = parseQuotationId((await context.params).id);
      const input = reviseSchema.parse(await readJsonBody(req));
      await connectMongoDB();
      const quotation = await Quotation.findById(quotationId).select("dealerId assignedSalesId createdBy").lean();
      if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
      if (!canModifyQuotation(role, userId, quotation, permissions)) throw new ApiError("FORBIDDEN", "You do not have permission to revise this quotation.");
      const outcome = await reviseQuotation(quotationId, { actor: { userId, canApprove: hasPermission(role, permissions, "quotations:transition") }, reason: input.reason });
      return apiSuccess(outcome, { status: outcome.kind === "revised" ? 201 : 202 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/revisions" });
  }
}
