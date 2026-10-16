import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";
import { withPermission, withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { getCompanyCustomRoleKeys } from "@/lib/roleService";
import { canAssignRole, isUserManager } from "@/lib/userManagementRules";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { getNextSequence } from "@/lib/counter";
import { createUserSchema } from "@/lib/validation/admin-user";
import { parseSearchQueryParam, parseStringQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users
 * Lists user accounts within authorized company scope.
 * Authorized by `admins:read` or `quotations:assign_sales` (when querying role=sales_executive).
 */
export async function GET(req: Request) {
  try {
    return await withSession(async ({ role, permissions }) => {
      const { searchParams } = new URL(req.url);
      const roleParam = parseStringQueryParam(searchParams, "role", { max: 30 });
      const canReadAdmins = hasPermission(role, permissions, "admins:read");
      const canReadSalesForAssignment =
        roleParam === "sales_executive" && hasPermission(role, permissions, "quotations:assign_sales");

      if (!canReadAdmins && !canReadSalesForAssignment) {
        throw new ApiError("FORBIDDEN", "You do not have permission to view user accounts.");
      }

      await connectMongoDB();

      const pagination = parsePaginationParams(searchParams, { defaultPageSize: 20, maxPageSize: 100 });
      const search = parseSearchQueryParam(searchParams, "search", { max: 100 });
      const status = parseStringQueryParam(searchParams, "status", { max: 20 });

      const filter: Record<string, unknown> = {};

      if (roleParam && roleParam !== "all") {
        filter.role = roleParam;
      } else if (!canReadAdmins && canReadSalesForAssignment) {
        filter.role = "sales_executive";
      }

    if (status && status !== "all") {
      if (status === "active") filter.isActive = true;
      if (status === "inactive") filter.isActive = false;
    }

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { name: { $regex: searchRegex } },
        { email: { $regex: searchRegex } },
        { firstName: { $regex: searchRegex } },
        { lastName: { $regex: searchRegex } },
      ];
    }

    const [total, users] = await Promise.all([
      AdminUser.countDocuments(filter),
      AdminUser.find(filter)
        .select("-passwordHash")
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.take)
        .lean(),
    ]);

    return NextResponse.json(createPaginatedResponse(users, total, pagination));
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/users" });
  }
}

/**
 * POST /api/admin/users
 * Creates a new administrative user.
 *
 * Who: a Company Owner (own company only) or a Super Admin acting as a
 * company. Not the `admins:manage` permission — that is Super Admin-exclusive
 * platform administration a Company Owner never holds; this is a
 * company-level capability, enforced here by role. The new account's company
 * is ALWAYS the session's company context (stamped by the tenant-scope
 * plugin); a client-supplied `companyId` is rejected by the strict schema.
 * Which roles may be assigned is decided by `canAssignRole`
 * (`src/lib/userManagementRules.ts`): a Company Owner can assign only
 * admin / configurable_admin / its own custom roles; a Super Admin with no
 * company selected can only create another super_admin.
 */
export async function POST(req: Request) {
  try {
    return await withSession(async ({ role: callerRole, companyId }) => {
    if (!isUserManager(callerRole)) {
      throw new ApiError("FORBIDDEN", "Only a Company Owner or Super Admin may create accounts.");
    }

    await connectMongoDB();
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return handleApiError(parsed.error, { logPrefix: "POST /api/admin/users" });
    }

    const {
      firstName,
      lastName,
      email,
      password,
      permissions,
      contactNumber,
      address,
      discountAllocationPercent,
    } = parsed.data;
    const role = parsed.data.role.toLowerCase();

    if (role === "dealer") {
      throw new ApiError("VALIDATION_ERROR", "Use dealer registration/management to manage dealer accounts.");
    }

    const actor = { role: callerRole, hasCompanyContext: companyId !== null };
    if (callerRole === "super_admin" && !actor.hasCompanyContext && role !== "super_admin") {
      throw new ApiError("FORBIDDEN", "Select a company first: accounts for a company can only be created while acting as that company.");
    }
    if (!canAssignRole(actor, role, callerRole === "company_owner" ? await getCompanyCustomRoleKeys() : [])) {
      throw new ApiError("FORBIDDEN", "You are not allowed to assign this role.", { field: "role" });
    }

    const exists = await AdminUser.exists({ email: email.toLowerCase() });
    if (exists) {
      throw new ApiError("DUPLICATE_RECORD", "An account with this email already exists.", { field: "email" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = await getNextSequence("adminUser", AdminUser);
    const name = `${firstName} ${lastName}`.trim();

    const newUser = new AdminUser({
      _id: id,
      name,
      firstName,
      lastName,
      email: email.toLowerCase(),
      passwordHash,
      role,
      permissions: role === "configurable_admin" ? (permissions ?? []) : [],
      contactNumber: contactNumber ?? null,
      address: address ?? null,
      discountAllocationPercent: discountAllocationPercent ?? 0,
      isActive: true,
    });

    await newUser.save();

    const userObj: Record<string, unknown> = { ...newUser.toObject() };
    delete userObj.passwordHash;

    return apiSuccess(userObj, { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/users" });
  }
}
