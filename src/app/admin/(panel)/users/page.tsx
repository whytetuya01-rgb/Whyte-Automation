"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Users as UsersIcon,
  Search,
  RefreshCw,
  Plus,
  Shield,
  ShieldCheck,
  Store,
  Sliders,
  Lock,
  MoreVertical,
  Pencil,
  CheckCircle2,
  XCircle,
  Sparkles,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError, safeMessage } from "@/lib/apiClient";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import PageHeader from "@/components/admin/PageHeader";
import Modal from "@/components/shared/Modal";
import Pagination from "@/components/shared/Pagination";
import { Button, Input, Select, Badge } from "@/components/ui";
import { Switch } from "@/components/ui/Switch";
import {
  Permission,
  PERMISSION_MODULE_GROUPS,
  PERMISSION_PRESETS,
  SUPER_ADMIN_EXCLUSIVE_PERMISSIONS,
} from "@/lib/permissions";

interface RoleMetadata {
  key: string;
  name: string;
  badge: string;
  type: "system_protected" | "system_customizable" | "configurable" | "custom";
  userCount: number;
  activeUserCount: number;
}

interface UserItem {
  _id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  isActive: boolean;
  permissions?: string[];
  contactNumber?: string | null;
  companyName?: string | null;
  gstNumber?: string | null;
  businessEmail?: string | null;
  address?: string | null;
  discountAllocationPercent?: number;
  createdAt: string;
}

function initialsOf(name: string | null | undefined, email: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

const emptyAddForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  role: "configurable_admin",
  contactNumber: "",
};

const emptyEditForm = {
  firstName: "",
  lastName: "",
  role: "",
  isActive: true,
  password: "",
  contactNumber: "",
  companyName: "",
  gstNumber: "",
  businessEmail: "",
  address: "",
  discountAllocationPercent: 0,
};

