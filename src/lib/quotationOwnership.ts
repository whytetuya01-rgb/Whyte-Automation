import { AdminUser } from "@/models";
import { ApiError } from "@/lib/api-response";
import { isAdminRole, type QuotationActorRole } from "@/lib/quotationAccess";

export interface DealerRecord {
  _id: number;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  discountAllocationPercent?: number | null;
}

/** Looks up an active dealer; throws a controlled error when it is not one. */
export async function requireActiveDealer(dealerId: number): Promise<DealerRecord> {
  const dealer = (await AdminUser.findOne({ _id: dealerId, role: "dealer" }).lean()) as
    | (DealerRecord & { isActive?: boolean })
    | null;
  if (!dealer) {
    throw new ApiError("NOT_FOUND", "Dealer not found.", { field: "dealerId" });
  }
  if (dealer.isActive === false) {
    throw new ApiError("VALIDATION_ERROR", "Quotations cannot be assigned to an inactive dealer.", {
      field: "dealerId",
    });
  }
  return dealer;
}

export interface QuotationOwnership {
  /** Dealer the quotation belongs to ("assignedTo"); null = not assigned. */
  dealerId: number | null;
  dealer: DealerRecord | null;
  /** Set only when an admin performed an assignment. */
  assignedBy: number | null;
  assignedOn: Date | null;
  allocatedPercent: number;
}

/**
 * Derives the ownership/assignment fields for a NEW quotation (create or clone)
 * from the authenticated actor. Nothing here is read from the client except the
 * optional requested dealer id, which is validated against the actor's role.
 *
 *  - dealer: always owns it themselves. Naming any other dealer is forbidden.
 *    `assignedBy`/`assignedOn` stay null: the dealer did not "assign" anything,
 *    they simply created it.
 *  - super_admin / admin: either no dealer (kept by the admin) or an assignment to
 *    a validated dealer, stamped with the admin and the server clock.
 */
export async function resolveNewQuotationOwnership(params: {
  role: QuotationActorRole;
  userId: number;
  requestedDealerId: number | null | undefined;
  now?: Date;
}): Promise<QuotationOwnership> {
  const { role, userId, requestedDealerId } = params;
  const now = params.now ?? new Date();

  if (role === "dealer") {
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
      assignedBy: null,
      assignedOn: null,
      allocatedPercent: Number(self.discountAllocationPercent || 0),
    };
  }

  if (!isAdminRole(role)) {
    throw new ApiError("FORBIDDEN", "You do not have permission to create quotations.");
  }

  if (requestedDealerId === undefined || requestedDealerId === null) {
    return { dealerId: null, dealer: null, assignedBy: null, assignedOn: null, allocatedPercent: 0 };
  }

  const dealer = await requireActiveDealer(requestedDealerId);
  return {
    dealerId: dealer._id,
    dealer,
    assignedBy: userId,
    assignedOn: now,
    allocatedPercent: Number(dealer.discountAllocationPercent || 0),
  };
}
