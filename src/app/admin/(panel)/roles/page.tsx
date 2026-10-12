"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  Shield,
  ShieldCheck,
  UserCog,
  Users,
  Lock,
  Check,
  Search,
  RefreshCw,
  Plus,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Eye,
  Info,
  ChevronRight,
  Sparkles,
  KeyRound,
  Layers,
  RotateCcw,
  Trash2,
  SlidersHorizontal,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import PageHeader from "@/components/admin/PageHeader";
import Modal from "@/components/shared/Modal";
import Pagination from "@/components/shared/Pagination";
import { Button, Input, Select, Badge } from "@/components/ui";
import { Switch } from "@/components/ui/Switch";
import {
  Permission,
  PermissionModuleGroup,
  PERMISSION_METADATA,
  PERMISSION_MODULE_GROUPS,
  PERMISSION_PRESETS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
  ADMIN_DEFAULT_PERMISSIONS,
  DEALER_DEFAULT_PERMISSIONS,
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

interface AdminUserItem {
  _id: number;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role: string;
  isActive: boolean;
  permissions?: string[];
  contactNumber?: string;
  createdAt: string;
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

  // Overview and Data States
  const [roles, setRoles] = useState<RoleMetadata[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters and Pagination
  const [activeTab, setActiveTab] = useState<"accounts" | "matrix">("accounts");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  // Configure Individual User Modal (for configurable_admin)
  const [configuringUser, setConfiguringUser] = useState<AdminUserItem | null>(null);
  const [userSelectedPermissions, setUserSelectedPermissions] = useState<Set<Permission>>(new Set());
  const [savingUserPermissions, setSavingUserPermissions] = useState(false);

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

  // Create User Modal
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    role: "configurable_admin",
    contactNumber: "",
  });
  const [createUserPermissions, setCreateUserPermissions] = useState<Set<Permission>>(new Set());
  const [creatingUser, setCreatingUser] = useState(false);

  // Quick State Toggling for user active status
  const [togglingUserId, setTogglingUserId] = useState<number | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

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

  // Load Admin Users
  const fetchUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pageSize.toString(),
      });
      if (roleFilter !== "all") params.append("role", roleFilter);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (debouncedSearch.trim()) params.append("search", debouncedSearch.trim());

      const res = await apiJson.get<{ items: AdminUserItem[]; total: number; totalPages: number }>(
        `/api/admin/users?${params.toString()}`
      );

      if (res) {
        setUsers(res.items || []);
        setTotalUsers(res.total || 0);
        setTotalPages(res.totalPages || 1);
      }
    } catch (err) {
      notifyApiError(err);
    } finally {
      setLoadingUsers(false);
    }
  }, [page, pageSize, roleFilter, statusFilter, debouncedSearch]);

  useEffect(() => {
    if (sessionStatus === "authenticated") {
      fetchRoles();
      fetchUsers();
    }
  }, [sessionStatus, fetchRoles, fetchUsers]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchRoles(), fetchUsers()]);
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
      await Promise.all([fetchRoles(), fetchUsers()]);
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
      await Promise.all([fetchRoles(), fetchUsers()]);
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

  // ===================== INDIVIDUAL USER MODAL HANDLERS =====================

  const handleOpenConfigureUser = (user: AdminUserItem) => {
    setConfiguringUser(user);
    const existing = new Set<Permission>();
    if (Array.isArray(user.permissions)) {
      for (const p of user.permissions) {
        if (p in PERMISSION_METADATA && !SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p as Permission)) {
          existing.add(p as Permission);
        }
      }
    }
    setUserSelectedPermissions(existing);
  };

  const handleSaveUserPermissions = async () => {
    if (!configuringUser || !canManageAdmins) return;

    try {
      setSavingUserPermissions(true);
      await apiJson.patch<AdminUserItem>(`/api/admin/users/${configuringUser._id}`, {
        permissions: Array.from(userSelectedPermissions),
      });

      notify.success(`Permissions for ${configuringUser.name} saved successfully`);
      setConfiguringUser(null);
      fetchUsers();
    } catch (err) {
      notifyApiError(err);
    } finally {
      setSavingUserPermissions(false);
    }
  };

  const handleToggleUserActive = async (user: AdminUserItem) => {
    if (!canManageAdmins) return;
    const nextState = !user.isActive;

    try {
      setTogglingUserId(user._id);
      await apiJson.patch<AdminUserItem>(`/api/admin/users/${user._id}`, {
        isActive: nextState,
      });

      notify.success(`Account ${nextState ? "activated" : "deactivated"} successfully`);
      setUsers((prev) =>
        prev.map((u) => (u._id === user._id ? { ...u, isActive: nextState } : u))
      );
      fetchRoles();
    } catch (err) {
      notifyApiError(err);
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageAdmins) return;

    if (!createUserForm.firstName.trim() || !createUserForm.lastName.trim() || !createUserForm.email.trim()) {
      notify.error("First name, last name, and email are required.");
      return;
    }
    if (createUserForm.password.length < 8) {
      notify.error("Password must be at least 8 characters.");
      return;
    }

    try {
      setCreatingUser(true);
      await apiJson.post<AdminUserItem>("/api/admin/users", {
        firstName: createUserForm.firstName.trim(),
        lastName: createUserForm.lastName.trim(),
        email: createUserForm.email.trim().toLowerCase(),
        password: createUserForm.password,
        contactNumber: createUserForm.contactNumber.trim() || undefined,
        role: createUserForm.role,
        permissions:
          createUserForm.role === "configurable_admin"
            ? Array.from(createUserPermissions)
            : [],
      });

      notify.success("Administrative user created successfully");
      setIsCreateUserModalOpen(false);
      setCreateUserForm({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        role: "configurable_admin",
        contactNumber: "",
      });
      setCreateUserPermissions(new Set());
      fetchRoles();
      fetchUsers();
    } catch (err) {
      notifyApiError(err);
    } finally {
      setCreatingUser(false);
    }
  };

  // Access guard check for unauthorized users
  if (sessionStatus === "authenticated" && !canReadAdmins) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <PageHeader
          title="Role Management"
          subtitle="Manage system roles, permissions, and administrative accounts."
          icon={ShieldCheck}
        />
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-neutral-900">Restricted Access</h2>
          <p className="text-sm text-neutral-600 max-w-md mx-auto">
            You do not have the required administrative permissions (<code>admins:read</code>) to view the Role Management dashboard. Please contact a Super Administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-full">
      {/* Page Header */}
      <PageHeader
        title="Role & Permission Management"
        subtitle="Manage system roles, configure permissions for Admin and Dealer, create custom roles, and administer accounts."
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
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCreateRolePermissions(new Set(ADMIN_DEFAULT_PERMISSIONS));
                    setIsCreateRoleModalOpen(true);
                  }}
                  leftIcon={<KeyRound className="w-4 h-4 text-indigo-600" />}
                >
                  Create Custom Role
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setCreateUserPermissions(new Set(ADMIN_DEFAULT_PERMISSIONS));
                    setIsCreateUserModalOpen(true);
                  }}
                  leftIcon={<Plus className="w-4 h-4" />}
                >
                  New User Account
                </Button>
              </>
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
                        onClick={() => {
                          setRoleFilter("configurable_admin");
                          setActiveTab("accounts");
                        }}
                      >
                        Filter Accounts <ChevronRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b border-neutral-200 w-full">
        <div className="flex items-center gap-6 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("accounts")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              activeTab === "accounts"
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Users className="w-4 h-4" />
            Administrative Accounts ({totalUsers})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("matrix")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              activeTab === "matrix"
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Layers className="w-4 h-4" />
            Permission Matrix Reference
          </button>
        </div>
      </div>

      {/* TAB 1: ACCOUNTS LIST */}
      {activeTab === "accounts" && (
        <div className="space-y-4 w-full">
          {/* Filters Bar */}
          <div className="bg-white rounded-2xl border border-neutral-200/80 p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3.5 w-full">
            <div className="relative flex-1 max-w-lg">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search by name, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 text-xs sm:text-sm h-10 w-full"
              />
            </div>

            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <div className="w-full sm:w-48">
                <Select
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setPage(1);
                  }}
                  className="text-xs sm:text-sm h-10 w-full"
                >
                  <option value="all">All Roles</option>
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="w-full sm:w-40">
                <Select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="text-xs sm:text-sm h-10 w-full"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
          </div>

          {/* Accounts Table */}
          <div className="bg-white rounded-2xl border border-neutral-200/80 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200/80 bg-neutral-50/60 text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                    <th className="py-3.5 px-4">User</th>
                    <th className="py-3.5 px-4">Role</th>
                    <th className="py-3.5 px-4">Permissions Mode</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Created</th>
                    {canManageAdmins && <th className="py-3.5 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 text-xs text-neutral-700">
                  {loadingUsers ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-neutral-400">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-neutral-400" />
                        Loading accounts...
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-neutral-500">
                        No administrative user accounts found.
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => {
                      const isSuper = u.role === "super_admin";
                      const isConfig = u.role === "configurable_admin";
                      const roleMeta = roles.find((r) => r.key === u.role);

                      return (
                        <tr key={u._id} className="hover:bg-neutral-50/50 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-neutral-900">{u.name}</div>
                            <div className="text-[11px] text-neutral-500 font-mono">{u.email}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            <Badge
                              variant={
                                isSuper
                                  ? "danger"
                                  : isConfig
                                  ? "info"
                                  : "secondary"
                              }
                              size="sm"
                            >
                              {roleMeta?.name || u.role}
                            </Badge>
                          </td>
                          <td className="py-3.5 px-4">
                            {isSuper ? (
                              <span className="text-[11px] text-neutral-600 font-medium flex items-center gap-1">
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                All 23 (Owner)
                              </span>
                            ) : isConfig ? (
                              <span className="text-[11px] text-purple-700 font-medium flex items-center gap-1">
                                <Sliders className="w-3.5 h-3.5" />
                                {u.permissions?.length || 0} granular assigned
                              </span>
                            ) : (
                              <span className="text-[11px] text-neutral-600 font-medium">
                                Inherited from {roleMeta?.name || u.role}
                                {roleMeta?.isCustomized && (
                                  <span className="ml-1 text-amber-700 font-semibold">(Customized)</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <Badge variant={u.isActive ? "success" : "secondary"} size="sm">
                              {u.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="py-3.5 px-4 text-neutral-500 text-[11px]">
                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                          </td>
                          {canManageAdmins && (
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {isConfig && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs h-8 px-2.5"
                                    onClick={() => handleOpenConfigureUser(u)}
                                    leftIcon={<Sliders className="w-3.5 h-3.5 text-purple-600" />}
                                  >
                                    Configure User
                                  </Button>
                                )}
                                {!isSuper && (
                                  <Button
                                    variant={u.isActive ? "ghost" : "outline"}
                                    size="sm"
                                    className={`text-xs h-8 px-2.5 ${
                                      u.isActive ? "text-rose-600 hover:text-rose-700 hover:bg-rose-50" : "text-emerald-700"
                                    }`}
                                    onClick={() => handleToggleUserActive(u)}
                                    loading={togglingUserId === u._id}
                                  >
                                    {u.isActive ? "Deactivate" : "Activate"}
                                  </Button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-4 border-t border-neutral-100 flex justify-between items-center">
                <div className="text-xs text-neutral-500">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalUsers)} of {totalUsers} accounts
                </div>
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PERMISSION MATRIX REFERENCE */}
      {activeTab === "matrix" && (
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
      )}

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

      {/* ===================== CONFIGURE INDIVIDUAL USER MODAL ===================== */}
      <Modal
        isOpen={!!configuringUser}
        onClose={() => setConfiguringUser(null)}
        title="Configure Individual User Permissions"
        size="4xl"
      >
        {configuringUser && (
          <div className="space-y-6">
            <div className="bg-neutral-50 rounded-xl p-4 border border-neutral-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase font-bold tracking-wider text-neutral-500">
                  Target Account
                </div>
                <div className="text-base font-bold text-neutral-900">{configuringUser.name}</div>
                <div className="text-xs text-neutral-500 font-mono">{configuringUser.email}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase font-bold tracking-wider text-neutral-500">
                  Selected Permissions
                </div>
                <div className="text-sm font-bold text-neutral-900">
                  <span className="text-admin-primary">{userSelectedPermissions.size}</span> granted
                </div>
              </div>
            </div>

            {/* Presets */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-neutral-700 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-admin-primary" />
                Quick Permission Presets:
              </div>
              <div className="flex flex-wrap gap-2">
                {PERMISSION_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    variant="outline"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => {
                      const next = new Set<Permission>();
                      for (const p of preset.permissions) {
                        if (!SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)) next.add(p);
                      }
                      setUserSelectedPermissions(next);
                    }}
                  >
                    {preset.name}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  onClick={() => setUserSelectedPermissions(new Set())}
                >
                  Clear All
                </Button>
              </div>
            </div>

            {/* Module toggles */}
            <div className="space-y-3 max-h-[44vh] overflow-y-auto pr-1">
              {PERMISSION_MODULE_GROUPS.map((group) => {
                const safePerms = group.permissions.filter((p) => !p.isSuperAdminExclusive);
                return (
                  <div key={group.id} className="border border-neutral-200 rounded-xl p-3.5 bg-neutral-50/40">
                    <div className="text-xs font-bold uppercase tracking-wider text-neutral-800 mb-2">
                      {group.name}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {safePerms.map((perm) => (
                        <div key={perm.key} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-neutral-200/80">
                          <div className="pr-2 flex-1 min-w-0">
                            <span className="font-semibold text-neutral-800 block truncate">{perm.label}</span>
                            <span className="text-neutral-500 block text-[11px] truncate">{perm.description}</span>
                          </div>
                          <Switch
                            checked={userSelectedPermissions.has(perm.key)}
                            onChange={() => {
                              setUserSelectedPermissions((prev) => {
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

            <div className="pt-4 border-t border-neutral-200 flex items-center justify-between">
              <Button
                variant="outline"
                size="md"
                onClick={() => setConfiguringUser(null)}
                disabled={savingUserPermissions}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleSaveUserPermissions}
                loading={savingUserPermissions}
                leftIcon={<Check className="w-4 h-4" />}
              >
                Save Permissions
              </Button>
            </div>
          </div>
        )}
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

      {/* ===================== CREATE USER ACCOUNT MODAL ===================== */}
      <Modal
        isOpen={isCreateUserModalOpen}
        onClose={() => setIsCreateUserModalOpen(false)}
        title="Create Administrative Account"
        size="4xl"
      >
        <form onSubmit={handleCreateUser} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                First Name <span className="text-rose-500">*</span>
              </label>
              <Input
                value={createUserForm.firstName}
                onChange={(e) => setCreateUserForm({ ...createUserForm, firstName: e.target.value })}
                placeholder="e.g. Jane"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Last Name <span className="text-rose-500">*</span>
              </label>
              <Input
                value={createUserForm.lastName}
                onChange={(e) => setCreateUserForm({ ...createUserForm, lastName: e.target.value })}
                placeholder="e.g. Doe"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Email Address <span className="text-rose-500">*</span>
              </label>
              <Input
                type="email"
                value={createUserForm.email}
                onChange={(e) => setCreateUserForm({ ...createUserForm, email: e.target.value })}
                placeholder="e.g. jane.doe@whyte.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Password <span className="text-rose-500">*</span>
              </label>
              <Input
                type="password"
                value={createUserForm.password}
                onChange={(e) => setCreateUserForm({ ...createUserForm, password: e.target.value })}
                placeholder="Minimum 8 characters"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Assign Role <span className="text-rose-500">*</span>
              </label>
              <Select
                value={createUserForm.role}
                onChange={(e) => setCreateUserForm({ ...createUserForm, role: e.target.value })}
              >
                {roles
                  .filter((r) => r.key !== "dealer")
                  .map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name} ({r.badge})
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Contact Number (Optional)
              </label>
              <Input
                value={createUserForm.contactNumber}
                onChange={(e) => setCreateUserForm({ ...createUserForm, contactNumber: e.target.value })}
                placeholder="e.g. +91 9876543210"
              />
            </div>
          </div>

          {/* If Configurable Admin, allow configuring individual initial permissions */}
          {createUserForm.role === "configurable_admin" && (
            <div className="pt-3 border-t border-neutral-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-neutral-900">
                    Initial Permission Profile
                  </div>
                  <div className="text-xs text-neutral-500">
                    Select initial capabilities for this configurable admin account.
                  </div>
                </div>
                <Badge variant="info" size="md">
                  {createUserPermissions.size} granted
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                {PERMISSION_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      const next = new Set<Permission>();
                      for (const p of preset.permissions) {
                        if (!SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p)) next.add(p);
                      }
                      setCreateUserPermissions(next);
                    }}
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>

              <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-1">
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
                              <span className="text-neutral-500 block text-[11px] truncate">{perm.description}</span>
                            </div>
                            <Switch
                              checked={createUserPermissions.has(perm.key)}
                              onChange={() => {
                                setCreateUserPermissions((prev) => {
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
          )}

          <div className="pt-4 border-t border-neutral-200 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setIsCreateUserModalOpen(false)}
              disabled={creatingUser}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={creatingUser}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Create Account
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
