import { connectMongoDB } from "@/lib/mongodb";
import { LeadSource } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createLeadSourceSchema, updateLeadSourceSchema } from "@/lib/validation/crm";
import { ensureCompanyLeadSources } from "@/lib/crmService";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/sources — Returns all lead sources for the company.
 * Automatically seeds defaults if not yet initialized.
 */
export async function GET() {
  try {
    return await withSession(async ({ companyId }) => {
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      await ensureCompanyLeadSources(companyId);

      const sources = await LeadSource.find({ companyId })
        .sort({ sortOrder: 1, name: 1 })
        .lean();

      return apiSuccess(sources.map((s) => ({ ...s, id: s._id })));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/sources" });
  }
}

/**
 * POST /api/crm/sources — Create a custom lead source.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "crm:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to manage lead sources.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const body = await readJsonBody(req);
      const input = createLeadSourceSchema.parse(body);

      const sourceId = `src_${companyId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const source = await LeadSource.create({
        _id: sourceId,
        companyId,
        name: input.name,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        isDefault: false,
        createdAt: new Date(),
      });

      return apiSuccess({ id: source._id, name: source.name }, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/sources" });
  }
}

/**
 * PATCH /api/crm/sources — Update a lead source.
 */
export async function PATCH(req: Request) {
  try {
    return await withSession(async ({ role, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "crm:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to manage lead sources.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) throw new ApiError("VALIDATION_ERROR", "Source id is required.");

      await connectMongoDB();
      const source = await LeadSource.findOne({ _id: id, companyId });
      if (!source) throw new ApiError("NOT_FOUND", "Lead source not found.");

      const body = await readJsonBody(req);
      const input = updateLeadSourceSchema.parse(body);

      if (input.name) source.name = input.name;
      if (input.sortOrder !== undefined) source.sortOrder = input.sortOrder;
      if (input.isActive !== undefined) source.isActive = input.isActive;

      await source.save();

      return apiSuccess({ id: source._id, updated: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/crm/sources" });
  }
}

