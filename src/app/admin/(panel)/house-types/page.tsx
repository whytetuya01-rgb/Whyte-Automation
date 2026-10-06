"use client";

import { useState, useMemo } from "react";
import { HouseType, RoomType } from "@/types";
import { isBathroomLikeRoomName, getRoomIcon } from "@/lib/utils";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Pencil,
  Building2,
  Search,
  X,
  Layers,
  Minus,
  LayoutGrid,
  Hash,
  Home,
} from "lucide-react";
import notify from "@/lib/notify";
import Modal from "@/components/shared/Modal";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useHouseTypes, useRoomTypes } from "@/lib/swr";
import { Input, Button, Checkbox } from "@/components/ui";

interface HouseTypeFormProps {
  houseType?: HouseType | null;
  roomTypes: RoomType[];
  onSuccess: () => void;
}

function HouseTypeFormModal({ houseType, roomTypes, onSuccess }: HouseTypeFormProps) {
  const [name, setName] = useState(houseType?.name ?? "");
  const [description, setDescription] = useState(houseType?.description ?? "");
  const [rooms, setRooms] = useState<{ roomTypeId: number; defaultCount: number }[]>(
    houseType?.roomTemplate
      ?.filter((t) => !isBathroomLikeRoomName((t.roomType as any)?.name))
      .map((t) => ({ roomTypeId: t.roomTypeId, defaultCount: t.defaultCount })) ?? []
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleRoom = (roomTypeId: number) => {
    if (rooms.find((r) => r.roomTypeId === roomTypeId)) {
      setRooms(rooms.filter((r) => r.roomTypeId !== roomTypeId));
    } else {
      setRooms([...rooms, { roomTypeId, defaultCount: 1 }]);
    }
  };

  const setCount = (roomTypeId: number, count: number) => {
    const validCount = Math.max(1, Math.min(15, count));
    setRooms(rooms.map((r) => (r.roomTypeId === roomTypeId ? { ...r, defaultCount: validCount } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("House Type Name is required.");
      notify.error("Validation Error", "Please enter a valid house type name.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const url = houseType ? `/api/house-types/${houseType.id}` : "/api/house-types";
      const res = await fetch(url, {
        method: houseType ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, sortOrder: 0, rooms }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save house type");
      }
      notify.success(
        houseType ? "House type updated" : "House type created",
        houseType
          ? `Template "${name}" has been updated.`
          : `New house type "${name}" created successfully.`
      );
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unable to save house type";
      notify.error("Save Failed", msg);
    } finally {
      setSaving(false);
    }
  };

  const availableRoomTypes = useMemo(() => {
    return roomTypes.filter((rt) => !isBathroomLikeRoomName(rt.name));
  }, [roomTypes]);

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Template Header info */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-neutral-800">
            House Type Name <span className="text-pink-600">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. 3 BHK, 4 BHK Villa, Duplex Penthouse"
            error={error || undefined}
            className="font-medium focus:ring-pink-500/20 focus:border-neutral-900"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-neutral-800">
            Description
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Standard 3 Bedroom layout with Living & Kitchen"
          />
        </div>
      </div>

      {/* Room Template Selection Grid */}
      <div className="space-y-2.5 pt-2 border-t border-neutral-100">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-pink-600" />
            Default Space Template Configuration
          </label>
          <span className="text-[11px] font-semibold text-neutral-500 font-mono">
            {rooms.length} {rooms.length === 1 ? "Space" : "Spaces"} Selected
          </span>
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {availableRoomTypes.map((rt) => {
            const selected = rooms.find((r) => r.roomTypeId === rt.id);
            const RoomIcon = getRoomIcon(rt.name);

            return (
              <div
                key={rt.id}
                className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all ${
                  selected
                    ? "border-neutral-900 bg-neutral-50/80 shadow-2xs"
                    : "border-neutral-200/80 bg-white hover:border-neutral-300"
                }`}
              >
                <div
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  onClick={() => toggleRoom(rt.id)}
                >
                  <Checkbox
                    id={`rt-${rt.id}`}
                    checked={!!selected}
                    onChange={() => toggleRoom(rt.id)}
                  />
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                        selected ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      <RoomIcon className={`h-4 w-4 ${selected ? "text-pink-400" : ""}`} />
                    </div>
                    <span className="text-xs font-bold text-neutral-900 truncate">
                      {rt.name}
                    </span>
                  </div>
                </div>

                {selected && (
                  <div className="flex items-center gap-1.5 shrink-0 bg-white px-2 py-1 rounded-lg border border-neutral-200 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setCount(rt.id, selected.defaultCount - 1)}
                      disabled={selected.defaultCount <= 1}
                      className="h-6 w-6 rounded flex items-center justify-center text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-30"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-6 text-center text-xs font-mono font-bold text-neutral-900">
                      {selected.defaultCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCount(rt.id, selected.defaultCount + 1)}
                      className="h-6 w-6 rounded flex items-center justify-center text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Form Submit */}
      <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
        <Button
          type="submit"
          disabled={saving}
          className="w-full bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-xs h-10 rounded-xl"
        >
          {saving ? "Saving..." : houseType ? "Update House Type" : "Create House Type"}
        </Button>
      </div>
    </form>
  );
}

export default function HouseTypesPage() {
  const { data: houseTypes = [], isLoading: loadingHT, mutate: mutateHouseTypes } = useHouseTypes();
  const { data: roomTypes = [], isLoading: loadingRT } = useRoomTypes();
  const loading = loadingHT || loadingRT;

  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<HouseType | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredHouseTypes = useMemo(() => {
    return houseTypes.filter((ht: HouseType) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        ht.name.toLowerCase().includes(q) ||
        (ht.description && ht.description.toLowerCase().includes(q))
      );
    });
  }, [houseTypes, searchQuery]);

  const totalRoomsConfigured = useMemo(() => {
    return houseTypes.reduce((sum, ht) => {
      const rooms = ht.roomTemplate?.filter((t) => !isBathroomLikeRoomName((t.roomType as any)?.name)) || [];
      return sum + rooms.reduce((rSum, r) => rSum + (r.defaultCount || 1), 0);
    }, 0);
  }, [houseTypes]);

  const totalUniqueRoomTypes = useMemo(() => {
    const ids = new Set<number>();
    houseTypes.forEach((ht) => {
      ht.roomTemplate?.forEach((t) => {
        if (!isBathroomLikeRoomName((t.roomType as any)?.name)) ids.add(t.roomTypeId);
      });
    });
    return ids.size;
  }, [houseTypes]);

  const avgSpacesPerTemplate = useMemo(() => {
    if (houseTypes.length === 0) return 0;
    return Math.round(totalRoomsConfigured / houseTypes.length);
  }, [houseTypes, totalRoomsConfigured]);

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <LoadingSpinner />
        <p className="text-xs font-semibold text-neutral-500">Loading house layout templates...</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 pb-16">

      {/* ─── 1. PAGE HEADER ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-neutral-900 tracking-tight">House Types</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700 border border-neutral-200/80 font-mono">
              {houseTypes.length} {houseTypes.length === 1 ? "Template" : "Templates"}
            </span>
          </div>
          <p className="text-[13px] text-neutral-500 mt-1">
            Configure reusable layout templates, default room allocations, and spaces used during quotation building.
          </p>
        </div>

        <button
          onClick={() => {
            setEditTarget(null);
            setShowForm(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-xs shrink-0 self-start sm:self-center"
        >
          <Plus size={14} /> Add House Type
        </button>
      </div>

      {/* ─── 2. COMPACT SUMMARY METRICS STRIP ──────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 divide-x divide-neutral-100 flex overflow-hidden shadow-xs">
        {[
          { label: "Templates", value: houseTypes.length, icon: Building2 },
          { label: "Total Spaces", value: totalRoomsConfigured, icon: LayoutGrid },
          { label: "Avg / Template", value: avgSpacesPerTemplate, icon: Hash },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex-1 flex items-center justify-center gap-3.5 py-3.5 px-4 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-neutral-100 border border-neutral-200/60 flex items-center justify-center shrink-0 text-neutral-700">
              <Icon size={16} />
            </div>
            <div>
              <div className="text-xl font-bold text-neutral-900 leading-tight tabular-nums">{value}</div>
              <div className="text-[11px] text-neutral-500 font-medium">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── 3. SEARCH TOOLBAR ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-neutral-200/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search house types..."
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

        <div className="text-xs text-neutral-500 font-medium flex items-center gap-1.5 px-1 shrink-0">
          <Layers className="h-3.5 w-3.5 text-neutral-400" />
          <span>{totalUniqueRoomTypes} unique room types across all templates</span>
        </div>
      </div>

      {/* ─── 4. HOUSE TYPES TEMPLATE GRID ─────────────────────────────────── */}
      {filteredHouseTypes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-14 text-center space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-neutral-100 text-neutral-400 mx-auto flex items-center justify-center border border-neutral-200">
            <Building2 className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-neutral-800">No house types found</h3>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto">
            {searchQuery ? `No templates matching "${searchQuery}".` : "No house type templates available."}
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredHouseTypes.map((ht: HouseType, index: number) => {
            const templateRooms =
              ht.roomTemplate?.filter((t) => !isBathroomLikeRoomName((t.roomType as any)?.name)) || [];
            const isExpanded = expanded === ht.id;
            const totalSpaces = templateRooms.reduce((sum, r) => sum + (r.defaultCount || 1), 0);
            const isMultiFloor = /duplex|villa|penthouse|townhouse|bungalow|multi/i.test(ht.name);

            // Format room composition line e.g. "2 Bedroom · 1 Hall · 1 Kitchen"
            const roomCompositionString = templateRooms
              .map((t) => {
                const name = (t.roomType as any)?.name ?? "Room";
                const count = t.defaultCount || 1;
                return count > 1 ? `${count} ${name}` : name;
              })
              .join(" · ");

            return (
              <div
                key={ht.id}
                className={`bg-white rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col ${
                  isExpanded
                    ? "border-neutral-300 shadow-md ring-1 ring-neutral-900/5"
                    : "border-neutral-200/90 hover:border-neutral-300 hover:shadow-xs"
                }`}
              >
                {/* ── Card Header & Summary (Clickable expand) ── */}
                <div
                  onClick={() => setExpanded(isExpanded ? null : ht.id)}
                  className="p-4 sm:p-5 flex-1 cursor-pointer select-none space-y-3.5 hover:bg-neutral-50/40 transition-colors"
                >
                  {/* Top Row: Index Badge + Title & Multi-floor tag + Actions */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-xl bg-neutral-900 text-white flex items-center justify-center shrink-0 font-bold text-xs font-mono shadow-2xs">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-bold text-neutral-900 tracking-tight truncate">
                            {ht.name}
                          </h3>
                          {isMultiFloor && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200/80 text-[10px] font-semibold text-neutral-700">
                              <Layers size={10} className="text-neutral-500" />
                              Multiple floors
                            </span>
                          )}
                        </div>
                        {ht.description && (
                          <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{ht.description}</p>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditTarget(ht);
                          setShowForm(true);
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors flex items-center gap-1.5"
                        title="Edit House Type"
                      >
                        <Pencil size={13} className="text-neutral-500" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : ht.id)}
                        className={`p-1.5 rounded-lg transition-all ${
                          isExpanded
                            ? "bg-neutral-100 text-neutral-900"
                            : "text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100/60"
                        }`}
                        aria-label={isExpanded ? "Collapse details" : "Expand details"}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Room Composition Line */}
                  {roomCompositionString ? (
                    <div className="text-xs font-medium text-neutral-700 bg-neutral-50 px-3 py-2 rounded-xl border border-neutral-100 flex items-center gap-2">
                      <Home size={13} className="text-neutral-400 shrink-0" />
                      <span className="truncate">{roomCompositionString}</span>
                    </div>
                  ) : (
                    <div className="text-xs italic text-neutral-400 bg-neutral-50 px-3 py-2 rounded-xl border border-neutral-100">
                      No spaces configured
                    </div>
                  )}

                  {/* Metrics Row */}
                  <div className="flex items-center justify-between pt-1 border-t border-neutral-100 text-xs">
                    {/* Spaces Count with Whyte Pink subtle accent */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold font-mono text-pink-600 bg-pink-50 border border-pink-200/60 px-2 py-0.5 rounded-md">
                        {totalSpaces}
                      </span>
                      <span className="font-semibold text-neutral-800">Spaces</span>
                    </div>

                    {/* Room Types Count */}
                    <div className="flex items-center gap-1 text-neutral-500 font-medium text-[11px]">
                      <LayoutGrid size={12} className="text-neutral-400" />
                      <span>{templateRooms.length} {templateRooms.length === 1 ? "room type" : "room types"}</span>
                    </div>
                  </div>
                </div>

                {/* ── Expanded Content (Room / Space Allocation Grid) ── */}
                {isExpanded && (
                  <div className="border-t border-neutral-200/80 bg-neutral-50/70 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        Room / Space Allocation
                      </span>
                      <span className="text-[11px] font-mono text-neutral-400">
                        {totalSpaces} total spaces
                      </span>
                    </div>

                    {templateRooms.length === 0 ? (
                      <div className="text-center py-6 space-y-2 bg-white rounded-xl border border-neutral-200/80 p-4">
                        <p className="text-xs text-neutral-500 font-medium">No spaces configured</p>
                        <button
                          onClick={() => {
                            setEditTarget(ht);
                            setShowForm(true);
                          }}
                          className="text-xs font-semibold text-pink-600 hover:text-pink-700 underline underline-offset-2 inline-flex items-center gap-1"
                        >
                          Configure template →
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {templateRooms.map((t) => {
                          const roomName = (t.roomType as any)?.name ?? "Room";
                          const RoomIcon = getRoomIcon(roomName);
                          return (
                            <div
                              key={t.id}
                              className="flex items-center justify-between p-2.5 rounded-xl border border-neutral-200/70 bg-white hover:border-neutral-300 transition-colors shadow-2xs"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="h-7 w-7 rounded-lg bg-neutral-900 text-white flex items-center justify-center shrink-0">
                                  <RoomIcon className="h-3.5 w-3.5 text-pink-400" />
                                </div>
                                <span className="text-xs font-bold text-neutral-900 truncate">
                                  {roomName}
                                </span>
                              </div>
                              <span className="text-xs font-mono font-bold text-neutral-800 bg-neutral-100 border border-neutral-200/80 px-2 py-0.5 rounded-lg">
                                {t.defaultCount} {t.defaultCount === 1 ? "space" : "spaces"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── 5. FORM MODAL ────────────────────────────────────────────────── */}
      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditTarget(null);
        }}
        title={editTarget ? `Edit Template: ${editTarget.name}` : "Add House Type Template"}
        size="lg"
      >
        <HouseTypeFormModal
          houseType={editTarget}
          roomTypes={roomTypes}
          onSuccess={() => {
            setShowForm(false);
            setEditTarget(null);
            mutateHouseTypes();
          }}
        />
      </Modal>
    </div>
  );
}

