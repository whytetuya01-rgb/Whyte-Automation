import { z } from "zod";
import { connectMongoDB } from "@/lib/mongodb";
import { withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { parseQuotationId } from "@/lib/validation/quotation";
import { optionalText, strictObject } from "@/lib/validation/common";
import { decideRevisionRequest } from "@/lib/quotationRevisionService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const decisionSchema = strictObject({ decision: z.enum(["approve", "reject"]), note: optionalText(500) });

/**
 * POST /api/quotations/[id]/revisions/request/decision { decision: "approve" | "reject", note? }
 *
 * An approver (quotations:transition) decides a waiting request to revise an approved or delivered quotation. Approving creates the
 * revision; rejecting leaves the quotation exactly as it is. Either way the decision is recorded in the quotation's history.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withPermission("quotations:transition", async ({ userId }) => {
      const quotationId = parseQuotationId((await context.params).id);
      const input = decisionSchema.parse(await readJsonBody(req));
      await connectMongoDB();
      return apiSuccess(await decideRevisionRequest(quotationId, { actor: { userId, canApprove: true }, decision: input.decision, note: input.note ?? null }));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/[id]/revisions/request/decision" });
  }
}
