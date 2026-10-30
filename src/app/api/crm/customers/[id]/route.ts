import { connectMongoDB } from "@/lib/mongodb";
import { Customer, Quotation, Lead, CrmActivity } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, parseNumericId, readJsonBody } from "@/lib/api-response";
import { updateCustomerSchema } from "@/lib/validation/crm";
import { assertValidLeadAssignees, crmVisibilityFilter, findCustomerByContact, isDuplicateKey, quotationGrandTotals, recordCrmActivity } from "@/lib/crmService";

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
        .select("_id quotationNumber status clientName createdAt")
        .sort({ createdAt: -1 })
        .lean();
      // The total is worked out from the quotation's items, exactly as the quotation screens do.
      const totals = await quotationGrandTotals(quotations.map((q) => String(q._id)));

      // Find all leads for this customer
      const leads = await Lead.find({ customerId, companyId })
        .select("_id referenceNumber status priority estimatedBudget projectType createdAt nextFollowUpAt expectedClosingDate lostReason")
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
        quotations: quotations.map((q) => ({ ...q, id: q._id, grandTotal: totals.get(String(q._id))?.grandTotal ?? 0 })),
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

      if (input.phone !== undefined || input.email !== undefined) {
        const clash = await findCustomerByContact(
          companyId,
          input.phone !== undefined ? input.phone : null,
          input.email !== undefined ? input.email : null,
          customerId
        );
        if (clash) {
          throw new ApiError("CONFLICT", `Another customer already has this ${input.phone && clash.phone ? "phone number" : "email"} (${clash.name}).`);
        }
      }

      await assertValidLeadAssignees({
        companyId,
        dealerId: role !== "dealer" && input.dealerId && input.dealerId !== customer.dealerId ? input.dealerId : null,
        assignedSalesId: input.assignedSalesId && input.assignedSalesId !== customer.assignedSalesId ? input.assignedSalesId : null,
      });

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
      try {
        await customer.save();
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        throw new ApiError("CONFLICT", "Another customer already has this phone number.", { field: "phone" });
      }

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
