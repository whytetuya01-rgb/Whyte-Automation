"use client";

import React, { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { RoomType } from "@/types";
import {
  Plus,
  Pencil,
  Search,
  X,
  CheckCircle2,
  XCircle,
  Trash2,
  DoorOpen,
  AlertTriangle,
  RefreshCw,
  SearchX,
} from "lucide-react";
import { cn, getRoomIcon } from "@/lib/utils";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { confirmDeletionWithImpact } from "@/lib/deletionImpactClient";
import PageHeader from "@/components/admin/PageHeader";
import Modal from "@/components/shared/Modal";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { useRoomTypes } from "@/lib/swr";
import { Input, Button, Switch } from "@/components/ui";

function RoomTypeForm({
  roomType,
  onSuccess,
}: {
  roomType?: RoomType | null;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(roomType?.name ?? "");
  const [isActive, setIsActive] = useState(roomType?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const roomIconElement = useMemo(() => {
    const Icon = getRoomIcon(name.trim() || "Room");
    return React.createElement(Icon, { className: "h-6 w-6 text-pink-400" });
  }, [name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Room name is required.");
      notify.error("Validation Error", "Please enter a valid room name.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const url = roomType ? `/api/room-types/${roomType.id}` : "/api/room-types";
      await apiJson[roomType ? "patch" : "post"](url, {
        name: name.trim(),
        icon: roomType?.icon ?? "",
        sortOrder: 0,
        isActive,
      });

      notify.success(
        roomType ? "Room type updated" : "Room type created",
        roomType ? `"${name}" details saved.` : `"${name}" added successfully.`
      );
      onSuccess();
    } catch (err: unknown) {
      notifyApiError(err, "Save failed", "Unable to save room type");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Icon Preview Box */}
      <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/70 p-4 flex items-center gap-4">
        <div className="h-12 w-12 shrink-0 rounded-xl bg-neutral-900 text-white flex items-center justify-center shadow-2xs">
          {roomIconElement}
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block">
            Space Icon Preview
          </span>
          <p className="text-sm font-bold text-neutral-900 mt-0.5">
            {name.trim() || "Room Name"}
          </p>
          <p className="text-[11px] text-neutral-500">
            Icon automatically assigned based on space type
          </p>
        </div>
      </div>

      {/* Room Name Input */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-neutral-800">
          Room Name <span className="text-pink-600">*</span>
        </label>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="e.g. Master Bedroom, Living Room, Home Theater"
          error={error || undefined}
          className="font-medium focus:ring-pink-500/20 focus:border-neutral-900"
        />
      </div>

      {/* Active Status Toggle */}
      <div className="rounded-xl border border-neutral-200/80 bg-white p-3.5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-neutral-900">Active Status</p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {isActive ? "Available when building proposals" : "Hidden from new proposals"}
          </p>
        </div>
        <Switch checked={isActive} onChange={setIsActive} />
      </div>

      {/* Submit Buttons */}
      <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
        <Button
          type="submit"
          disabled={saving}
          className="w-full bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-xs h-10 rounded-xl"
        >
          {saving ? "Saving..." : roomType ? "Update Room Type" : "Create Room Type"}
        </Button>
      </div>
    </form>
  );
}

type StatusFilter = "all" | "active" | "inactive";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const ICON_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30";

function StateMessage({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-neutral-200/80 bg-white px-6 py-12 text-center shadow-2xs">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-400">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-neutral-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function RoomTypeCardSkeleton() {
  return (
    <div className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-neutral-200/80 bg-white px-4 py-3.5 shadow-2xs">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-neutral-100" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-neutral-100" />
      </div>
    </div>
  );
}

export default function RoomTypesPage() {
  const { data: session } = useSession();
  const isSuperAdmin = (session?.user as { role?: string } | undefined)?.role === "super_admin";
  const confirm = useConfirm();
  const { data: roomTypes = [], error, isLoading: loading, mutate } = useRoomTypes();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<RoomType | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  // Disables a card's switch while its request is in flight, so a fast
  // double-click can't send two contradictory updates.
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setShowForm(true);
  };

  const openEdit = (rt: RoomType) => {
    setEditTarget(rt);
    setShowForm(true);
  };

  const handleToggle = async (rt: RoomType) => {
    setTogglingId(rt.id);
    try {
      await apiJson.patch(`/api/room-types/${rt.id}`, { isActive: !rt.isActive });
      await mutate();
      notify.success(
        !rt.isActive ? "Room type activated" : "Room type deactivated",
        !rt.isActive ? `"${rt.name}" is now active in proposals.` : `"${rt.name}" deactivated.`
      );
    } catch (err: unknown) {
      notifyApiError(err, "Status update failed", "Unable to update status.");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (rt: RoomType) => {
    await confirmDeletionWithImpact({
      confirm,
      impactUrl: `/api/room-types/${rt.id}/deletion-impact`,
      recordLabel: rt.name,
      entityName: "room type",
      confirmText: "Delete Room Type",
      onConfirmedDelete: async () => {
        try {
          await apiJson.delete(`/api/room-types/${rt.id}`);
          notify.success("Room type deleted", `"${rt.name}" has been removed.`);
          mutate();
        } catch (err: unknown) {
          notifyApiError(err, "Unable to delete room type", "Please try again.");
        }
      },
    });
  };

  const filteredRoomTypes = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return roomTypes.filter((rt: RoomType) => {
      const matchesSearch = rt.name.toLowerCase().includes(query);
      const matchesStatus =
        filterStatus === "all" ? true : filterStatus === "active" ? rt.isActive : !rt.isActive;
      return matchesSearch && matchesStatus;
    });
  }, [roomTypes, searchQuery, filterStatus]);

  const activeCount = useMemo(() => roomTypes.filter((r) => r.isActive).length, [roomTypes]);
  const inactiveCount = roomTypes.length - activeCount;
  const countFor = (status: StatusFilter) =>
    status === "all" ? roomTypes.length : status === "active" ? activeCount : inactiveCount;

  const addButton = (
    <button
      type="button"
      onClick={openCreate}
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-4 text-xs font-semibold text-white shadow-xs transition-all hover:bg-neutral-800 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Plus size={14} aria-hidden="true" /> Add Room Type
    </button>
  );

  const header = (
    <PageHeader
      title="Room Types"
      icon={DoorOpen}
      badge={
        !loading && !error ? (
          <span
            className="inline-flex items-center rounded-full border border-neutral-200/80 bg-neutral-100 px-2 py-0.5 font-mono text-xs font-semibold text-neutral-700"
            title={`${roomTypes.length} room types`}
          >
            {roomTypes.length}
          </span>
        ) : undefined
      }
      subtitle="Manage spaces and room categories available for quotations and house templates."
      actions={addButton}
    />
  );

  const modal = (
    <Modal
      isOpen={showForm}
      onClose={() => {
        setShowForm(false);
        setEditTarget(null);
      }}
      title={editTarget ? "Edit Room Type" : "Add New Room Type"}
      size="md"
    >
      <RoomTypeForm
        roomType={editTarget}
        onSuccess={() => {
          setShowForm(false);
          setEditTarget(null);
          mutate();
        }}
      />
    </Modal>
  );

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="w-full space-y-5 pb-4" aria-busy="true">
        {header}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <RoomTypeCardSkeleton key={i} />
          ))}
        </div>
        <span className="sr-only">Loading room types…</span>
        {modal}
      </div>
    );
  }

  // ── Error (nothing cached to show) ────────────────────────────────────────
  if (error && roomTypes.length === 0) {
    return (
      <div className="w-full space-y-5 pb-4">
        {header}
        <StateMessage
          icon={AlertTriangle}
          title="Couldn't load room types"
          description="Something went wrong while fetching room types. Check your connection and try again."
          action={
            <Button variant="outline" size="sm" onClick={() => mutate()} className="gap-1.5 text-xs font-semibold">
              <RefreshCw size={13} aria-hidden="true" /> Retry
            </Button>
          }
        />
        {modal}
      </div>
    );
  }

  const metrics = [
    { label: "Total", value: roomTypes.length, icon: DoorOpen, iconClass: "text-neutral-500" },
    { label: "Active", value: activeCount, icon: CheckCircle2, iconClass: "text-emerald-600" },
    { label: "Inactive", value: inactiveCount, icon: XCircle, iconClass: "text-neutral-400" },
  ];

  return (
    <div className="w-full space-y-5 pb-4">
      {header}

      {/* ─── Metrics strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-neutral-100 rounded-2xl border border-neutral-200/80 bg-white shadow-2xs">
        {metrics.map(({ label, value, icon: Icon, iconClass }) => (
          <div key={label} className="flex items-center justify-center gap-3 px-3 py-3 sm:py-3.5">
            <Icon size={16} className={cn("hidden shrink-0 sm:block", iconClass)} aria-hidden="true" />
            <div className="text-center sm:text-left">
              <div className="text-lg font-bold leading-tight text-neutral-900 tabular-nums">{value}</div>
              <div className="text-[11px] font-medium text-neutral-500">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Search & status filter ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-neutral-200/80 bg-white p-2.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search room types…"
            aria-label="Search room types"
            className="h-9 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-8 text-xs text-neutral-900 placeholder:text-neutral-400 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 transition-colors hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Filter by status"
          className="grid grid-cols-3 gap-1 rounded-xl bg-neutral-100/80 p-1 sm:flex sm:shrink-0"
        >
          {STATUS_FILTERS.map(({ value, label }) => {
            const isSelected = filterStatus === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilterStatus(value)}
                aria-pressed={isSelected}
                className={cn(
                  "inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
                  isSelected
                    ? "border-accent-border/70 bg-accent-light font-semibold text-accent-foreground shadow-2xs"
                    : "border-transparent font-medium text-neutral-600 hover:bg-white/70 hover:text-neutral-900"
                )}
              >
                {label}
                <span className="font-mono text-[10px] tabular-nums opacity-70">{countFor(value)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Room type grid ────────────────────────────────────────────────── */}
      {roomTypes.length === 0 ? (
        <StateMessage
          icon={DoorOpen}
          title="No room types yet"
          description="Add your first room type to use it in quotations and house templates."
          action={addButton}
        />
      ) : filteredRoomTypes.length === 0 ? (
        searchQuery.trim() ? (
          <StateMessage
            icon={SearchX}
            title="No matching room types"
            description={`Nothing matches "${searchQuery.trim()}"${filterStatus !== "all" ? ` in ${filterStatus} room types` : ""}.`}
            action={
              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")} className="text-xs font-semibold">
                Clear search
              </Button>
            }
          />
        ) : (
          <StateMessage
            icon={filterStatus === "inactive" ? XCircle : CheckCircle2}
            title={`No ${filterStatus} room types`}
            description={
              filterStatus === "inactive"
                ? "Every room type is currently active in quotations."
                : "No room types are currently active in quotations."
            }
            action={
              <Button variant="outline" size="sm" onClick={() => setFilterStatus("all")} className="text-xs font-semibold">
                Show all
              </Button>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredRoomTypes.map((rt: RoomType) => {
            const RoomIcon = getRoomIcon(rt.name);
            return (
              <div
                key={rt.id}
                className="group flex min-h-[76px] items-center gap-3 rounded-2xl border border-neutral-200/80 bg-white px-4 py-3.5 shadow-2xs transition-all duration-200 hover:border-neutral-300 hover:shadow-sm"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                    rt.isActive
                      ? "bg-neutral-900 text-pink-400 shadow-2xs"
                      : "border border-neutral-200 bg-neutral-50 text-neutral-400"
                  )}
                >
                  <RoomIcon className="h-4.5 w-4.5" aria-hidden="true" />
                </div>

                <div className="min-w-0 flex-1">
                  <h3
                    className={cn(
                      "truncate text-sm font-semibold tracking-tight",
                      rt.isActive ? "text-neutral-900" : "text-neutral-500"
                    )}
                    title={rt.name}
                  >
                    {rt.name}
                  </h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", rt.isActive ? "bg-emerald-500" : "bg-neutral-300")}
                      aria-hidden="true"
                    />
                    {rt.isActive ? "Active in Quotes" : "Inactive"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => openEdit(rt)}
                    title="Edit room type"
                    aria-label={`Edit ${rt.name}`}
                    className={cn(ICON_BUTTON, "hover:bg-neutral-100 hover:text-neutral-900")}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>

                  <span title={rt.isActive ? "Deactivate" : "Activate"} className="mx-1 inline-flex">
                    <Switch
                      size="sm"
                      checked={rt.isActive}
                      disabled={togglingId === rt.id}
                      onChange={() => handleToggle(rt)}
                      ariaLabel={`${rt.isActive ? "Deactivate" : "Activate"} ${rt.name}`}
                    />
                  </span>

                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDelete(rt)}
                      title="Delete room type"
                      aria-label={`Delete ${rt.name}`}
                      className={cn(ICON_BUTTON, "hover:bg-red-50 hover:text-red-600")}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal}
    </div>
  );
}
