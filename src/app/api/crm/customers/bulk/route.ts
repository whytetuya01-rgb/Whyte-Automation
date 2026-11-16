import { connectMongoDB } from "@/lib/mongodb";
import { Customer } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { assertValidLeadAssignees, crmVisibilityFilter, recordCrmActivity } from "@/lib/crmService";
import type { CustomerType } from "@/types/crm";

export const dynamic = "force-dynamic";

const VALID_CUSTOMER_TYPES: readonly CustomerType[] = [
  "individual",
  "architect",
  "builder",
  "interior_designer",
  "contractor",
  "dealer",
  "commercial",
  "other",
];

interface BulkCustomerBody {
  action: "tag" | "assign" | "updateType" | "delete";
  customerIds: number[];
  tag?: string;
  tagMode?: "add" | "remove";
  assignedSalesId?: number | null;
  dealerId?: number | null;
  customerType?: CustomerType;
  deletionReason?: string;
}

/**
 * POST /api/crm/customers/bulk
 * Perform mass batch operations across multiple customers (tag, assign, update type, delete).
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "customers:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to manage customers.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const body = (await readJsonBody(req)) as BulkCustomerBody;
      const { action, customerIds } = body;

      if (!action || !Array.isArray(customerIds) || customerIds.length === 0) {
        throw new ApiError("VALIDATION_ERROR", "Please provide a valid action and an array of customer IDs.");
      }

      if (customerIds.length > 500) {
        throw new ApiError("VALIDATION_ERROR", "Cannot process more than 500 customers in a single batch.");
      }

      const validNumericIds = customerIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (validNumericIds.length === 0) {
        throw new ApiError("VALIDATION_ERROR", "No valid customer IDs provided.");
      }

      await connectMongoDB();
      const visibility = crmVisibilityFilter({ role, userId });

      // Base query restricted to this tenant and current caller's visibility
      const baseFilter: Record<string, unknown> = {
        _id: { $in: validNumericIds },
        companyId,
        ...visibility,
      };

      if (action === "tag") {
        const rawTag = (body.tag ?? "").trim();
        if (!rawTag || rawTag.length > 60) {
          throw new ApiError("VALIDATION_ERROR", "Please provide a valid tag (1-60 characters).");
        }
        const mode = body.tagMode === "remove" ? "remove" : "add";

        const updateOperation =
          mode === "remove"
            ? { $pull: { tags: rawTag }, $set: { updatedAt: new Date() } }
            : { $addToSet: { tags: rawTag }, $set: { updatedAt: new Date() } };

        const result = await Customer.updateMany(baseFilter, updateOperation);

        await recordCrmActivity({
          companyId,
          type: "note",
          title: `Bulk Tag ${mode === "remove" ? "Removed" : "Added"}`,
          description: `Tag "${rawTag}" was ${mode === "remove" ? "removed from" : "applied to"} ${result.modifiedCount} customer(s).`,
          performedBy: userId,
        });

        return apiSuccess({
          action,
          mode,
          tag: rawTag,
          modifiedCount: result.modifiedCount,
          matchedCount: result.matchedCount,
        });
      }

      if (action === "assign") {
        const { assignedSalesId, dealerId } = body;
        await assertValidLeadAssignees({ companyId, assignedSalesId, dealerId });

        const setFields: Record<string, unknown> = { updatedAt: new Date() };
        if (assignedSalesId !== undefined) {
          setFields.assignedSalesId = assignedSalesId === null ? null : Number(assignedSalesId);
        }
        if (dealerId !== undefined) {
          setFields.dealerId = dealerId === null ? null : Number(dealerId);
        }

        const result = await Customer.updateMany(baseFilter, { $set: setFields });

        await recordCrmActivity({
          companyId,
          type: "note",
          title: "Bulk Customer Reassignment",
          description: `Updated sales assignment for ${result.modifiedCount} customer(s).`,
          performedBy: userId,
        });

        return apiSuccess({
          action,
          modifiedCount: result.modifiedCount,
          matchedCount: result.matchedCount,
        });
      }

      if (action === "updateType") {
        const customerType = body.customerType;
        if (!customerType || !VALID_CUSTOMER_TYPES.includes(customerType)) {
          throw new ApiError(
            "VALIDATION_ERROR",
            `Invalid customer type. Allowed: ${VALID_CUSTOMER_TYPES.join(", ")}`
          );
        }

        const result = await Customer.updateMany(baseFilter, {
          $set: { customerType, updatedAt: new Date() },
        });

        await recordCrmActivity({
          companyId,
          type: "note",
          title: "Bulk Customer Type Change",
          description: `Changed category to "${customerType}" for ${result.modifiedCount} customer(s).`,
          performedBy: userId,
        });

        return apiSuccess({
          action,
          customerType,
          modifiedCount: result.modifiedCount,
          matchedCount: result.matchedCount,
        });
      }

      if (action === "delete") {
        const deletionReason = (body.deletionReason || "Bulk deleted from CRM Customers").trim();

        const result = await Customer.collection.updateMany(
          {
            _id: { $in: validNumericIds as any },
            companyId,
            ...(visibility as Record<string, unknown>),
          },
          {
            $set: {
              isDeleted: true,
              deletedAt: new Date(),
              deletedBy: userId,
              deletionReason,
            },
          }
        );

        await recordCrmActivity({
          companyId,
          type: "note",
          title: "Bulk Customers Archived",
          description: `Archived ${result.modifiedCount} customer(s) from CRM. Reason: ${deletionReason}`,
          performedBy: userId,
        });

        return apiSuccess({
          action,
          modifiedCount: result.modifiedCount,
          matchedCount: result.matchedCount,
        });
      }

      throw new ApiError("VALIDATION_ERROR", `Unsupported bulk action: ${String(action)}`);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/customers/bulk" });
  }
}
