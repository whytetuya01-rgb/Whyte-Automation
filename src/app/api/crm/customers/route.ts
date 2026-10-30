import { connectMongoDB } from "@/lib/mongodb";
import { Customer, Quotation, Lead } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createCustomerSchema } from "@/lib/validation/crm";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam, parseIntQueryParam } from "@/lib/validation/common";
import { getNextSequence } from "@/lib/counter";
import { crmVisibilityFilter, recordCrmActivity } from "@/lib/crmService";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/customers — List & search customers.
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:read")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const { searchParams } = new URL(req.url);
      const pagination = parsePaginationParams(searchParams);
      const search = parseSearchQueryParam(searchParams, "search");
      const customerType = parseStringQueryParam(searchParams, "customerType", { max: 30 });
      const salesId = parseIntQueryParam(searchParams, "assignedSalesId");
      const dealerId = parseIntQueryParam(searchParams, "dealerId");

      const query: Record<string, unknown> = {
        companyId,
        ...crmVisibilityFilter({ role, userId }),
      };

      if (customerType && customerType !== "all") query.customerType = customerType;
      if (salesId) query.assignedSalesId = salesId;
      if (dealerId) query.dealerId = dealerId;

      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$or = [
          { name: rx },
          { phone: rx },
          { email: rx },
          { gstNumber: rx },
          { billingAddress: rx },
          { siteAddress: rx },
        ];
      }

      const total = await Customer.countDocuments(query);
      const customers = await Customer.find(query)
        .populate({ path: "assignedSales", select: "name firstName lastName email" })
        .populate({ path: "dealer", select: "name firstName lastName companyName" })
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.take)
        .lean();

      // Enrich with linked quotations count
      const customerIds = customers.map((c) => c._id);
      const quotationCounts = await Quotation.aggregate<{ _id: number; count: number }>([
        { $match: { companyId, customerId: { $in: customerIds } } },
        { $group: { _id: "$customerId", count: { $sum: 1 } } },
      ]);
      const countsMap = new Map<number, number>();
      for (const item of quotationCounts) {
        if (item._id) countsMap.set(item._id, item.count);
      }

      return apiSuccess(
        createPaginatedResponse(
          customers.map((c) => ({
            ...c,
            id: c._id,
            quotationsCount: countsMap.get(c._id) || 0,
          })),
          total,
          pagination
        )
      );
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/crm/customers" });
  }
}

/**
 * POST /api/crm/customers — Create a central customer record.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to create customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      await connectMongoDB();
      const body = await readJsonBody(req);
      const input = createCustomerSchema.parse(body);

      // Check for duplicate phone or email in this company
      const orClauses: Array<Record<string, unknown>> = [];
      if (input.phone) orClauses.push({ phone: input.phone });
      if (input.email) orClauses.push({ email: input.email });

      if (orClauses.length > 0) {
        const existing = await Customer.findOne({ companyId, $or: orClauses }).lean();
        if (existing) {
          throw new ApiError(
            "CONFLICT",
            `A customer with this ${existing.phone === input.phone ? "phone number" : "email"} already exists (${existing.name}).`,
            { field: existing.phone === input.phone ? "phone" : "email" }
          );
        }
      }

      const nextId = await getNextSequence("customer", Customer);
      const customer = await Customer.create({
        _id: nextId,
        companyId,
        name: input.name,
        phone: input.phone ?? null,
        whatsapp: input.whatsapp ?? input.phone ?? null,
        email: input.email ?? null,
        billingAddress: input.billingAddress ?? null,
        siteAddress: input.siteAddress ?? null,
        gstNumber: input.gstNumber ?? null,
        customerType: input.customerType,
        assignedSalesId: input.assignedSalesId ?? null,
        dealerId: role === "dealer" ? userId : (input.dealerId ?? null),
        notes: input.notes ?? null,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await recordCrmActivity({
        companyId,
        customerId: customer._id,
        type: "note",
        title: "Customer Created",
        description: `Customer profile created for ${customer.name}.`,
        performedBy: userId,
      });

      return apiSuccess({ id: customer._id, name: customer.name }, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/customers" });
  }
}
