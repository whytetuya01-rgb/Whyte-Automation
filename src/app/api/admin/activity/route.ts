import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Quotation, QuotationAuditEvent, QUOTATION_AUDIT_ACTIONS } from "@/models";
import { requireRole } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/activity
 *
 * Super-admin-only, system-wide feed over the existing append-only
 * `QuotationAuditEvent` log — every quotation create/assign/reassign/
 * approve/reject/deliver/status-change, by every dealer and admin, across
 * every quotation. Nothing new is written here; this only reads the audit
 * trail that quotation operations already record.
 *
 * Query params:
 *   page, pageSize        - standard pagination
 *   search                - matches actor name/email or quotation number/client
 *   action                - one QUOTATION_AUDIT_ACTIONS value, or omitted for all
 *   actorId                - numeric AdminUser id, restrict to one person
 *   actorRole              - "super_admin" | "admin" | "dealer"
 *   startDate, endDate     - ISO date strings (inclusive), filters performedOn
 */
export async function GET(req: Request) {
  try {
    await requireRole("super_admin");

    const { searchParams } = new URL(req.url);
    const { skip, take, page, pageSize } = parsePaginationParams(searchParams, {
      defaultPageSize: 25,
      maxPageSize: 100,
    });
    const search = parseSearchQueryParam(searchParams, "search", { max: 100 });
    const actionParam = parseStringQueryParam(searchParams, "action", {
      max: 40,
      allowed: QUOTATION_AUDIT_ACTIONS,
    });
    const actorRoleParam = parseStringQueryParam(searchParams, "actorRole", {
      max: 20,
      allowed: ["super_admin", "admin", "dealer"],
    });
    const actorIdParam = parseStringQueryParam(searchParams, "actorId", { max: 20 });
    const startDateParam = parseStringQueryParam(searchParams, "startDate", { max: 30 });
    const endDateParam = parseStringQueryParam(searchParams, "endDate", { max: 30 });

    await connectMongoDB();

    const filter: Record<string, unknown> = {};

    if (actionParam) {
      filter.action = actionParam;
    }

    if (startDateParam || endDateParam) {
      const performedOn: Record<string, Date> = {};
      if (startDateParam) {
        const start = new Date(startDateParam);
        if (!Number.isNaN(start.getTime())) performedOn.$gte = start;
      }
      if (endDateParam) {
        const end = new Date(endDateParam);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          performedOn.$lte = end;
        }
      }
      if (Object.keys(performedOn).length > 0) filter.performedOn = performedOn;
    }

    let actorIdsFilter: number[] | null = null;
    if (actorIdParam) {
      const id = Number(actorIdParam);
      if (Number.isFinite(id)) actorIdsFilter = [id];
    } else if (actorRoleParam) {
      const usersWithRole = await AdminUser.find({ role: actorRoleParam as "super_admin" | "admin" | "dealer" })
        .select("_id")
        .lean();
      actorIdsFilter = usersWithRole.map((u) => u._id);
    }

    let quotationIdsFromSearch: string[] | null = null;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");

      const [matchingUsers, matchingQuotations] = await Promise.all([
        AdminUser.find({ $or: [{ name: regex }, { email: regex }, { firstName: regex }, { lastName: regex }] })
          .select("_id")
          .lean(),
        Quotation.find({ $or: [{ quotationNumber: regex }, { clientName: regex }] })
          .select("_id")
          .lean(),
      ]);

      const searchUserIds = matchingUsers.map((u) => u._id);
      quotationIdsFromSearch = matchingQuotations.map((q) => q._id);

      const orClauses: Record<string, unknown>[] = [
        { performedByName: regex },
        { quotationId: { $in: quotationIdsFromSearch } },
      ];
      if (searchUserIds.length > 0) orClauses.push({ performedBy: { $in: searchUserIds } });
      filter.$or = orClauses;

      // A role filter and a text search both narrowing "performedBy" must be
      // combined with AND, not silently overridden by the $or above.
      if (actorIdsFilter) {
        filter.$and = [{ performedBy: { $in: actorIdsFilter } }, { $or: orClauses }];
        delete filter.$or;
      }
    } else if (actorIdsFilter) {
      filter.performedBy = { $in: actorIdsFilter };
    }

    const [events, total] = await Promise.all([
      QuotationAuditEvent.find(filter)
        .sort({ performedOn: -1, _id: -1 })
        .skip(skip)
        .limit(take)
        .lean(),
      QuotationAuditEvent.countDocuments(filter),
    ]);

    // Batch-resolve actor role (live, not a snapshot) and quotation context.
    const actorIds = [...new Set(events.map((e) => e.performedBy))];
    const quotationIds = [...new Set(events.map((e) => e.quotationId))];
    const [actors, quotations] = await Promise.all([
      actorIds.length > 0
        ? AdminUser.find({ _id: { $in: actorIds } }).select("_id name firstName lastName email role").lean()
        : [],
      quotationIds.length > 0
        ? Quotation.find({ _id: { $in: quotationIds } }).select("_id quotationNumber clientName status").lean()
        : [],
    ]);
    const actorById = new Map(actors.map((a) => [a._id, a]));
    const quotationById = new Map(quotations.map((q) => [q._id, q]));

    const data = events.map((event) => {
      const actor = actorById.get(event.performedBy);
      const quotation = quotationById.get(event.quotationId);
      return {
        id: event._id,
        action: event.action,
        performedBy: event.performedBy,
        performedByName: event.performedByName ?? actor?.name ?? null,
        performedByRole: actor?.role ?? null,
        performedOn: event.performedOn.toISOString(),
        previousValue: event.previousValue ?? null,
        newValue: event.newValue ?? null,
        metadata: event.metadata ?? null,
        quotation: quotation
          ? {
              id: quotation._id,
              quotationNumber: quotation.quotationNumber,
              clientName: quotation.clientName,
              status: quotation.status,
            }
          : null,
      };
    });

    // Lightweight actor directory for the filter dropdown — everyone who can
    // ever appear as `performedBy` on a quotation (super admin, admin, dealer).
    const actorDirectory = await AdminUser.find({ role: { $in: ["super_admin", "admin", "dealer"] } })
      .select("_id name firstName lastName email role isActive")
      .sort({ name: 1 })
      .lean();

    return apiSuccess({
      ...createPaginatedResponse(data, total, { page, pageSize }),
      actors: actorDirectory.map((u) => ({
        id: u._id,
        name: u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
        role: u.role,
        isActive: u.isActive,
      })),
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/activity" });
  }
}
