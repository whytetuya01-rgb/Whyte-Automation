import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company, Quotation } from "@/models";
import { withPermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam } from "@/lib/validation/common";
import { emailSchema, mobileSchema, optionalEmailSchema, optionalGstinSchema } from "@/lib/validation/fields";
import { getNextSequence } from "@/lib/counter";
import { runUnscoped } from "@/lib/tenant/context";
import { DEFAULT_COMPANY_SLUG } from "@/lib/tenant/constants";

export const dynamic = "force-dynamic";

const createDealerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(60, "First name must be 60 characters or fewer.")
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "First name contains invalid characters."),
  lastName: z.string().trim().min(1, "Last name is required.").max(60, "Last name must be 60 characters or fewer.")
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Last name contains invalid characters."),
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters.")
    .refine((v) => new TextEncoder().encode(v).length <= 72, "Password must be 72 bytes or fewer."),
  contactNumber: mobileSchema,
  companyName: z
    .union([z.string().trim().max(120), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === "" ? null : v ?? null)),
  businessEmail: optionalEmailSchema,
  gstNumber: optionalGstinSchema,
  address: z
    .union([z.string().trim().max(500), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === "" ? null : v ?? null)),
  discountAllocationPercent: z.number().min(0, "Discount cannot be negative.").max(100, "Discount cannot exceed 100%.").optional().default(0),
  companyId: z.number().int().positive().optional(),
}).strict();

/**
 * GET /api/admin/dealers
 * Lists dealers with quotation statistics and accumulated earnings.
 * Super Admin, Admin, and Configurable Admins with dealers:read permission.
 */
export async function GET(req: Request) {
  try {
    return await withPermission("dealers:read", async () => {
      await connectMongoDB();

      const { searchParams } = new URL(req.url);
      const pagination = parsePaginationParams(searchParams, { defaultPageSize: 10, maxPageSize: 100 });
      const search = parseSearchQueryParam(searchParams, "search", { max: 100 });
      const status = parseStringQueryParam(searchParams, "status", { max: 20 });

      const filter: Record<string, unknown> = { role: "dealer" };

      if (status && status !== "all") {
        if (status === "active") filter.isActive = true;
        if (status === "inactive") filter.isActive = false;
      }

      if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { name: { $regex: searchRegex } },
          { email: { $regex: searchRegex } },
          { contactNumber: { $regex: searchRegex } },
          { gstNumber: { $regex: searchRegex } },
        ];
      }

      const [total, dealers] = await Promise.all([
        AdminUser.countDocuments(filter),
        AdminUser.find(filter)
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.take)
          .lean(),
      ]);

      const dealerIds = dealers.map((d: any) => d._id);

      // Aggregate quotation counts and accumulated earnings per dealer
      const statsAggregation = await Quotation.aggregate([
        { $match: { dealerId: { $in: dealerIds } } },
        {
          $group: {
            _id: "$dealerId",
            total: { $sum: 1 },
            draft: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
            sent: { $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
            approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
            accumulatedEarnings: {
              $sum: {
                $cond: [
                  { $in: ["$status", ["approved", "delivered"]] },
                  { $toDouble: "$estimatedEarningAmount" },
                  0,
                ],
              },
            },
          },
        },
      ]);

      const statsMap = new Map<number, any>();
      for (const stat of statsAggregation) {
        statsMap.set(stat._id, stat);
      }

      // Resolve company names for multi-tenant display
      const distinctCompanyIds = Array.from(new Set(dealers.map((d: any) => d.companyId).filter(Boolean)));
      const companies = distinctCompanyIds.length > 0
        ? await Company.find({ _id: { $in: distinctCompanyIds } }).select("name slug").lean()
        : [];
      const companyMap = new Map(companies.map((c: any) => [c._id, c.name]));

      const enrichedDealers = dealers.map((d: any) => {
        const stats = statsMap.get(d._id) ?? {
          total: 0,
          draft: 0,
          sent: 0,
          approved: 0,
          rejected: 0,
          delivered: 0,
          accumulatedEarnings: 0,
        };

        const { passwordHash, ...rest } = d;
        return {
          ...rest,
          id: d._id,
          assignedCompanyName: companyMap.get(d.companyId) ?? null,
          quotationStats: {
            total: stats.total,
            draft: stats.draft,
            sent: stats.sent,
            approved: stats.approved,
            rejected: stats.rejected,
            delivered: stats.delivered,
          },
          accumulatedEarnings: Math.round(Number(stats.accumulatedEarnings || 0) * 100) / 100,
        };
      });

      return NextResponse.json(
        createPaginatedResponse(enrichedDealers, total, {
          page: pagination.page,
          pageSize: pagination.pageSize,
        })
      );
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/dealers" });
  }
}

/**
 * POST /api/admin/dealers
 * Creates a new dealer account directly from the admin panel.
 * Protected by dealers:manage permission.
 */
export async function POST(req: Request) {
  try {
    return await withPermission("dealers:manage", async ({ userId, session, companyId, role }) => {
      const parsed = createDealerSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        return handleApiError(parsed.error, { logPrefix: "POST /api/admin/dealers" });
      }

      await connectMongoDB();

      const {
        firstName,
        lastName,
        email,
        password,
        contactNumber,
        companyName,
        businessEmail,
        gstNumber,
        address,
        discountAllocationPercent,
        companyId: requestedCompanyId,
      } = parsed.data;

      const normalizedEmail = email.trim().toLowerCase();

      // Email uniqueness is global across all companies
      const existing = await runUnscoped("auth-lookup", () =>
        AdminUser.findOne({ email: normalizedEmail }).select("_id").lean()
      );

      if (existing) {
        throw new ApiError("DUPLICATE_RECORD", "An account with this email already exists.", {
          field: "email",
        });
      }

      // Determine target companyId:
      // 1. Super Admin can assign explicitly via requestedCompanyId or fallback to act-as companyId
      // 2. Regular Company Admin is always bound to their own companyId
      let targetCompanyId = role === "super_admin" && requestedCompanyId ? requestedCompanyId : companyId;
      if (!targetCompanyId) {
        const defaultCompany = await Company.findOne({ slug: DEFAULT_COMPANY_SLUG }).select("_id").lean();
        targetCompanyId = defaultCompany?._id ?? 1;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const newId = await getNextSequence("adminUser", AdminUser);
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      const discountHistory =
        discountAllocationPercent && discountAllocationPercent > 0
          ? [
              {
                allocatedPercent: discountAllocationPercent,
                previousPercent: 0,
                changedBy: userId,
                changedByName: session.user?.name ?? session.user?.email ?? "Administrator",
                changedAt: new Date(),
              },
            ]
          : [];

      const dealerDoc = new AdminUser({
        _id: newId,
        companyId: targetCompanyId,
        name: fullName,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizedEmail,
        passwordHash,
        contactNumber: contactNumber.trim(),
        companyName: companyName ?? null,
        businessEmail: businessEmail ?? null,
        gstNumber: gstNumber ?? null,
        address: address ?? null,
        role: "dealer",
        isActive: true,
        discountAllocationPercent: discountAllocationPercent ?? 0,
        discountAllocationHistory: discountHistory,
      });

      await dealerDoc.save();

      const { passwordHash: _pwd, ...savedData } = dealerDoc.toObject();

      return apiSuccess({
        ...savedData,
        id: newId,
        quotationStats: {
          total: 0,
          draft: 0,
          sent: 0,
          approved: 0,
          rejected: 0,
          delivered: 0,
        },
        accumulatedEarnings: 0,
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/dealers" });
  }
}
