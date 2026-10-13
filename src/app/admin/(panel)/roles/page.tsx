"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Shield,
  ShieldCheck,
  Users,
  Lock,
  Check,
  RefreshCw,
  Plus,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Eye,
  Sparkles,
  KeyRound,
  RotateCcw,
  Trash2,
  SlidersHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import PageHeader from "@/components/admin/PageHeader";
import Modal from "@/components/shared/Modal";
import { Button, Input, Badge } from "@/components/ui";
import { Switch } from "@/components/ui/Switch";
import {
  Permission,
  PermissionModuleGroup,
  PERMISSION_METADATA,
  PERMISSION_MODULE_GROUPS,
  PERMISSION_PRESETS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
  ADMIN_DEFAULT_PERMISSIONS,
} from "@/lib/permissions";

interface RoleMetadata {
  key: string;
  name: string;
  badge: string;
  type: "system_protected" | "system_customizable" | "configurable" | "custom";
  description: string;
  isEditable: boolean;
  isDeletable: boolean;
  isCustomized: boolean;
  permissionCount: number | string;
  permissions: Permission[];
  defaultPermissions?: Permission[];
  userCount: number;
  activeUserCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export default function RoleManagementPage() {
  const { data: session, status: sessionStatus } = useSession();
  const sessionUser = session?.user as { role?: string; permissions?: string[] } | undefined;
  const currentRole = sessionUser?.role?.trim().toLowerCase();
  const isSuperAdmin =
    currentRole === "super_admin" ||
    (Array.isArray(sessionUser?.permissions) && sessionUser.permissions.includes("admins:manage"));
  const canManageAdmins = isSuperAdmin;
  const canReadAdmins =
    isSuperAdmin ||
    currentRole === "admin" ||
    (Array.isArray(sessionUser?.permissions) && sessionUser.permissions.includes("admins:read"));

  const router = useRouter();

  // Overview and Data States
  const [roles, setRoles] = useState<RoleMetadata[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Configure Role Permissions Modal (for admin, dealer, or custom roles)
  const [configuringRole, setConfiguringRole] = useState<RoleMetadata | null>(null);
  const [roleSelectedPermissions, setRoleSelectedPermissions] = useState<Set<Permission>>(new Set());
  const [savingRolePermissions, setSavingRolePermissions] = useState(false);
  const [resettingRole, setResettingRole] = useState(false);

  // Inspect Protected Role Modal (Read-only for super_admin)
  const [inspectingRole, setInspectingRole] = useState<RoleMetadata | null>(null);

  // Create Custom Role Modal
  const [isCreateRoleModalOpen, setIsCreateRoleModalOpen] = useState(false);
  const [createRoleForm, setCreateRoleForm] = useState({
    key: "",
    name: "",
    description: "",
    badge: "",
  });
  const [createRolePermissions, setCreateRolePermissions] = useState<Set<Permission>>(new Set());
  const [creatingRole, setCreatingRole] = useState(false);

  // Load Roles Metadata
  const fetchRoles = useCallback(async () => {
    try {
      setLoadingRoles(true);
      const res = await apiJson.get<{ roles: RoleMetadata[] }>("/api/admin/roles");
      if (res?.roles) {
        setRoles(res.roles);
      }
    } catch (err) {
      notifyApiError(err);
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "authenticated") {
      fetchRoles();
    }
  }, [sessionStatus, fetchRoles]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchRoles();
    setRefreshing(false);
    notify.success("Role data refreshed");
  };

  // ===================== ROLE CONFIGURATION MODAL HANDLERS =====================

  const handleOpenConfigureRole = (role: RoleMetadata) => {
    setConfiguringRole(role);
    const initial = new Set<Permission>();
    if (Array.isArray(role.permissions)) {
      for (const p of role.permissions) {
        if (p in PERMISSION_METADATA && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p as Permission)) {
          initial.add(p as Permission);
        }
      }
    }
    setRoleSelectedPermissions(initial);
  };

  const handleToggleRolePermission = (key: Permission) => {
    if (SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(key)) return;
    setRoleSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleToggleRoleModule = (group: PermissionModuleGroup) => {
    const safePerms = group.permissions
      .filter((p) => !p.isSuperAdminExclusive)
      .map((p) => p.key);

    const allChecked = safePerms.every((k) => roleSelectedPermissions.has(k));

    setRoleSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        safePerms.forEach((k) => next.delete(k));
      } else {
        safePerms.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const handleApplyRolePreset = (presetPerms: Permission[]) => {
    const next = new Set<Permission>();
    for (const p of presetPerms) {
      if (!SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)) {
        next.add(p);
      }
    }
    setRoleSelectedPermissions(next);
  };

  const handleSaveRolePermissions = async () => {
    if (!configuringRole) return;
    if (!canManageAdmins) {
      notify.error("Access Denied: Only Super Administrators can customize role permissions.");
      return;
    }

    try {
      setSavingRolePermissions(true);
      await apiJson.patch<RoleMetadata>(`/api/admin/roles/${configuringRole.key}`, {
        permissions: Array.from(roleSelectedPermissions),
      });

      notify.success(
        `Permissions for role "${configuringRole.name}" updated successfully. All assigned accounts will receive these permissions.`
      );
      setConfiguringRole(null);
      await fetchRoles();
    } catch (err) {
      notifyApiError(err);
    } finally {
      setSavingRolePermissions(false);
    }
  };

  const handleResetRoleDefaults = async (roleKey: string) => {
    if (!canManageAdmins) {
      notify.error("Access Denied: Only Super Administrators can restore role defaults.");
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to restore the "${roleKey}" role to its standard system default permissions?`
    );
    if (!confirmed) return;

    try {
      setResettingRole(true);
      await apiJson.post(`/api/admin/roles/${roleKey}/reset`, {});
      notify.success(`Role "${roleKey}" restored to standard default permissions.`);
      if (configuringRole?.key === roleKey) {
        setConfiguringRole(null);
      }
      await fetchRoles();
    } catch (err) {
      notifyApiError(err);
    } finally {
      setResettingRole(false);
    }
  };

  const handleDeleteRole = async (roleKey: string, roleName: string) => {
    if (!canManageAdmins) {
      notify.error("Access Denied: Only Super Administrators can delete custom roles.");
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete custom role "${roleName}" (${roleKey})?`
    );
    if (!confirmed) return;

    try {
      await apiJson.delete(`/api/admin/roles/${roleKey}`);
      notify.success(`Custom role "${roleName}" deleted successfully.`);
      fetchRoles();
    } catch (err) {
      notifyApiError(err);
    }
  };

  // ===================== CREATE CUSTOM ROLE HANDLERS =====================

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageAdmins) {
      notify.error("Access Denied: Only Super Administrators can create roles.");
      return;
    }

    const trimmedKey = createRoleForm.key.trim().toLowerCase();
    const trimmedName = createRoleForm.name.trim();

    if (!trimmedKey || !/^[a-z0-9_-]+$/.test(trimmedKey)) {
      notify.error("Role key must contain only lowercase letters, numbers, hyphens, and underscores.");
      return;
    }
    if (!trimmedName) {
      notify.error("Role name is required.");
      return;
    }

    try {
      setCreatingRole(true);
      await apiJson.post("/api/admin/roles", {
        key: trimmedKey,
        name: trimmedName,
        description: createRoleForm.description.trim(),
        badge: createRoleForm.badge.trim() || undefined,
        permissions: Array.from(createRolePermissions),
      });

      notify.success(`Custom role "${trimmedName}" created successfully.`);
      setIsCreateRoleModalOpen(false);
      setCreateRoleForm({ key: "", name: "", description: "", badge: "" });
      setCreateRolePermissions(new Set());
      fetchRoles();
    } catch (err) {
      notifyApiError(err);
    } finally {
      setCreatingRole(false);
    }
  };

