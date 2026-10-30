import { connectMongoDB } from "@/lib/mongodb";
import { Customer, Quotation, Lead, CrmActivity } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { updateCustomerSchema } from "@/lib/validation/crm";
import { crmVisibilityFilter, recordCrmActivity } from "@/lib/crmService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/crm/customers/[id] — Customer profile with quotations and leads history.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const rawId = (await context.params).id;
      const customerId = parseNumericId(rawId, "Customer id");
      await connectMongoDB();

      const visibility = crmVisibilityFilter({ role, userId });
      const customer = await Customer.findOne({ _id: customerId, companyId, ...visibility })
        .populate({ path: "assignedSales", select: "name firstName lastName email contactNumber" })
        .populate({ path: "dealer", select: "name firstName lastName companyName contactNumber" })
        .lean();

      if (!customer) {
        throw new ApiError("NOT_FOUND", "Customer not found or access denied.");
      }

      // Find all quotations for this customer
      const quotations = await Quotation.find({ customerId, companyId })
        .select("_id quotationNumber status clientName grandTotal createdAt")
        .sort({ createdAt: -1 })
        .lean();

      // Find all leads for this customer
      const leads = await Lead.find({ customerId, companyId })
        .select("_id referenceNumber status priority estimatedBudget projectType createdAt")
        .sort({ createdAt: -1 })
        .lean();

      // Find all activities for this customer
      const activities = await CrmActivity.find({ customerId, companyId })
        .sort({ performedAt: -1 })
        .limit(100)
        .lean();

      return apiSuccess({
        ...customer,
        id: customer._id,
        quotations: quotations.map((q) => ({ ...q, id: q._id })),
        leads: leads.map((l) => ({ ...l, id: l._id })),
        activities: activities.map((a) => ({ ...a, id: a._id })),
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/customers/[id]" });
  }
}

/**
 * PATCH /api/crm/customers/[id] — Update customer.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to update customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const rawId = (await context.params).id;
      const customerId = parseNumericId(rawId, "Customer id");
      await connectMongoDB();

      const visibility = crmVisibilityFilter({ role, userId });
      const customer = await Customer.findOne({ _id: customerId, companyId, ...visibility });
      if (!customer) {
        throw new ApiError("NOT_FOUND", "Customer not found or access denied.");
      }

      const body = await readJsonBody(req);
      const input = updateCustomerSchema.parse(body);

      if (input.name) customer.name = input.name;
      if (input.phone !== undefined) customer.phone = input.phone;
      if (input.whatsapp !== undefined) customer.whatsapp = input.whatsapp;
      if (input.email !== undefined) customer.email = input.email;
      if (input.billingAddress !== undefined) customer.billingAddress = input.billingAddress;
      if (input.siteAddress !== undefined) customer.siteAddress = input.siteAddress;
      if (input.gstNumber !== undefined) customer.gstNumber = input.gstNumber;
      if (input.customerType) customer.customerType = input.customerType;
      if (input.assignedSalesId !== undefined) customer.assignedSalesId = input.assignedSalesId;
      if (input.dealerId !== undefined && role !== "dealer") customer.dealerId = input.dealerId;
      if (input.notes !== undefined) customer.notes = input.notes;

      customer.updatedAt = new Date();
      await customer.save();

      await recordCrmActivity({
        companyId,
        customerId: customer._id,
        type: "note",
        title: "Customer Updated",
        description: `Customer details updated for ${customer.name}.`,
        performedBy: userId,
      });

      return apiSuccess({ id: customer._id, updated: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/crm/customers/[id]" });
  }
}

/**
 * DELETE /api/crm/customers/[id] — Soft-delete customer safely.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to delete customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const rawId = (await context.params).id;
      const customerId = parseNumericId(rawId, "Customer id");
      await connectMongoDB();

      const visibility = crmVisibilityFilter({ role, userId });
      const customer = await Customer.findOne({ _id: customerId, companyId, ...visibility });
      if (!customer) {
        throw new ApiError("NOT_FOUND", "Customer not found or access denied.");
      }

      await Customer.collection.updateOne(
        { _id: customer._id as any },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: userId,
            deletionReason: "Archived from CRM Customers",
          },
        }
      );

      await recordCrmActivity({
        companyId,
        customerId: customer._id,
        type: "note",
        title: "Customer Archived",
        description: `Customer profile for ${customer.name} was archived.`,
        performedBy: userId,
      });

      return apiSuccess({ id: customer._id, deleted: true });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/crm/customers/[id]" });
  }
}