export default function UsersPage() {
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

  const confirm = useConfirm();

  const [roles, setRoles] = useState<RoleMetadata[]>([]);
  const [stats, setStats] = useState<{ totalAccounts: number; activeAccounts: number }>({
    totalAccounts: 0,
    activeAccounts: 0,
  });
  const [loadingRoles, setLoadingRoles] = useState(true);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  // Add User modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [addPermissions, setAddPermissions] = useState<Set<Permission>>(new Set());
  const [creating, setCreating] = useState(false);

  // Edit User modal
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editPermissions, setEditPermissions] = useState<Set<Permission>>(new Set());
  const [saving, setSaving] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchRoles = useCallback(async () => {
    try {
      setLoadingRoles(true);
      const res = await apiJson.get<{
        roles: RoleMetadata[];
        stats: { totalAccounts: number; activeAccounts: number };
      }>("/api/admin/roles");
      if (res) {
        setRoles(res.roles || []);
        setStats(res.stats || { totalAccounts: 0, activeAccounts: 0 });
      }
    } catch (err) {
      notifyApiError(err);
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (roleFilter !== "all") params.append("role", roleFilter);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (debouncedSearch.trim()) params.append("search", debouncedSearch.trim());

      // `GET /api/admin/users` returns the standard paginated envelope
      // (`{ data: UserItem[], pagination: { total, totalPages, ... } }`), not
      // a flat `{ items, total, totalPages }` shape — `apiJson.get` would
      // auto-unwrap just the `data` array and silently drop `pagination`, so
      // this reads the response directly, same as the Dealers page does for
      // the same reason.
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(safeMessage(json?.error?.message, "Could not fetch user accounts."));
      }
      setUsers(json.data || []);
      setTotal(json.pagination?.total || 0);
      setTotalPages(json.pagination?.totalPages || 1);
    } catch (err) {
      notifyApiError(err, "Unable to load users", "Could not fetch user accounts.");
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
    notify.success("Users refreshed");
  };

  const roleMeta = (key: string) => roles.find((r) => r.key === key);
  const roleLabel = (key: string) => roleMeta(key)?.name || key;
  const roleBadgeVariant = (key: string): "danger" | "warning" | "info" | "secondary" => {
    if (key === "super_admin") return "danger";
    if (key === "dealer") return "warning";
    if (key === "configurable_admin") return "info";
    if (roleMeta(key)?.type === "custom") return "info";
    return "secondary";
  };

  // ===================== ADD USER =====================

  const openAdd = () => {
    setAddForm(emptyAddForm);
    setAddPermissions(new Set());
    setIsAddOpen(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageAdmins) return;

    if (!addForm.firstName.trim() || !addForm.lastName.trim() || !addForm.email.trim()) {
      notify.error("First name, last name, and email are required.");
      return;
    }
    if (addForm.password.length < 8) {
      notify.error("Password must be at least 8 characters.");
      return;
    }

    try {
      setCreating(true);
      await apiJson.post("/api/admin/users", {
        firstName: addForm.firstName.trim(),
        lastName: addForm.lastName.trim(),
        email: addForm.email.trim().toLowerCase(),
        password: addForm.password,
        contactNumber: addForm.contactNumber.trim() || undefined,
        role: addForm.role,
        permissions: addForm.role === "configurable_admin" ? Array.from(addPermissions) : [],
      });

      notify.success("User created successfully");
      setIsAddOpen(false);
      setAddForm(emptyAddForm);
      setAddPermissions(new Set());
      fetchRoles();
      fetchUsers();
    } catch (err) {
      notifyApiError(err);
    } finally {
      setCreating(false);
    }
  };

  // ===================== EDIT USER =====================

  const openEdit = (user: UserItem) => {
    setOpenMenuId(null);
    setEditingUser(user);
    setEditForm({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      role: user.role,
      isActive: user.isActive,
      password: "",
      contactNumber: user.contactNumber || "",
      companyName: user.companyName || "",
      gstNumber: user.gstNumber || "",
      businessEmail: user.businessEmail || "",
      address: user.address || "",
      discountAllocationPercent: user.discountAllocationPercent || 0,
    });
    const existingPerms = new Set<Permission>();
    if (Array.isArray(user.permissions)) {
      for (const p of user.permissions) {
        if (!SUPER_ADMIN_EXCLUSIVE_PERMISSIONS.has(p as Permission)) existingPerms.add(p as Permission);
      }
    }
    setEditPermissions(existingPerms);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !canManageAdmins) return;
    const isDealer = editingUser.role === "dealer";

    try {
      setSaving(true);
      if (isDealer) {
        // Dealers keep their own richer edit surface (`/api/admin/dealers/[id]`):
        // role is fixed to "dealer" (that endpoint has no role field at all),
        // but the account-level profile/discount/status fields are shared.
        await apiJson.patch(`/api/admin/dealers/${editingUser._id}`, {
          firstName: editForm.firstName.trim() || undefined,
          lastName: editForm.lastName.trim() || undefined,
          contactNumber: editForm.contactNumber.trim() || undefined,
          companyName: editForm.companyName.trim() || undefined,
          gstNumber: editForm.gstNumber.trim() || undefined,
          businessEmail: editForm.businessEmail.trim() || undefined,
          address: editForm.address.trim() || undefined,
          discountAllocationPercent: editForm.discountAllocationPercent,
          isActive: editForm.isActive,
        });
      } else {
        const body: Record<string, unknown> = {
          firstName: editForm.firstName.trim(),
          lastName: editForm.lastName.trim(),
          role: editForm.role,
          isActive: editForm.isActive,
        };
        if (editForm.password.trim()) body.password = editForm.password.trim();
        if (editForm.role === "configurable_admin") body.permissions = Array.from(editPermissions);
        await apiJson.patch(`/api/admin/users/${editingUser._id}`, body);
      }

      notify.success("User updated successfully");
      setEditingUser(null);
      fetchRoles();
      fetchUsers();
    } catch (err) {
      notifyApiError(err);
    } finally {
      setSaving(false);
    }
  };

  // ===================== TOGGLE ACTIVE =====================

  const handleToggleActive = async (user: UserItem) => {
    setOpenMenuId(null);
    const nextStatus = !user.isActive;
    const isDealer = user.role === "dealer";

    await confirm({
      title: nextStatus ? "Activate Account" : "Deactivate Account",
      message: nextStatus
        ? `Activate account for ${user.name}? They will be able to log in again.`
        : `Deactivate account for ${user.name}? They will be prevented from logging in immediately.`,
      confirmText: nextStatus ? "Activate" : "Deactivate",
      cancelText: "Cancel",
      variant: nextStatus ? "primary" : "danger",
      onConfirm: async () => {
        try {
          const endpoint = isDealer ? `/api/admin/dealers/${user._id}` : `/api/admin/users/${user._id}`;
          await apiJson.patch(endpoint, { isActive: nextStatus });
          notify.success(nextStatus ? "Account activated" : "Account deactivated");
          fetchRoles();
          fetchUsers();
        } catch (err) {
          notifyApiError(err, "Status update failed", "Could not change account status.");
        }
      },
    });
  };

  // Access guard for unauthorized users
  if (sessionStatus === "authenticated" && !canReadAdmins) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <PageHeader title="Users" subtitle="Manage user accounts and assigned roles." icon={UsersIcon} />
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-neutral-900">Restricted Access</h2>
          <p className="text-sm text-neutral-600 max-w-md mx-auto">
            You do not have the required administrative permissions (<code>admins:read</code>) to view this page.
            Please contact a Super Administrator.
          </p>
        </div>
      </div>
    );
  }

  const assignableRoles = roles.filter((r) => r.key !== "dealer");

  const customCount = roles
    .filter((r) => r.type === "custom" || r.key === "configurable_admin")
    .reduce((sum, r) => sum + r.userCount, 0);

  const summaryCards: Array<{ label: string; value: number; icon: typeof UsersIcon; tone: string }> = [
    { label: "Total Users", value: stats.totalAccounts, icon: UsersIcon, tone: "bg-neutral-100 text-neutral-700 border-neutral-200" },
    {
      label: "Super Admins",
      value: roleMeta("super_admin")?.userCount ?? 0,
      icon: ShieldCheck,
      tone: "bg-rose-50 text-rose-700 border-rose-100",
    },
    { label: "Admins", value: roleMeta("admin")?.userCount ?? 0, icon: Shield, tone: "bg-blue-50 text-blue-700 border-blue-100" },
    { label: "Dealers", value: roleMeta("dealer")?.userCount ?? 0, icon: Store, tone: "bg-amber-50 text-amber-700 border-amber-100" },
  ];
  if (customCount > 0) {
    summaryCards.push({ label: "Custom Roles", value: customCount, icon: Sliders, tone: "bg-purple-50 text-purple-700 border-purple-100" });
  }

  return (
    <div className="space-y-6 w-full max-w-full">
      <PageHeader
        title="Users"
        subtitle="Manage user accounts and assigned roles."
        icon={UsersIcon}
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
              <Button variant="primary" size="sm" onClick={openAdd} leftIcon={<Plus className="w-4 h-4" />}>
                Add User
              </Button>
            )}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 w-full">
        {loadingRoles
          ? summaryCards.map((_, i) => (
              <div key={i} className="h-24 bg-white rounded-2xl border border-neutral-200/80 animate-pulse" />
            ))
          : summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="bg-white rounded-2xl border border-neutral-200/80 p-4 shadow-xs flex items-center gap-3"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${card.tone}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold text-neutral-900 leading-tight">{card.value}</div>
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide truncate">
                      {card.label}
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      {/* Filters Bar */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3.5 w-full">
        <div className="relative flex-1 max-w-lg">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <Input
            placeholder="Search by name or email..."
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

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left border-collapse table-fixed">
            <colgroup>
              <col className="w-auto" />
              <col className="w-36" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-16" />
            </colgroup>
            <thead>
              <tr className="border-b border-neutral-200/80 bg-neutral-50/60 text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">User</th>
                <th className="py-3.5 px-4">Role</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Created</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 text-xs text-neutral-700">
              {loadingUsers ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-neutral-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-neutral-400" />
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-neutral-500">
                    No user accounts found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSuper = u.role === "super_admin";
                  return (
                    <tr key={u._id} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-neutral-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                            {initialsOf(u.name, u.email)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-neutral-900 truncate">{u.name}</div>
                            <div className="text-[11px] text-neutral-500 font-mono truncate">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={roleBadgeVariant(u.role)} size="sm">
                          {roleLabel(u.role)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={u.isActive ? "success" : "secondary"} size="sm">
                          {u.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-neutral-500 text-[11px]">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {canManageAdmins && (
                          <div className="relative inline-block text-left">
                            <button
                              type="button"
                              onClick={() => setOpenMenuId(openMenuId === u._id ? null : u._id)}
                              className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition"
                              aria-label="User actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openMenuId === u._id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                                <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-neutral-200 shadow-lg z-20 py-1.5 overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => openEdit(u)}
                                    className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    Edit
                                  </button>
                                  {!isSuper && (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleActive(u)}
                                      className={`w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold hover:bg-neutral-50 ${
                                        u.isActive ? "text-rose-600" : "text-emerald-700"
                                      }`}
                                    >
                                      {u.isActive ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                      {u.isActive ? "Deactivate" : "Activate"}
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-neutral-100 flex justify-between items-center">
            <div className="text-xs text-neutral-500">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} users
            </div>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* ===================== ADD USER MODAL ===================== */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Add User" size="2xl">
        <form onSubmit={handleCreateUser} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                First Name <span className="text-rose-500">*</span>
              </label>
              <Input
                value={addForm.firstName}
                onChange={(e) => setAddForm({ ...addForm, firstName: e.target.value })}
                placeholder="e.g. Jane"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Last Name <span className="text-rose-500">*</span>
              </label>
              <Input
                value={addForm.lastName}
                onChange={(e) => setAddForm({ ...addForm, lastName: e.target.value })}
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
                value={addForm.email}
                onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
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
                value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
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
              <Select value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}>
                {assignableRoles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name} ({r.badge})
                  </option>
                ))}
              </Select>
              <span className="text-[11px] text-neutral-500 block mt-1">
                Dealer accounts are created through the dealer registration flow, not here.
              </span>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">Contact Number (Optional)</label>
              <Input
                value={addForm.contactNumber}
                onChange={(e) => setAddForm({ ...addForm, contactNumber: e.target.value })}
                placeholder="e.g. +91 9876543210"
              />
            </div>
          </div>

          {addForm.role === "configurable_admin" && (
            <div className="pt-3 border-t border-neutral-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-neutral-900">Initial Permission Profile</div>
                  <div className="text-xs text-neutral-500">Select initial capabilities for this account.</div>
                </div>
                <Badge variant="info" size="md">
                  {addPermissions.size} granted
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
                      setAddPermissions(next);
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
                          <div
                            key={perm.key}
                            className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-neutral-200/80"
                          >
                            <div className="pr-2 flex-1 min-w-0">
                              <span className="font-semibold text-neutral-800 block truncate">{perm.label}</span>
                              <span className="text-neutral-500 block text-[11px] truncate">{perm.description}</span>
                            </div>
                            <Switch
                              checked={addPermissions.has(perm.key)}
                              onChange={() => {
                                setAddPermissions((prev) => {
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
            <Button type="button" variant="outline" size="md" onClick={() => setIsAddOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" loading={creating} leftIcon={<Plus className="w-4 h-4" />}>
              Create User
            </Button>
          </div>
        </form>
      </Modal>

      {/* ===================== EDIT USER MODAL ===================== */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={editingUser ? `Edit User: ${editingUser.name}` : ""}
        size="2xl"
      >
        {editingUser && (
          <form onSubmit={handleSaveEdit} className="space-y-5">
            <div className="bg-neutral-50 rounded-xl p-3.5 border border-neutral-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase font-bold tracking-wider text-neutral-500">Account</div>
                <div className="text-sm font-bold text-neutral-900 truncate">{editingUser.email}</div>
              </div>
              <Badge variant={roleBadgeVariant(editingUser.role)} size="sm">
                {roleLabel(editingUser.role)}
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">First Name</label>
                <Input
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">Last Name</label>
                <Input
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                />
              </div>
            </div>

            {editingUser.role === "dealer" ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1">Company Name</label>
                    <Input
                      value={editForm.companyName}
                      onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1">GST Number</label>
                    <Input
                      value={editForm.gstNumber}
                      onChange={(e) => setEditForm({ ...editForm, gstNumber: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1">Contact Number</label>
                    <Input
                      value={editForm.contactNumber}
                      onChange={(e) => setEditForm({ ...editForm, contactNumber: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1">Business Email</label>
                    <Input
                      type="email"
                      value={editForm.businessEmail}
                      onChange={(e) => setEditForm({ ...editForm, businessEmail: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">Address</label>
                  <Input
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">
                    Discount Allocation (%)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={editForm.discountAllocationPercent}
                    onChange={(e) =>
                      setEditForm({ ...editForm, discountAllocationPercent: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1">Assign Role</label>
                    <Select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                      {assignableRoles.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name} ({r.badge})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1">
                      Reset Password (Optional)
                    </label>
                    <Input
                      type="password"
                      value={editForm.password}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      placeholder="Leave blank to keep current password"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1">Contact Number</label>
                  <Input
                    value={editForm.contactNumber}
                    onChange={(e) => setEditForm({ ...editForm, contactNumber: e.target.value })}
                  />
                </div>

                {editForm.role === "configurable_admin" && (
                  <div className="pt-3 border-t border-neutral-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-neutral-900">Assigned Permissions</div>
                      <Badge variant="info" size="md">
                        {editPermissions.size} granted
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
                            setEditPermissions(next);
                          }}
                        >
                          {preset.name}
                        </Button>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => setEditPermissions(new Set())}
                      >
                        Clear All
                      </Button>
                    </div>

                    <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-1">
                      {PERMISSION_MODULE_GROUPS.map((group) => {
                        const safePerms = group.permissions.filter((p) => !p.isSuperAdminExclusive);
                        return (
                          <div key={group.id} className="border border-neutral-200 rounded-xl p-3 bg-neutral-50/40">
                            <div className="text-xs font-bold text-neutral-800 mb-2">{group.name}</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {safePerms.map((perm) => (
                                <div
                                  key={perm.key}
                                  className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-neutral-200/80"
                                >
                                  <div className="pr-2 flex-1 min-w-0">
                                    <span className="font-semibold text-neutral-800 block truncate">{perm.label}</span>
                                    <span className="text-neutral-500 block text-[11px] truncate">
                                      {perm.description}
                                    </span>
                                  </div>
                                  <Switch
                                    checked={editPermissions.has(perm.key)}
                                    onChange={() => {
                                      setEditPermissions((prev) => {
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
              </>
            )}

            {editingUser.role !== "super_admin" && (
              <div className="flex items-center justify-between bg-neutral-50 rounded-xl p-3.5 border border-neutral-200">
                <div>
                  <div className="text-xs font-bold text-neutral-800">Account Status</div>
                  <div className="text-[11px] text-neutral-500">
                    {editForm.isActive ? "This account can currently log in." : "This account is currently blocked from logging in."}
                  </div>
                </div>
                <Switch
                  checked={editForm.isActive}
                  onChange={(checked) => setEditForm({ ...editForm, isActive: checked })}
                  size="sm"
                  ariaLabel="Account Active"
                />
              </div>
            )}

            <div className="pt-4 border-t border-neutral-200 flex items-center justify-between">
              <Button type="button" variant="outline" size="md" onClick={() => setEditingUser(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" loading={saving} leftIcon={<Sparkles className="w-4 h-4" />}>
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
