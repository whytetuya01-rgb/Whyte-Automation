import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";
import { requirePermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { getNextSequence } from "@/lib/counter";
import { createUserSchema } from "@/lib/validation/admin-user";
import { parseSearchQueryParam, parseStringQueryParam } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users
 * Lists every user account in the system — Super Admin, Admin, Dealer,
 * Configurable Admin, and any custom role — for the unified admin Users
 * screen. Dealers are the same `AdminUser` collection (`role: "dealer"`),
 * just normally managed through their own richer `/api/admin/dealers`
 * endpoints (quotation stats, earnings); this listing intentionally
 * includes them so the Users screen can show every account in one place.
 * Guarded by `admins:read` (Super Admin or Admins with permission).
 */
export async function GET(req: Request) {
  try {
    await requirePermission("admins:read");
    await connectMongoDB();

    const { searchParams } = new URL(req.url);
    const pagination = parsePaginationParams(searchParams, { defaultPageSize: 20, maxPageSize: 100 });
    const search = parseSearchQueryParam(searchParams, "search", { max: 100 });
    const roleParam = parseStringQueryParam(searchParams, "role", { max: 30 });
    const status = parseStringQueryParam(searchParams, "status", { max: 20 });

    const filter: Record<string, unknown> = {};

    if (roleParam && roleParam !== "all") {
      filter.role = roleParam;
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
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/users" });
  }
}

/**
 * POST /api/admin/users
 * Creates a new administrative user (admin or configurable_admin).
 * Strictly restricted to Super Admin accounts via `admins:manage`.
 */
export async function POST(req: Request) {
  try {
    const session = await requirePermission("admins:manage");
    const callerRole = (session.user as { role?: string }).role;

    if (callerRole !== "super_admin") {
      throw new ApiError("FORBIDDEN", "Only Super Admins may create administrative accounts.");
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
      role,
      permissions,
      contactNumber,
      address,
      discountAllocationPercent,
    } = parsed.data;

    // Only super_admin may create another super_admin
    if (role === "dealer") {
      throw new ApiError("VALIDATION_ERROR", "Use dealer registration/management to manage dealer accounts.");
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

    const userObj = newUser.toObject();
    delete (userObj as any).passwordHash;

    return apiSuccess(userObj, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/users" });
  }
}
