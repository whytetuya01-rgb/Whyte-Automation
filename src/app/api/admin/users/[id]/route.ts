import bcrypt from "bcryptjs";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";
import { withPermission, withSession } from "@/lib/api-auth";
import { getCompanyCustomRoleKeys } from "@/lib/roleService";
import { canAssignRole, canModifyAccountWithRole, isUserManager } from "@/lib/userManagementRules";
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
    return await withPermission("admins:read", async () => {
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
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/users/[id]" });
  }
}

/**
 * PATCH /api/admin/users/[id]
 * Updates an administrative user's details, role, permissions, or active state.
 *
 * Security Constraints:
 * 1. Who: a Company Owner (own company only) or a Super Admin acting as a
 *    company — by role, not the Super Admin-exclusive `admins:manage`
 *    permission. The target is looked up through the tenant-scope plugin, so
 *    an account in another company (or a platform account) simply does not
 *    exist here (404); no client-supplied `companyId` is ever read.
 * 2. A Company Owner cannot modify `company_owner` or `super_admin` accounts
 *    and can only assign roles `canAssignRole` allows (never super_admin).
 * 3. Protects the last active Super Admin from accidental deactivation or demotion.
 * 4. Immediately invalidates the cached session actor upon update.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role: callerRole, companyId }) => {
    if (!isUserManager(callerRole)) {
      throw new ApiError("FORBIDDEN", "Only a Company Owner or Super Admin may modify accounts.");
    }
    if (companyId === null) {
      throw new ApiError("FORBIDDEN", "Select a company first: accounts can only be modified while acting as their company.");
    }
    const actor = { role: callerRole, hasCompanyContext: true };

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

    if (!canModifyAccountWithRole(actor, existingUser.role)) {
      throw new ApiError("FORBIDDEN", "You are not allowed to modify this account.");
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
      const requestedRole = newRole.toLowerCase();
      if (requestedRole === "dealer") {
        throw new ApiError("VALIDATION_ERROR", "Cannot reassign an administrative account to dealer role.");
      }
      if (requestedRole !== existingUser.role) {
        const customKeys = callerRole === "company_owner" ? await getCompanyCustomRoleKeys() : [];
        if (!canAssignRole(actor, requestedRole, customKeys)) {
          throw new ApiError("FORBIDDEN", "You are not allowed to assign this role.", { field: "role" });
        }
        existingUser.role = requestedRole;
      }
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

    const result: Record<string, unknown> = { ...existingUser.toObject() };
    delete result.passwordHash;

    return apiSuccess(result);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/admin/users/[id]" });
  }
}
