"use client";

import React, { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { RoomType } from "@/types";
import {
  Plus,
  Pencil,
  Search,
  X,
  Home,
  CheckCircle2,
  XCircle,
  Layers,
  Trash2,
} from "lucide-react";
import { getRoomIcon } from "@/lib/utils";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import Modal from "@/components/shared/Modal";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
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

export default function RoomTypesPage() {
  const { data: session } = useSession();
  const isSuperAdmin = (session?.user as { role?: string } | undefined)?.role === "super_admin";
  const confirm = useConfirm();
  const { data: roomTypes = [], isLoading: loading, mutate } = useRoomTypes();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<RoomType | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");

  const handleToggle = async (rt: RoomType) => {
    try {
      await apiJson.patch(`/api/room-types/${rt.id}`, { isActive: !rt.isActive });
      mutate();
      notify.success(
        !rt.isActive ? "Room type activated" : "Room type deactivated",
        !rt.isActive ? `"${rt.name}" is now active in proposals.` : `"${rt.name}" deactivated.`
      );
    } catch (err: unknown) {
      notifyApiError(err, "Status update failed", "Unable to update status.");
    }
  };

  const handleDelete = async (rt: RoomType) => {
    await confirm({
      title: "Delete Room Type",
      message: `Are you sure you want to delete "${rt.name}"?`,
      detail: "Room types still used in a house-type template or an existing quotation cannot be deleted. This action is irreversible.",
      confirmText: "Delete Room Type",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: async () => {
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

  // Filtered & Searched Room Types
  const filteredRoomTypes = useMemo(() => {
    return roomTypes.filter((rt: RoomType) => {
      const matchesSearch = rt.name.toLowerCase().includes(searchQuery.toLowerCase().trim());
      const matchesStatus =
        filterStatus === "all"
          ? true
          : filterStatus === "active"
            ? rt.isActive
            : !rt.isActive;
      return matchesSearch && matchesStatus;
    });
  }, [roomTypes, searchQuery, filterStatus]);

  const activeCount = useMemo(() => roomTypes.filter((r) => r.isActive).length, [roomTypes]);
  const inactiveCount = useMemo(() => roomTypes.filter((r) => !r.isActive).length, [roomTypes]);

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <LoadingSpinner />
        <p className="text-xs font-semibold text-neutral-500">Loading room types...</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 pb-16">
      {/* ─── 1. PAGE HEADER ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-neutral-900 tracking-tight">Room Types</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700 border border-neutral-200/80 font-mono">
              {roomTypes.length} {roomTypes.length === 1 ? "Room Type" : "Room Types"}
            </span>
          </div>
          <p className="text-[13px] text-neutral-500 mt-1">
            Manage spaces and room categories available for quotation and house templates.
          </p>
        </div>

        <button
          onClick={() => {
            setEditTarget(null);
            setShowForm(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-xs shrink-0 self-start sm:self-center"
        >
          <Plus size={14} /> Add Room Type
        </button>
      </div>

      {/* ─── 2. COMPACT SUMMARY METRICS STRIP ──────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 divide-x divide-neutral-100 flex overflow-hidden shadow-xs">
        {[
          { label: "Total", value: roomTypes.length, icon: Home },
          { label: "Active", value: activeCount, icon: CheckCircle2, color: "text-emerald-600" },
          { label: "Inactive", value: inactiveCount, icon: XCircle, color: "text-neutral-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex-1 flex items-center justify-center gap-3.5 py-3.5 px-4 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-neutral-100 border border-neutral-200/60 flex items-center justify-center shrink-0 text-neutral-700">
              <Icon size={16} className={color} />
            </div>
            <div>
              <div className="text-xl font-bold text-neutral-900 leading-tight tabular-nums">{value}</div>
              <div className="text-[11px] text-neutral-500 font-medium">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── 3. SEARCH & FILTER TOOLBAR ───────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-neutral-200/80 shadow-xs">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search room types..."
            className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-neutral-200 bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/8 focus:border-neutral-400 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 shrink-0 bg-neutral-100/80 p-1 rounded-xl">
          {(["all", "active", "inactive"] as const).map((status) => {
            const count = status === "all" ? roomTypes.length : status === "active" ? activeCount : inactiveCount;
            const label = status === "all" ? "All" : status === "active" ? "Active" : "Inactive";
            const isSelected = filterStatus === status;

            return (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                  isSelected
                    ? "bg-white text-pink-600 shadow-2xs border border-pink-200/60 font-bold"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-white/50 font-semibold"
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── 4. ROOM TYPES 3-COLUMN GRID ──────────────────────────────────── */}
      {filteredRoomTypes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-14 text-center space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-neutral-100 text-neutral-400 mx-auto flex items-center justify-center border border-neutral-200">
            <Home className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-neutral-800">No room types found</h3>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto">
            {searchQuery
              ? `No room types matching "${searchQuery}".`
              : "No room types match the selected filter."}
          </p>
          {searchQuery && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery("")}
              className="gap-2 text-xs font-semibold mt-2"
            >
              Clear Search Filter
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRoomTypes.map((rt: RoomType) => {
            const RoomIcon = getRoomIcon(rt.name);
            return (
              <div
                key={rt.id}
                className={`group rounded-2xl border bg-white p-4 transition-all duration-200 shadow-xs hover:shadow-sm flex items-center justify-between gap-3.5 ${
                  !rt.isActive
                    ? "border-neutral-200/60 bg-neutral-50/50 opacity-75"
                    : "border-neutral-200/90 hover:border-neutral-300"
                }`}
              >
                {/* Left: Icon & Room Name & Status */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Room Icon */}
                  <div
                    className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-transform ${
                      rt.isActive
                        ? "bg-neutral-900 text-white shadow-2xs group-hover:scale-105"
                        : "bg-neutral-100 border border-neutral-200 text-neutral-400"
                    }`}
                  >
                    <RoomIcon className={`h-4.5 w-4.5 ${rt.isActive ? "text-pink-400" : ""}`} />
                  </div>

                  {/* Room Info */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <h3 className="text-base font-bold text-neutral-900 tracking-tight truncate">
                      {rt.name}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          rt.isActive ? "bg-emerald-500" : "bg-neutral-400"
                        }`}
                      />
                      <span className="text-[11px] font-medium text-neutral-500 truncate">
                        {rt.isActive ? "Active in Quotes" : "Inactive"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => {
                      setEditTarget(rt);
                      setShowForm(true);
                    }}
                    className="p-1.5 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
                    title="Edit Room Type"
                  >
                    <Pencil size={14} />
                  </button>

                  <Switch
                    size="sm"
                    checked={rt.isActive}
                    onChange={() => handleToggle(rt)}
                  />

                  {isSuperAdmin && (
                    <button
                      onClick={() => handleDelete(rt)}
                      className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete Room Type"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── 5. CREATE / EDIT MODAL ───────────────────────────────────────── */}
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
    </div>
  );
}

