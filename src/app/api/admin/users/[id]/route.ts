import bcrypt from "bcryptjs";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";
import { requirePermission } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, parseNumericId } from "@/lib/api-response";
import { updateUserSchema } from "@/lib/validation/admin-user";
import { invalidateSessionActor } from "@/lib/sessionGuard";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/users/[id]
 * Retrieves an administrative user's profile and permissions.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    await requirePermission("admins:read");
    const { id: rawId } = await context.params;
    const userId = parseNumericId(rawId);

    await connectMongoDB();
    const user = await AdminUser.findOne({
      _id: userId,
      role: { $ne: "dealer" },
    })
      .select("-passwordHash")
      .lean();

    if (!user) {
      throw new ApiError("NOT_FOUND", "Administrative user not found.");
    }

    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/users/[id]" });
  }
}

/**
 * PATCH /api/admin/users/[id]
 * Updates an administrative user's details, role, permissions, or active state.
 *
 * Security Constraints:
 * 1. Only Super Admins may modify administrative users or assign permissions.
 * 2. Protects the last active Super Admin from accidental deactivation or demotion.
 * 3. Immediately invalidates the cached session actor upon update.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await requirePermission("admins:manage");
    const callerRole = (session.user as { role?: string }).role;

    if (callerRole !== "super_admin") {
      throw new ApiError("FORBIDDEN", "Only Super Admins may modify administrative accounts or assign permissions.");
    }

    const { id: rawId } = await context.params;
    const targetUserId = parseNumericId(rawId);

    await connectMongoDB();
    const existingUser = await AdminUser.findOne({
      _id: targetUserId,
      role: { $ne: "dealer" },
    });

    if (!existingUser) {
      throw new ApiError("NOT_FOUND", "Administrative user not found.");
    }

    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return handleApiError(parsed.error, { logPrefix: "PATCH /api/admin/users/[id]" });
    }

    const {
      firstName,
      lastName,
      role: newRole,
      isActive,
      contactNumber,
      address,
      password,
      discountAllocationPercent,
      permissions,
    } = parsed.data;

    // Last Super Admin Protection
    const isCurrentlyActiveSuperAdmin = existingUser.role === "super_admin" && existingUser.isActive;
    const isBeingDeactivated = isActive === false;
    const isBeingDemoted = newRole !== undefined && newRole !== "super_admin";

    if (isCurrentlyActiveSuperAdmin && (isBeingDeactivated || isBeingDemoted)) {
      const otherActiveSuperAdmins = await AdminUser.countDocuments({
        role: "super_admin",
        isActive: true,
        _id: { $ne: targetUserId },
      });

      if (otherActiveSuperAdmins === 0) {
        throw new ApiError(
          "FORBIDDEN",
          "Cannot deactivate or demote the last remaining active Super Admin."
        );
      }
    }

    // Apply updates
    if (firstName !== undefined) existingUser.firstName = firstName;
    if (lastName !== undefined) existingUser.lastName = lastName;
    if (firstName !== undefined || lastName !== undefined) {
      existingUser.name = `${existingUser.firstName ?? ""} ${existingUser.lastName ?? ""}`.trim();
    }

    if (newRole !== undefined) {
      if (newRole === "dealer") {
        throw new ApiError("VALIDATION_ERROR", "Cannot reassign an administrative account to dealer role.");
      }
      existingUser.role = newRole;
    }

    if (isActive !== undefined) {
      existingUser.isActive = isActive;
    }

    if (contactNumber !== undefined) existingUser.contactNumber = contactNumber;
    if (address !== undefined) existingUser.address = address;

    if (discountAllocationPercent !== undefined) {
      existingUser.discountAllocationPercent = discountAllocationPercent;
    }

    if (password) {
      existingUser.passwordHash = await bcrypt.hash(password, 12);
    }

    // Permissions assignment (strictly for configurable_admin; cleared if promoted to admin/super_admin)
    if (existingUser.role === "configurable_admin") {
      if (permissions !== undefined) {
        existingUser.permissions = permissions;
      }
    } else {
      existingUser.permissions = [];
    }

    await existingUser.save();

    // Immediately bust in-memory actor session cache
    invalidateSessionActor(targetUserId);

    const result = existingUser.toObject();
    delete (result as any).passwordHash;

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/admin/users/[id]" });
  }
}
