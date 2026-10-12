import { requirePermission } from "@/lib/api-auth";
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
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    await requirePermission("admins:read");
    const resolvedParams = context?.params ? await Promise.resolve(context.params) : null;
    const rawKey = resolvedParams?.key;
    if (!rawKey) {
      throw new ApiError("VALIDATION_ERROR", "Role key parameter is required.");
    }
    const normalizedKey = decodeURIComponent(rawKey).trim().toLowerCase();

    const allRoles = await getAllRolesMetadata();
    const role = allRoles.find((r) => r.key === normalizedKey);

    if (!role) {
      throw new ApiError("NOT_FOUND", `Role '${rawKey}' not found.`);
    }

    return apiSuccess(role);
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/roles/[key]" });
  }
}

/**
 * PATCH /api/admin/roles/[key]
 * Updates permission configuration and metadata for an existing role (admin, dealer, or custom role).
 * Guarded by `admins:manage` and strictly restricted to Super Admin.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await requirePermission("admins:manage");
    const callerRole = (session.user as { role?: string }).role?.trim().toLowerCase();

    if (callerRole !== "super_admin") {
      throw new ApiError("FORBIDDEN", "Only Super Admins may customize role permissions.");
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

    const updated = await saveRolePermissions(normalizedKey, permissions, {
      name,
      description,
      badge,
    });

    if (!updated) {
      throw new ApiError("NOT_FOUND", `Role '${rawKey}' could not be updated.`);
    }

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/admin/roles/[key]" });
  }
}

/**
 * DELETE /api/admin/roles/[key]
 * Deletes a custom role if no users are currently assigned to it.
 * Guarded by `admins:manage` and strictly restricted to Super Admin.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await requirePermission("admins:manage");
    const callerRole = (session.user as { role?: string }).role?.trim().toLowerCase();

    if (callerRole !== "super_admin") {
      throw new ApiError("FORBIDDEN", "Only Super Admins may delete custom roles.");
    }

    const resolvedParams = context?.params ? await Promise.resolve(context.params) : null;
    const rawKey = resolvedParams?.key;
    if (!rawKey) {
      throw new ApiError("VALIDATION_ERROR", "Role key parameter is required.");
    }
    const normalizedKey = decodeURIComponent(rawKey).trim().toLowerCase();

    await deleteCustomRole(normalizedKey);

    return apiSuccess({ deleted: true, key: normalizedKey });
  } catch (error) {
    return handleApiError(error, { logPrefix: "DELETE /api/admin/roles/[key]" });
  }
}
