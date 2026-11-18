import { connectMongoDB } from "@/lib/mongodb";
import { QuotationTemplate } from "@/models/QuotationTemplate";
import { withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { validateWorkflowDependencies } from "@/lib/templateValidation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/templates/[id]
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async (actor) => {
      const { companyId } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      const { id } = await context.params;
      await connectMongoDB();

      const template = await QuotationTemplate.findOne({ _id: id, companyId }).lean({ virtuals: true });
      if (!template) {
        throw new ApiError("NOT_FOUND", "Quotation template not found.");
      }

      return apiSuccess(template);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/templates/[id]" });
  }
}

/**
 * PUT /api/templates/[id]
 * Updates draft definition of an existing template.
 * Admin edits do not mutate published versions (immutable versioning).
 */
export async function PUT(req: Request, context: RouteContext) {
  try {
    return await withSession(async (actor) => {
      const { companyId, role } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      const isAuthorized = role === "super_admin" || role === "company_owner" || role === "admin";
      if (!isAuthorized) {
        throw new ApiError("FORBIDDEN", "Only company administrators can modify workflow templates.");
      }

      const { id } = await context.params;
      const body = (await readJsonBody(req)) as any;
      if (!body || typeof body !== "object") {
        throw new ApiError("VALIDATION_ERROR", "Invalid update payload.");
      }

      await connectMongoDB();

      const existing = await QuotationTemplate.findOne({ _id: id, companyId });
      if (!existing) {
        throw new ApiError("NOT_FOUND", "Quotation template not found.");
      }

      if (body.name && body.name.trim() !== existing.name) {
        const dup = await QuotationTemplate.findOne({
          companyId,
          name: body.name.trim(),
          _id: { $ne: id },
        });
        if (dup) {
          throw new ApiError("CONFLICT", `A template named "${body.name.trim()}" already exists.`);
        }
        existing.name = body.name.trim();
      }

      if (body.workflow !== undefined) {
        if (body.workflow?.steps) {
          const valResult = validateWorkflowDependencies(body.workflow.steps);
          if (!valResult.isValid) {
            throw new ApiError("VALIDATION_ERROR", `Invalid workflow dependencies: ${valResult.errors.join("; ")}`);
          }
        }
        existing.workflow = body.workflow;
        // Updating working draft marks it as unpublished until explicitly published
        existing.isPublished = false;
      }

      if (body.documentLayout !== undefined) {
        existing.documentLayout = body.documentLayout;
        existing.isPublished = false;
      }
      if (body.description !== undefined) existing.description = body.description?.trim() || null;
      if (body.numberingFormat !== undefined) existing.numberingFormat = body.numberingFormat;
      if (body.layoutSettings !== undefined) existing.layoutSettings = body.layoutSettings;
      if (body.configurableColumns !== undefined) existing.configurableColumns = body.configurableColumns;
      if (body.sectionOrder !== undefined) existing.sectionOrder = body.sectionOrder;
      if (body.customFields !== undefined) existing.customFields = body.customFields;

      if (body.isDefault !== undefined && Boolean(body.isDefault) !== existing.isDefault) {
        if (body.isDefault) {
          await QuotationTemplate.updateMany(
            { companyId, _id: { $ne: id }, isDefault: true },
            { $set: { isDefault: false } }
          );
          existing.isDefault = true;
        } else {
          // Cannot unset default if it is the only template
          const count = await QuotationTemplate.countDocuments({ companyId });
          if (count > 1) {
            existing.isDefault = false;
          }
        }
      }

      existing.updatedAt = new Date();
      await existing.save();

      return apiSuccess(existing.toJSON());
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PUT /api/templates/[id]" });
  }
}

/**
 * DELETE /api/templates/[id]
 * Deleting a template does not mutate historical QuotationTemplateVersion records,
 * ensuring existing quotations remain bound to their original version.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    return await withSession(async (actor) => {
      const { companyId, role } = actor;
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required.");
      }

      const isAuthorized = role === "super_admin" || role === "company_owner" || role === "admin";
      if (!isAuthorized) {
        throw new ApiError("FORBIDDEN", "Only company administrators can delete workflow templates.");
      }

      const { id } = await context.params;
      await connectMongoDB();

      const totalCount = await QuotationTemplate.countDocuments({ companyId });
      if (totalCount <= 1) {
        throw new ApiError("CONFLICT", "Cannot delete the only remaining quotation template for your company.");
      }

      const target = await QuotationTemplate.findOne({ _id: id, companyId });
      if (!target) {
        throw new ApiError("NOT_FOUND", "Quotation template not found.");
      }

      const wasDefault = target.isDefault;
      await QuotationTemplate.deleteOne({ _id: id, companyId });

      if (wasDefault) {
        // Promote another template to default
        const nextDefault = await QuotationTemplate.findOne({ companyId }).sort({ createdAt: 1 });
        if (nextDefault) {
          nextDefault.isDefault = true;
          await nextDefault.save();
        }
      }

      return apiSuccess({ deleted: true, id });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/templates/[id]" });
  }
}
