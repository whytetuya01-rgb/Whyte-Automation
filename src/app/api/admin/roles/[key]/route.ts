import { withPermission, withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { saveRolePermissions, deleteCustomRole, getAllRolesMetadata } from "@/lib/roleService";
import { z } from "zod";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

const patchRoleSchema = z.object({
  permissions: z.array(z.string()),
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(500).optional(),
  badge: z.string().trim().max(30).optional(),
});

/**
 * GET /api/admin/roles/[key]
 * Retrieves metadata and current permission configuration for a specific role.
 * Strictly restricted to Super Admin.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, companyId }) => {
      if (role !== "super_admin") {
        throw new ApiError("FORBIDDEN", "Only Super Admin may access role definitions.");
      }

      const resolvedParams = context?.params ? await Promise.resolve(context.params) : null;
      const rawKey = resolvedParams?.key;
      if (!rawKey) {
        throw new ApiError("VALIDATION_ERROR", "Role key parameter is required.");
      }
      const normalizedKey = decodeURIComponent(rawKey).trim().toLowerCase();

      const allRoles = await getAllRolesMetadata(companyId);
      const roleItem = allRoles.find((r) => r.key === normalizedKey);

      if (!roleItem) {
        throw new ApiError("NOT_FOUND", `Role '${rawKey}' not found.`);
      }

      return apiSuccess(roleItem);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/roles/[key]" });
  }
}

/**
 * PATCH /api/admin/roles/[key]
 * Updates permission configuration and metadata for an existing role (admin, dealer, or custom role).
 * Restricted to a Super Admin acting as the company.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    // Role definitions are platform-managed: Super Admin only, acting as a
    // company (owners and admins get 403).
    return await withSession(async ({ role: callerRole, companyId }) => {
      if (callerRole !== "super_admin") {
        throw new ApiError("FORBIDDEN", "Only Super Admin may customize role permissions.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "A company context is required to customize role permissions.");
      }

      const resolvedParams = context?.params ? await Promise.resolve(context.params) : null;
      const rawKey = resolvedParams?.key;
      if (!rawKey) {
        throw new ApiError("VALIDATION_ERROR", "Role key parameter is required.");
      }
      const normalizedKey = decodeURIComponent(rawKey).trim().toLowerCase();

      if (normalizedKey === "super_admin") {
        throw new ApiError("FORBIDDEN", "Super Administrator permissions are immutable and cannot be modified.");
      }

      if (normalizedKey === "company_owner") {
        throw new ApiError("FORBIDDEN", "Company Owner permissions are immutable and cannot be modified.");
      }

      if (normalizedKey === "configurable_admin") {
        throw new ApiError(
          "VALIDATION_ERROR",
          "Configurable Administrator permissions are assigned on individual user profiles under User Management."
        );
      }

      const body = await req.json();
      const parsed = patchRoleSchema.safeParse(body);
      if (!parsed.success) {
        return handleApiError(parsed.error, { logPrefix: "PATCH /api/admin/roles/[key]" });
      }

      const { permissions, name, description, badge } = parsed.data;

      const updated = await saveRolePermissions(normalizedKey, permissions, companyId, {
        name,
        description,
        badge,
      });

      if (!updated) {
        throw new ApiError("NOT_FOUND", `Role '${rawKey}' could not be updated.`);
      }

      return apiSuccess(updated);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/admin/roles/[key]" });
  }
}

/**
 * DELETE /api/admin/roles/[key]
 * Deletes a custom role if no users are currently assigned to it.
 * Restricted to a Super Admin acting as the company.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role: callerRole, companyId }) => {
      if (callerRole !== "super_admin") {
        throw new ApiError("FORBIDDEN", "Only Super Admin may delete custom roles.");
      }
      if (!companyId) {
        throw new ApiError("FORBIDDEN", "A company context is required to delete a custom role.");
      }

      const resolvedParams = context?.params ? await Promise.resolve(context.params) : null;
      const rawKey = resolvedParams?.key;
      if (!rawKey) {
        throw new ApiError("VALIDATION_ERROR", "Role key parameter is required.");
      }
      const normalizedKey = decodeURIComponent(rawKey).trim().toLowerCase();

      await deleteCustomRole(normalizedKey, companyId);

      return apiSuccess({ deleted: true, key: normalizedKey });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/admin/roles/[key]" });
  }
}
