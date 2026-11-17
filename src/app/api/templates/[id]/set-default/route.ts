import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { QuotationTemplate } from "@/models/QuotationTemplate";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/templates/[id]/set-default
 * Sets the specified template as the default template for the company.
 */
export async function POST(_req: Request, context: RouteContext) {
  try {
    return await withSession(async (actor) => {
      const { companyId } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      const { id } = await context.params;
      await connectMongoDB();

      const target = await QuotationTemplate.findOne({ _id: id, companyId });
      if (!target) {
        throw new ApiError("NOT_FOUND", "Quotation template not found.");
      }

      await QuotationTemplate.updateMany(
        { companyId, _id: { $ne: id }, isDefault: true },
        { $set: { isDefault: false } }
      );

      target.isDefault = true;
      target.updatedAt = new Date();
      await target.save();

      return apiSuccess(target.toJSON());
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/templates/[id]/set-default" });
  }
}
