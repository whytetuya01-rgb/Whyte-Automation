import { AdminUser } from "@/models";
import { ApiError } from "@/lib/api-response";
import { isAdminRole, type QuotationActorRole } from "@/lib/quotationAccess";
import { hasPermission } from "@/lib/permissions";

export interface DealerRecord {
  _id: number;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  companyId?: number | null;
  discountAllocationPercent?: number | null;
}

/** Looks up an active dealer; throws a controlled error when it is not one or out of company scope. */
export async function requireActiveDealer(dealerId: number, companyId?: number | null): Promise<DealerRecord> {
  const query: Record<string, unknown> = { _id: dealerId, role: "dealer" };
  if (companyId !== undefined && companyId !== null) {
    query.companyId = companyId;
  }
  const dealer = (await AdminUser.findOne(query).lean()) as
    | (DealerRecord & { isActive?: boolean; companyId?: number | null })
    | null;
  if (!dealer) {
    throw new ApiError("NOT_FOUND", "Dealer not found.", { field: "dealerId" });
  }
  if (dealer.isActive === false) {
    throw new ApiError("VALIDATION_ERROR", "Quotations cannot be assigned to an inactive dealer.", {
      field: "dealerId",
    });
  }
  if (companyId !== undefined && companyId !== null && dealer.companyId != null && dealer.companyId !== companyId) {
    throw new ApiError("FORBIDDEN", "Dealer does not belong to the authorized company.", {
      field: "dealerId",
    });
  }
  return dealer;
}

/** Looks up an active sales executive; throws a controlled error when it is not one or out of company scope. */
export async function requireActiveSalesExecutive(
  salesId: number,
  companyId?: number | null
): Promise<{ _id: number; name?: string | null; companyId?: number | null }> {
  const query: Record<string, unknown> = { _id: salesId, role: "sales_executive" };
  if (companyId !== undefined && companyId !== null) {
    query.companyId = companyId;
  }
  const sales = (await AdminUser.findOne(query).lean()) as
    | { _id: number; name?: string | null; isActive?: boolean; companyId?: number | null }
    | null;
  if (!sales) {
    throw new ApiError("NOT_FOUND", "Sales executive not found.", { field: "assignedSalesId" });
  }
  if (sales.isActive === false) {
    throw new ApiError("VALIDATION_ERROR", "Quotations cannot be assigned to an inactive sales executive.", {
      field: "assignedSalesId",
    });
  }
  if (companyId !== undefined && companyId !== null && sales.companyId != null && sales.companyId !== companyId) {
    throw new ApiError("FORBIDDEN", "Sales executive does not belong to the authorized company.", {
      field: "assignedSalesId",
    });
  }
  return sales;
}

export interface QuotationOwnership {
  /** Dealer the quotation belongs to ("assignedTo"); null = not assigned. */
  dealerId: number | null;
  dealer: DealerRecord | null;
  /** Sales executive the quotation belongs to; null = unassigned. */
  assignedSalesId: number | null;
  /** Set only when an admin performed an assignment. */
  assignedBy: number | null;
  assignedOn: Date | null;
  allocatedPercent: number;
}

/**
 * Derives the ownership/assignment fields for a NEW quotation (create or clone)
 * from the authenticated actor.
 *
 *  - dealer: always owns it themselves. Naming any other dealer is forbidden.
 *  - sales_executive: always assigned to themselves. Naming a dealer or other salesperson is forbidden.
 *  - super_admin / admin / company_owner: may assign to a validated dealer and/or sales executive.
 */
export async function resolveNewQuotationOwnership(params: {
  role: QuotationActorRole;
  userId: number;
  requestedDealerId?: number | null | undefined;
  requestedSalesId?: number | null | undefined;
  callerPermissions?: string[] | null | undefined;
  companyId?: number | null | undefined;
  now?: Date;
}): Promise<QuotationOwnership> {
  const { role, userId, requestedDealerId, requestedSalesId, callerPermissions, companyId } = params;
  const now = params.now ?? new Date();
  const normRole = (role || "").trim().toLowerCase();

  if (normRole === "dealer") {
    if (requestedDealerId !== undefined && requestedDealerId !== null && requestedDealerId !== userId) {
      throw new ApiError("FORBIDDEN", "Dealers cannot assign a quotation to another dealer.", {
        field: "dealerId",
      });
    }
    const self = (await AdminUser.findById(userId).lean()) as DealerRecord | null;
    if (!self) throw new ApiError("NOT_FOUND", "Dealer record not found.");
    return {
      dealerId: userId,
      dealer: self,
      assignedSalesId: null,
      assignedBy: null,
      assignedOn: null,
      allocatedPercent: Number(self.discountAllocationPercent || 0),
    };
  }

  if (normRole === "sales_executive") {
    if (requestedDealerId !== undefined && requestedDealerId !== null) {
      throw new ApiError("FORBIDDEN", "Sales Executives cannot assign a quotation to a dealer.", {
        field: "dealerId",
      });
    }
    if (requestedSalesId !== undefined && requestedSalesId !== null && requestedSalesId !== userId) {
      throw new ApiError("FORBIDDEN", "Sales Executives cannot assign a quotation to another sales executive.", {
        field: "assignedSalesId",
      });
    }
    return {
      dealerId: null,
      dealer: null,
      assignedSalesId: userId,
      assignedBy: null,
      assignedOn: null,
      allocatedPercent: 0,
    };
  }

  if (!isAdminRole(normRole)) {
    throw new ApiError("FORBIDDEN", "You do not have permission to create quotations.");
  }

  let validatedDealer: DealerRecord | null = null;
  let validatedSalesId: number | null = null;

  if (requestedDealerId !== undefined && requestedDealerId !== null) {
    if (!hasPermission(role, callerPermissions, "quotations:assign_dealer")) {
      throw new ApiError("FORBIDDEN", "You do not have permission to assign dealers.", { field: "dealerId" });
    }
    validatedDealer = await requireActiveDealer(requestedDealerId, companyId);
  }

  if (requestedSalesId !== undefined && requestedSalesId !== null) {
    if (!hasPermission(role, callerPermissions, "quotations:assign_sales")) {
      throw new ApiError("FORBIDDEN", "You do not have permission to assign sales executives.", {
        field: "assignedSalesId",
      });
    }
    const sales = await requireActiveSalesExecutive(requestedSalesId, companyId);
    validatedSalesId = sales._id;
  }

  return {
    dealerId: validatedDealer ? validatedDealer._id : null,
    dealer: validatedDealer,
    assignedSalesId: validatedSalesId,
    assignedBy: validatedDealer || validatedSalesId ? userId : null,
    assignedOn: validatedDealer || validatedSalesId ? now : null,
    allocatedPercent: Number(validatedDealer?.discountAllocationPercent || 0),
  };
}