  // Access guard check for unauthorized users
  if (sessionStatus === "authenticated" && !canReadAdmins) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <PageHeader
          title="Roles & Permissions"
          subtitle="Manage system roles, permissions, and the permission matrix."
          icon={ShieldCheck}
        />
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-neutral-900">Restricted Access</h2>
          <p className="text-sm text-neutral-600 max-w-md mx-auto">
            You do not have the required administrative permissions (<code>admins:read</code>) to view the Roles & Permissions dashboard. Please contact a Super Administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-full">
      {/* Page Header */}
      <PageHeader
        title="Roles & Permissions"
        subtitle="Define role definitions, configure permissions for Admin and Dealer, and create custom roles. Manage user accounts under Users."
        icon={ShieldCheck}
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              loading={refreshing}
              leftIcon={<RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />}
            >
              Refresh
            </Button>
            {canManageAdmins && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setCreateRolePermissions(new Set(ADMIN_DEFAULT_PERMISSIONS));
                  setIsCreateRoleModalOpen(true);
                }}
                leftIcon={<KeyRound className="w-4 h-4" />}
              >
                Create Custom Role
              </Button>
            )}
          </div>
        }
      />

      {/* Role Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5 w-full">
        {loadingRoles ? (
          <>
            <div className="h-48 bg-white rounded-2xl border border-neutral-200/80 animate-pulse" />
            <div className="h-48 bg-white rounded-2xl border border-neutral-200/80 animate-pulse" />
            <div className="h-48 bg-white rounded-2xl border border-neutral-200/80 animate-pulse" />
            <div className="h-48 bg-white rounded-2xl border border-neutral-200/80 animate-pulse" />
          </>
        ) : (
          roles.map((r) => {
            const isSuper = r.key === "super_admin";
            const isAdmin = r.key === "admin";
            const isDealer = r.key === "dealer";
            const isConfigurable = r.key === "configurable_admin";
            const isCustom = r.type === "custom";

            return (
              <div
                key={r.key}
                className="bg-white rounded-2xl border border-neutral-200/80 p-5 shadow-xs flex flex-col justify-between hover:border-neutral-300 transition-all relative overflow-hidden"
              >
                {/* Top Role Header */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isSuper
                            ? "bg-rose-50 text-rose-700 border border-rose-100"
                            : isAdmin
                            ? "bg-blue-50 text-blue-700 border border-blue-100"
                            : isDealer
                            ? "bg-amber-50 text-amber-700 border border-amber-100"
                            : isConfigurable
                            ? "bg-purple-50 text-purple-700 border border-purple-100"
                            : "bg-indigo-50 text-indigo-700 border border-indigo-100"
                        }`}
                      >
                        {isSuper ? (
                          <ShieldCheck className="w-5 h-5" />
                        ) : isAdmin ? (
                          <Shield className="w-5 h-5" />
                        ) : isDealer ? (
                          <Users className="w-5 h-5" />
                        ) : isConfigurable ? (
                          <Sliders className="w-5 h-5" />
                        ) : (
                          <KeyRound className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-bold text-neutral-900 leading-tight truncate" title={r.name}>
                          {r.name}
                        </h2>
                        <span className="text-[11px] text-neutral-500 font-mono block truncate">
                          {r.key}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge
                        variant={
                          isSuper
                            ? "danger"
                            : isCustom
                            ? "info"
                            : r.isCustomized
                            ? "warning"
                            : "secondary"
                        }
                        size="sm"
                        className="whitespace-nowrap"
                      >
                        {r.badge}
                      </Badge>
                      {r.isCustomized && (isAdmin || isDealer) && (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 whitespace-nowrap">
                          Customized
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-neutral-600 leading-relaxed min-h-[36px] line-clamp-2">
                    {r.description}
                  </p>
                </div>

                {/* Bottom Counts & Actions */}
                <div className="pt-3.5 mt-3.5 border-t border-neutral-100 space-y-2.5">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="truncate">
                      <span className="text-neutral-400 font-medium">Accounts:</span>{" "}
                      <span className="font-bold text-neutral-800">{r.userCount}</span>
                      <span className="text-[11px] text-neutral-500"> ({r.activeUserCount} active)</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-neutral-400 font-medium">Perms:</span>{" "}
                      <span className="font-bold text-neutral-800 whitespace-nowrap">
                        {typeof r.permissionCount === "number" ? `${r.permissionCount}/23` : r.permissionCount}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 pt-1">
                    {isSuper && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs font-semibold w-full h-8.5"
                        onClick={() => setInspectingRole(r)}
                        leftIcon={<Eye className="w-3.5 h-3.5" />}
                      >
                        Inspect Matrix
                      </Button>
                    )}

                    {r.isEditable && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs font-semibold flex-1 border-neutral-200 h-8.5"
                          onClick={() => handleOpenConfigureRole(r)}
                          leftIcon={<SlidersHorizontal className="w-3.5 h-3.5 text-admin-primary" />}
                        >
                          Configure Role
                        </Button>

                        {(isAdmin || isDealer) && r.isCustomized && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-neutral-500 hover:text-amber-700 px-2 h-8.5"
                            onClick={() => handleResetRoleDefaults(r.key)}
                            title="Reset to system defaults"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        )}

                        {r.isDeletable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-neutral-500 hover:text-rose-600 hover:bg-rose-50 px-2 h-8.5"
                            onClick={() => handleDeleteRole(r.key, r.name)}
                            title="Delete custom role"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}

                    {isConfigurable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs font-semibold w-full h-8.5"
                        onClick={() => router.push("/admin/users?role=configurable_admin")}
                        leftIcon={<Users className="w-3.5 h-3.5" />}
                      >
                        View Accounts
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Permission Matrix Reference */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-5 sm:p-6 shadow-xs space-y-6 w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-neutral-900">Application Permission Matrix</h2>
              <p className="text-xs sm:text-sm text-neutral-500">
                Centralized registry of capabilities across catalog, spaces, dealers, pricing, quotations, and system oversight.
              </p>
            </div>
            <Badge variant="secondary" size="md" className="self-start sm:self-auto">
              23 System Capabilities
            </Badge>
          </div>

          <div className="space-y-6 w-full">
            {PERMISSION_MODULE_GROUPS.map((group) => (
              <div key={group.id} className="border border-neutral-200 rounded-xl overflow-hidden w-full">
                <div className="bg-neutral-50 px-4 sm:px-5 py-3 border-b border-neutral-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-neutral-800">
                      {group.name}
                    </h3>
                    <p className="text-[11px] sm:text-xs text-neutral-500">{group.description}</p>
                  </div>
                  <Badge variant="secondary" size="sm">
                    {group.permissions.length} capabilities
                  </Badge>
                </div>

                <div className="divide-y divide-neutral-100">
                  {group.permissions.map((perm) => (
                    <div
                      key={perm.key}
                      className="p-3.5 sm:p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:bg-neutral-50/50"
                    >
                      <div className="space-y-1 flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs sm:text-sm font-bold text-neutral-900">{perm.label}</span>
                          <code className="text-[10px] sm:text-[11px] bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded font-mono">
                            {perm.key}
                          </code>
                          {perm.isSuperAdminExclusive && (
                            <Badge variant="danger" size="sm">
                              Super Admin Exclusive
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 leading-relaxed">{perm.description}</p>
                      </div>

                      <div className="flex items-center gap-2 text-xs shrink-0 self-end md:self-auto">
                        <span className="px-2.5 py-1 rounded bg-neutral-900 text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-2xs">
                          <Check className="w-3 h-3 text-emerald-400" /> Super Admin
                        </span>
                        <span
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold border flex items-center gap-1.5 ${
                            perm.isIncludedInAdmin
                              ? "bg-neutral-100 text-neutral-800 border-neutral-200"
                              : "bg-neutral-50 text-neutral-400 border-neutral-200 line-through"
                          }`}
                        >
                          {perm.isIncludedInAdmin ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Lock className="w-3 h-3 text-rose-500" />
                          )}
                          Admin (Default)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

      {/* ===================== CONFIGURE ROLE PERMISSIONS MODAL ===================== */}
      <Modal
        isOpen={!!configuringRole}
        onClose={() => setConfiguringRole(null)}
        title={configuringRole ? `Configure Role: ${configuringRole.name} (${configuringRole.key})` : ""}
        size="4xl"
      >
        {configuringRole && (
          <div className="space-y-5">
            {/* System-wide configuration notice */}
            <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                  Role-Wide Permission Configuration
                </div>
                <p className="text-xs text-amber-800 leading-relaxed">
                  You are editing the role definition for <strong>{configuringRole.name}</strong>. Any changes saved here are persisted in MongoDB and will immediately apply to <strong>all {configuringRole.userCount} account(s)</strong> assigned to this role.
                </p>
              </div>
            </div>

            {/* Quick Status and Presets Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-neutral-50 p-3 rounded-xl border border-neutral-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-neutral-700">Selected Capabilities:</span>
                <Badge variant="info" size="md">
                  {roleSelectedPermissions.size} permitted
                </Badge>
                {configuringRole.isCustomized ? (
                  <Badge variant="warning" size="sm">
                    Customized
                  </Badge>
                ) : (
                  <Badge variant="secondary" size="sm">
                    System Defaults
                  </Badge>
                )}
              </div>

              {(configuringRole.key === "admin" || configuringRole.key === "dealer") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 text-amber-800 border-amber-300 hover:bg-amber-100"
                  onClick={() => handleResetRoleDefaults(configuringRole.key)}
                  loading={resettingRole}
                  leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                >
                  Restore System Defaults
                </Button>
              )}
            </div>

            {/* Presets Bar */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-admin-primary" /> Quick Presets
              </div>
              <div className="flex flex-wrap gap-2">
                {PERMISSION_PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => handleApplyRolePreset(p.permissions)}
                  >
                    {p.name}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  onClick={() => setRoleSelectedPermissions(new Set())}
                >
                  Clear All
                </Button>
              </div>
            </div>

            {/* Permission Module Toggles */}
            <div className="space-y-3 max-h-[48vh] overflow-y-auto pr-1">
              {PERMISSION_MODULE_GROUPS.map((group) => {
                const safePerms = group.permissions.filter((p) => !p.isSuperAdminExclusive);
                const allModuleChecked =
                  safePerms.length > 0 &&
                  safePerms.every((p) => roleSelectedPermissions.has(p.key));

                return (
                  <div key={group.id} className="border border-neutral-200 rounded-xl p-3.5 bg-neutral-50/40">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                          {group.name}
                        </span>
                        <span className="text-[11px] text-neutral-500 block">
                          {group.description}
                        </span>
                      </div>
                      {safePerms.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-[11px] h-6 px-2 text-neutral-600"
                          onClick={() => handleToggleRoleModule(group)}
                        >
                          {allModuleChecked ? "Deselect Group" : "Select Group"}
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 border-t border-neutral-200/60">
                      {group.permissions.map((perm) => {
                        const isExclusive = perm.isSuperAdminExclusive;
                        const isChecked = roleSelectedPermissions.has(perm.key);
                        const isDefault = configuringRole.defaultPermissions?.includes(perm.key);

                        return (
                          <div
                            key={perm.key}
                            onClick={() => {
                              if (!isExclusive) {
                                handleToggleRolePermission(perm.key);
                              }
                            }}
                            className={`flex items-center justify-between text-xs p-2.5 rounded-lg border transition-all ${
                              isExclusive
                                ? "bg-neutral-100/70 border-neutral-200/60 opacity-60 cursor-not-allowed"
                                : isChecked
                                ? "bg-white border-admin-primary/30 shadow-2xs cursor-pointer hover:bg-neutral-50/80"
                                : "bg-white/60 border-neutral-200/70 cursor-pointer hover:bg-neutral-50/80"
                            }`}
                          >
                            <div className="pr-2 select-none flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-neutral-900 truncate">
                                  {perm.label}
                                </span>
                                <code className="text-[10px] font-mono text-neutral-500">
                                  {perm.key}
                                </code>
                                {isDefault && (
                                  <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded border border-blue-200 whitespace-nowrap">
                                    Default
                                  </span>
                                )}
                                {isExclusive && (
                                  <span className="text-[10px] font-bold bg-rose-50 text-rose-700 px-1.5 py-0.2 rounded border border-rose-200 flex items-center gap-0.5 whitespace-nowrap">
                                    <Lock className="w-2.5 h-2.5" /> Super Admin Only
                                  </span>
                                )}
                              </div>
                              <span className="text-neutral-500 block text-[11px] mt-0.5 line-clamp-1" title={perm.description}>
                                {perm.description}
                              </span>
                            </div>

                            <div className="shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                              {isExclusive ? (
                                <Lock className="w-4 h-4 text-neutral-400" />
                              ) : (
                                <Switch
                                  checked={isChecked}
                                  onChange={() => handleToggleRolePermission(perm.key)}
                                  size="sm"
                                  ariaLabel={perm.label}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-neutral-200 flex items-center justify-between">
              <Button
                variant="outline"
                size="md"
                onClick={() => setConfiguringRole(null)}
                disabled={savingRolePermissions}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleSaveRolePermissions}
                loading={savingRolePermissions}
                leftIcon={<Check className="w-4 h-4" />}
              >
                Save Role Configuration
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===================== CREATE CUSTOM ROLE MODAL ===================== */}
      <Modal
        isOpen={isCreateRoleModalOpen}
        onClose={() => setIsCreateRoleModalOpen(false)}
        title="Create Custom Role"
        size="4xl"
      >
        <form onSubmit={handleCreateRole} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Role Key <span className="text-rose-500">*</span>
              </label>
              <Input
                value={createRoleForm.key}
                onChange={(e) =>
                  setCreateRoleForm({
                    ...createRoleForm,
                    key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                  })
                }
                placeholder="e.g. catalog_editor, sales_ops"
                required
              />
              <span className="text-[11px] text-neutral-500 block mt-1">
                Lowercase letters, numbers, hyphens, and underscores only.
              </span>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Role Name <span className="text-rose-500">*</span>
              </label>
              <Input
                value={createRoleForm.name}
                onChange={(e) => setCreateRoleForm({ ...createRoleForm, name: e.target.value })}
                placeholder="e.g. Catalog Editor"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Description
              </label>
              <Input
                value={createRoleForm.description}
                onChange={(e) =>
                  setCreateRoleForm({ ...createRoleForm, description: e.target.value })
                }
                placeholder="e.g. Manages catalog products, categories, and house spaces"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Badge Label (Optional)
              </label>
              <Input
                value={createRoleForm.badge}
                onChange={(e) => setCreateRoleForm({ ...createRoleForm, badge: e.target.value })}
                placeholder="e.g. Catalog Specialist"
              />
            </div>
          </div>

          {/* Permissions selection */}
          <div className="pt-3 border-t border-neutral-200 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-neutral-900">Permitted Capabilities</div>
                <div className="text-xs text-neutral-500">
                  Select which operations accounts assigned to this role can perform.
                </div>
              </div>
              <Badge variant="info" size="md">
                {createRolePermissions.size} permitted
              </Badge>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap gap-2">
              {PERMISSION_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => {
                    const next = new Set<Permission>();
                    for (const perm of p.permissions) {
                      if (!SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(perm)) next.add(perm);
                    }
                    setCreateRolePermissions(next);
                  }}
                >
                  {p.name}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs h-7 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                onClick={() => setCreateRolePermissions(new Set())}
              >
                Clear All
              </Button>
            </div>

            {/* Modules */}
            <div className="space-y-3 max-h-[36vh] overflow-y-auto pr-1">
              {PERMISSION_MODULE_GROUPS.map((group) => {
                const safePerms = group.permissions.filter((p) => !p.isSuperAdminExclusive);
                return (
                  <div key={group.id} className="border border-neutral-200 rounded-xl p-3 bg-neutral-50/40">
                    <div className="text-xs font-bold text-neutral-800 mb-2">{group.name}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {safePerms.map((perm) => (
                        <div key={perm.key} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-neutral-200/80">
                          <div className="pr-2 flex-1 min-w-0">
                            <span className="font-semibold text-neutral-800 block truncate">{perm.label}</span>
                            <span className="text-neutral-500 block text-[11px] truncate">
                              {perm.description}
                            </span>
                          </div>
                          <Switch
                            checked={createRolePermissions.has(perm.key)}
                            onChange={() => {
                              setCreateRolePermissions((prev) => {
                                const next = new Set(prev);
                                if (next.has(perm.key)) next.delete(perm.key);
                                else next.add(perm.key);
                                return next;
                              });
                            }}
                            size="sm"
                            ariaLabel={perm.label}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-4 border-t border-neutral-200 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setIsCreateRoleModalOpen(false)}
              disabled={creatingRole}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={creatingRole}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Create Role
            </Button>
          </div>
        </form>
      </Modal>

      {/* ===================== INSPECT PROTECTED SYSTEM ROLE MODAL ===================== */}
      <Modal
        isOpen={!!inspectingRole}
        onClose={() => setInspectingRole(null)}
        title={inspectingRole ? `Inspect Role: ${inspectingRole.name}` : ""}
        size="2xl"
      >
        {inspectingRole && (
          <div className="space-y-5">
            <div className="bg-rose-50/70 border border-rose-200/80 rounded-xl p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="text-sm font-bold text-rose-900">
                  Protected System Role (Immutable)
                </div>
                <p className="text-xs text-rose-800 leading-relaxed">
                  {inspectingRole.name} is the platform owner role. It possesses all 23 system capabilities unconditionally to guarantee system recovery and administrative continuity.
                </p>
              </div>
            </div>

            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {PERMISSION_MODULE_GROUPS.map((group) => (
                <div key={group.id} className="border border-neutral-200 rounded-xl p-3.5 bg-neutral-50/40">
                  <div className="font-bold text-xs text-neutral-800 mb-2 uppercase tracking-wider">
                    {group.name}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {group.permissions.map((perm) => (
                      <div
                        key={perm.key}
                        className="flex items-center gap-2 text-xs bg-white p-2 rounded-lg border border-neutral-200/80"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="font-semibold text-neutral-800 truncate">
                          {perm.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-neutral-200 flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setInspectingRole(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
