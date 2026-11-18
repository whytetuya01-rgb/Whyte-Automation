import { connectMongoDB } from "@/lib/mongodb";
import { QuotationTemplate } from "@/models/QuotationTemplate";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { ensureDefaultCompanyTemplate, ensurePublishedVersionRecord } from "@/lib/templateService";
import { validateWorkflowDependencies } from "@/lib/templateValidation";
import {
  DEFAULT_TEMPLATE_SECTIONS,
  DEFAULT_CONFIGURABLE_COLUMNS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_NUMBERING_FORMAT,
  DEFAULT_WORKFLOW_STEPS,
} from "@/types/template";

export const dynamic = "force-dynamic";

/**
 * GET /api/templates
 * Lists all quotation workflow templates for the current company tenant.
 * Auto-seeds default and demo templates if none exist yet.
 */
export async function GET() {
  try {
    return await withSession(async (actor) => {
      const { companyId } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      await connectMongoDB();
      await ensureDefaultCompanyTemplate(companyId);

      const templates = await QuotationTemplate.find({ companyId })
        .sort({ isDefault: -1, createdAt: 1 })
        .lean({ virtuals: true });

      return apiSuccess(templates);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/templates" });
  }
}

/**
 * POST /api/templates
 * Creates a new quotation workflow template for the company.
 * Requires admin / company_owner permissions.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async (actor) => {
      const { companyId, role, userId } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      // Enforce multi-tenant role authorization
      const isAuthorized = role === "super_admin" || role === "company_owner" || role === "admin";
      if (!isAuthorized) {
        throw new ApiError("FORBIDDEN", "Only company administrators can create workflow templates.");
      }

      const body = (await readJsonBody(req)) as any;
      if (!body || typeof body !== "object") {
        throw new ApiError("VALIDATION_ERROR", "Invalid template payload.");
      }

      const name = (body.name || "").trim();
      if (!name) {
        throw new ApiError("VALIDATION_ERROR", "Template name is required.");
      }

      await connectMongoDB();

      // Check for duplicate name in same company
      const existing = await QuotationTemplate.findOne({ companyId, name });
      if (existing) {
        throw new ApiError("CONFLICT", `A template named "${name}" already exists for your company.`);
      }

      const workflow = body.workflow || { steps: [...DEFAULT_WORKFLOW_STEPS] };
      if (workflow?.steps) {
        const valResult = validateWorkflowDependencies(workflow.steps);
        if (!valResult.isValid) {
          throw new ApiError("VALIDATION_ERROR", `Invalid workflow dependencies: ${valResult.errors.join("; ")}`);
        }
      }

      const isDefault = Boolean(body.isDefault);
      if (isDefault) {
        // Demote previous default
        await QuotationTemplate.updateMany({ companyId, isDefault: true }, { $set: { isDefault: false } });
      }

      const templateId = "tmpl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);

      const newTemplate = await QuotationTemplate.create({
        _id: templateId,
        companyId,
        name,
        description: body.description?.trim() || null,
        isDefault,
        version: 1,
        isPublished: true,
        workflow,
        documentLayout: body.documentLayout || null,
        numberingFormat: body.numberingFormat || { ...DEFAULT_NUMBERING_FORMAT },
        layoutSettings: body.layoutSettings || { ...DEFAULT_LAYOUT_SETTINGS },
        configurableColumns: body.configurableColumns || { ...DEFAULT_CONFIGURABLE_COLUMNS },
        sectionOrder: body.sectionOrder || [...DEFAULT_TEMPLATE_SECTIONS],
        customFields: body.customFields || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Ensure immutable version snapshot v1 is stored
      await ensurePublishedVersionRecord(newTemplate, userId);

      return apiSuccess(newTemplate.toJSON(), { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/templates" });
  }
}
