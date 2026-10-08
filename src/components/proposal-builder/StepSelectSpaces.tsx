"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Check,
  ArrowLeft,
  ArrowRight,
  Layers,
  GripVertical,
  Search,
  X,
  Building,
} from "lucide-react";
import Image from "next/image";
import { RoomType, HouseType, Quotation, QuotationRoom } from "@/types";
import { getRoomIcon } from "@/lib/utils";
import { getRoomDisplayName, groupRoomsByFloor, isMultiFloorHouseType } from "@/lib/roomUtils";
import { getRoomImage, roomImageSrc } from "@/lib/roomImageMap";
import FloorLocationSelect from "@/components/ui/FloorLocationSelect";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import notify from "@/lib/notify";
import {
  resolveRoomPresets,
  ResolvedRoomPreset,
} from "@/lib/roomPresetsFallback";
import { getEffectiveFloorForRoom } from "@/lib/floorAssignment";

interface Props {
  quotation: Quotation;
  roomTypes: RoomType[];
  houseTypes?: HouseType[];
  onAddRoom: (roomTypeId: number | null, customName?: string, subArea?: string) => Promise<void>;
  onUpdateRoom?: (roomId: number, data: Partial<QuotationRoom>) => Promise<void>;
  onDeleteRoom: (roomId: number) => Promise<void>;
  onContinue: () => void;
  onBack: () => void;
  isLoading?: boolean;
}

export default function StepSelectSpaces({
  quotation,
  roomTypes: initialRoomTypes,
  houseTypes = [],
  onAddRoom,
  onUpdateRoom,
  onDeleteRoom,
  onContinue,
  onBack,
  isLoading = false,
}: Props) {
  const confirm = useConfirm();
  const [customName, setCustomName] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const [allPresets, setAllPresets] = useState<ResolvedRoomPreset[]>([]);
  const [recommendedPresets, setRecommendedPresets] = useState<ResolvedRoomPreset[]>([]);
  const [otherPresets, setOtherPresets] = useState<ResolvedRoomPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"rooms" | "floors">("rooms");

  // Drag & Drop State for Tab 2
  const [draggingRoomId, setDraggingRoomId] = useState<number | null>(null);
  const [dragOverFloor, setDragOverFloor] = useState<string | null>(null);

  // Add Room Modal State for Tab 2
  const [addRoomModalFloor, setAddRoomModalFloor] = useState<string | null>(null);
  const [modalSearch, setModalSearch] = useState("");
  const [modalCustomName, setModalCustomName] = useState("");
  const [modalShowCustom, setModalShowCustom] = useState(false);

  const existingRooms = quotation.rooms || [];
  const selectedHouseType = houseTypes.find(
    (h) => Number(h.id ?? (h as any)._id) === Number(quotation.houseTypeId)
  );

  // Determine if the selected property type supports multiple floors/locations
  const isMultiFloor = useMemo(() => {
    return isMultiFloorHouseType(selectedHouseType);
  }, [selectedHouseType]);

  // If single floor, ensure active sub-tab is fixed to "rooms"
  useEffect(() => {
    if (!isMultiFloor && activeSubTab !== "rooms") {
      setActiveSubTab("rooms");
    }
  }, [isMultiFloor, activeSubTab]);

  // Load room presets asynchronously
  useEffect(() => {
    let isMounted = true;
    async function loadPresets() {
      setLoadingPresets(true);
      try {
        const resolved = resolveRoomPresets({
          houseType: selectedHouseType,
          allRoomTypes: initialRoomTypes,
        });

        if (!isMounted) return;

        setAllPresets(resolved.allPresets);
        setRecommendedPresets(resolved.recommendedPresets);
        setOtherPresets(resolved.otherPresets);
      } catch (err) {
        console.error("Failed to load room presets:", err);
      } finally {
        if (isMounted) setLoadingPresets(false);
      }
    }

    loadPresets();
    return () => {
      isMounted = false;
    };
  }, [selectedHouseType, initialRoomTypes]);

  const hasHouseTypeContext = Boolean(quotation.houseTypeId && selectedHouseType);

  // Handlers
  const handleAddPreset = async (preset: ResolvedRoomPreset, targetFloor?: string) => {
    try {
      if (preset.roomTypeId) {
        await onAddRoom(preset.roomTypeId, undefined, targetFloor);
      } else {
        await onAddRoom(null, preset.name, targetFloor);
      }
      notify.success(`Added ${preset.name}`);
    } catch {
      notify.error("Failed to add space");
    }
  };

  const handleRemovePreset = async (room: QuotationRoom) => {
    const roomId = Number(room.id ?? (room as any)._id);
    const displayName = getRoomDisplayName(room, existingRooms);
    const ok = await confirm({
      title: `Remove ${displayName}?`,
      message:
        "This space and all items configured inside it will be removed from this quotation.",
      confirmText: "Remove Space",
      cancelText: "Keep Space",
      variant: "danger",
    });
    if (!ok) return;

    try {
      await onDeleteRoom(roomId);
      notify.success(`Removed ${displayName}`);
    } catch {
      notify.error("Failed to remove space");
    }
  };

  const handleAddCustomRoom = async (e: React.FormEvent, targetFloor?: string) => {
    e.preventDefault();
    const nameToAdd = modalShowCustom ? modalCustomName.trim() : customName.trim();
    if (!nameToAdd) return;

    setAddingCustom(true);
    try {
      await onAddRoom(null, nameToAdd, targetFloor);
      notify.success(`Added ${nameToAdd}`);
      if (modalShowCustom) {
        setModalCustomName("");
        setModalShowCustom(false);
        setAddRoomModalFloor(null);
      } else {
        setCustomName("");
        setShowCustomInput(false);
      }
    } catch {
      notify.error("Failed to add custom room");
    } finally {
      setAddingCustom(false);
    }
  };

  const handleMoveRoomToFloor = async (roomId: number, targetFloor: string) => {
    const targetRoom = existingRooms.find((r) => Number(r.id ?? (r as any)._id) === roomId);
    if (!targetRoom) return;
    if (targetRoom.subArea === targetFloor) return;

    const roomDisplayName = getRoomDisplayName(targetRoom, existingRooms);
    if (onUpdateRoom) {
      try {
        await onUpdateRoom(roomId, { subArea: targetFloor });
        notify.success(`Moved ${roomDisplayName} to ${targetFloor}`);
      } catch {
        notify.error(`Failed to move ${roomDisplayName}`);
      }
    }
  };

  // Render room card for Tab 1 (Select Rooms) - Clean UI, NO floor dropdown or labels
  const renderTab1SelectedRoomCard = (room: QuotationRoom) => {
    const roomId = Number(room.id ?? (room as any)._id);
    const displayName = getRoomDisplayName(room, existingRooms);
    const IconComponent = getRoomIcon(room.customName ?? room.roomType?.name ?? "Room");
    const totalItems = (room.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);

    const matchingPreset = allPresets.find((p) => {
      if (room.roomTypeId && p.roomTypeId && Number(p.roomTypeId) === Number(room.roomTypeId)) return true;
      if (room.customName && p.name && room.customName.trim().toLowerCase() === p.name.trim().toLowerCase()) return true;
      return false;
    });

    return (
      <div
        key={`tab1-room-${roomId}`}
        className="group relative overflow-hidden rounded-2xl border transition-all duration-200 select-none min-h-[120px] bg-gray-950 text-white border-accent/40 shadow-md ring-2 ring-accent/20 animate-fadeIn"
      >
        <RoomBackdrop name={room.customName ?? room.roomType?.name ?? displayName} />
        <div className="relative flex h-full min-h-[120px] flex-col justify-between p-4">
        {/* Top Bar: Icon + Room Name on Left, Check + Cancel on Right (ONE SINGLE ROW) */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-black/40 text-accent ring-1 ring-white/15">
              <IconComponent size={18} />
            </div>
            <p className="font-bold text-sm sm:text-base leading-snug truncate text-white min-w-0 flex-1">
              {displayName}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <span className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center text-xs font-black shadow-2xs">
              <Check size={12} strokeWidth={3} />
            </span>
            <button
              type="button"
              onClick={() => handleRemovePreset(room)}
              className="w-5 h-5 rounded-full bg-black/45 ring-1 ring-white/20 hover:bg-red-500/40 text-white hover:text-red-100 flex items-center justify-center transition ml-0.5 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title="Remove space"
              aria-label={`Remove ${displayName}`}
            >
              ×
            </button>
          </div>
        </div>

        {/* Bottom Bar: Device Hint & + ADD ANOTHER */}
        <div className="pt-2 border-t border-dashed flex items-center justify-between text-[11px] font-medium border-white/20 mt-3">
          <span className="text-gray-200">
            {totalItems > 0
              ? `${totalItems} ${totalItems === 1 ? "device" : "devices"} configured`
              : "Selected space"}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (matchingPreset) {
                handleAddPreset(matchingPreset);
              } else {
                onAddRoom(null, room.customName ?? "Custom Room", undefined);
              }
            }}
            className="text-[10px] uppercase font-bold text-white hover:text-accent underline-offset-2 hover:underline transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            title="Add another instance of this space"
          >
            + Add another
          </button>
        </div>
        </div>
      </div>
    );
  };

  // Render unselected preset card for Tab 1
  const renderTab1PresetCard = (preset: ResolvedRoomPreset) => {
    const IconComponent = getRoomIcon(preset.name);

    return (
      <div
        key={`tab1-preset-${preset.roomTypeId ?? "preset"}-${preset.name}`}
        className="group relative rounded-2xl border p-4 transition-all duration-200 select-none cursor-pointer flex flex-col justify-between min-h-[120px] bg-white text-gray-900 border-gray-200 hover:border-gray-950 hover:shadow-xs"
        onClick={() => handleAddPreset(preset)}
      >
        {/* Top Bar: Icon + Room Name on Left, Plus Indicator on Right (ONE SINGLE ROW) */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gray-100 text-gray-800 group-hover:bg-gray-200 transition-colors">
              <IconComponent size={18} />
            </div>
            <p className="font-bold text-sm sm:text-base leading-snug truncate text-gray-950 min-w-0 flex-1">
              {preset.name}
            </p>
          </div>

          <span className="w-6 h-6 rounded-full border border-gray-200 group-hover:border-gray-900 flex items-center justify-center text-gray-400 group-hover:text-gray-900 transition-colors shrink-0">
            <Plus size={13} />
          </span>
        </div>

        {/* Bottom Bar: Hint & Select Action */}
        <div className="pt-2 border-t border-dashed flex items-center justify-between text-[11px] font-medium border-current/10 mt-3">
          <span className="text-gray-400">
            {preset.defaultDevicesHint || "Smart space"}
          </span>

          <span className="text-gray-400 group-hover:text-gray-900 transition-colors text-[10px] uppercase tracking-wider font-semibold">
            Select
          </span>
        </div>
      </div>
    );
  };

  // Render room card for Tab 2 (Floor / Location assignment with Drag & Drop)
  const renderTab2FloorRoomCard = (room: QuotationRoom) => {
    const roomId = Number(room.id ?? (room as any)._id);
    const displayName = getRoomDisplayName(room, existingRooms);
    const IconComponent = getRoomIcon(room.customName ?? room.roomType?.name ?? "Room");
    const isDragging = draggingRoomId === roomId;

    return (
      <div
        key={`tab2-room-${roomId}`}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", String(roomId));
          e.dataTransfer.effectAllowed = "move";
          setDraggingRoomId(roomId);
        }}
        onDragEnd={() => {
          setDraggingRoomId(null);
          setDragOverFloor(null);
        }}
        className={`group relative rounded-2xl border transition-all duration-200 select-none min-h-[125px] bg-gray-950 text-white border-accent/40 shadow-md ring-2 ring-accent/20 cursor-grab active:cursor-grabbing ${
          isDragging ? "opacity-35 scale-[0.98] ring-4 ring-accent border-accent" : ""
        }`}
      >
        <RoomBackdrop name={room.customName ?? room.roomType?.name ?? displayName} />
        <div className="relative flex h-full min-h-[125px] flex-col justify-between p-4">
        {/* Top Bar: Grip Icon + Room Icon + Room Name on Left, Cancel button on Right (ONE SINGLE ROW) */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span title="Drag to change floor">
              <GripVertical
                size={15}
                className="text-gray-300 group-hover:text-accent transition-colors shrink-0 cursor-grab"
              />
            </span>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-black/40 text-accent ring-1 ring-white/15">
              <IconComponent size={16} />
            </div>
            <p className="font-bold text-sm leading-snug truncate text-white min-w-0 flex-1">
              {displayName}
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRemovePreset(room);
            }}
            className="w-5 h-5 rounded-full bg-black/45 ring-1 ring-white/20 hover:bg-red-500/40 text-white hover:text-red-100 flex items-center justify-center transition shrink-0 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Remove space"
            aria-label={`Remove ${displayName}`}
          >
            ×
          </button>
        </div>

        {/* Middle Section: FLOOR / LOCATION Dropdown (EXACTLY ONCE, NO DUPLICATES) */}
        <div className="mt-3 space-y-1" onClick={(e) => e.stopPropagation()}>
          <label className="block text-[10px] uppercase font-bold tracking-wider text-gray-200">
            FLOOR / LOCATION
          </label>
          <FloorLocationSelect
            value={getEffectiveFloorForRoom(room, existingRooms, isMultiFloor)}
            showLabel={false}
            onChange={(newFloor) => {
              if (onUpdateRoom) {
                onUpdateRoom(roomId, { subArea: newFloor });
              }
            }}
          />
        </div>
        </div>
      </div>
    );
  };

  // Filter presets for Add Room Modal
  const modalFilteredPresets = useMemo(() => {
    if (!modalSearch.trim()) return allPresets;
    const query = modalSearch.toLowerCase().trim();
    return allPresets.filter((p) => p.name.toLowerCase().includes(query));
  }, [allPresets, modalSearch]);

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
        <div>
          <span className="text-xs uppercase tracking-widest text-gray-400 font-semibold block mb-0.5">
            Step 2 of 5
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-950 tracking-tight">
            {activeSubTab === "rooms" ? "Select Automated Spaces" : "Assign Floor / Location"}
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            {activeSubTab === "rooms" ? (
              selectedHouseType ? (
                <span>
                  Selecting spaces for <strong className="text-gray-900">{selectedHouseType.name}</strong>. Choose required rooms or add custom spaces.
                </span>
              ) : (
                "Choose the rooms and spaces in this property to automate with smart devices."
              )
            ) : (
              "Organize your selected spaces by floor or location. Drag rooms or use dropdowns."
            )}
          </p>
        </div>

        <div className="flex items-center gap-2.5 bg-white px-3.5 py-2 rounded-2xl border border-gray-200 shadow-none shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gray-950 text-white flex items-center justify-center font-bold text-xs">
            02
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Phase</p>
            <p className="text-xs font-bold text-gray-900 leading-tight">
              {activeSubTab === "rooms" ? "Space Selection" : "Floor Assignment"}
            </p>
          </div>
        </div>
      </div>

      {/* Sub-Tab Navigation Bar (Shown ONLY for Multi-Floor Properties) */}
      {isMultiFloor && (
        <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
          <button
            type="button"
            onClick={() => setActiveSubTab("rooms")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeSubTab === "rooms"
                ? "bg-gray-950 text-white shadow-xs"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
            }`}
          >
            <span>1. Select Rooms</span>
            <span className="w-5 h-5 rounded-full bg-white/20 text-white flex items-center justify-center text-[10px] font-extrabold">
              {existingRooms.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (existingRooms.length > 0) setActiveSubTab("floors");
            }}
            disabled={existingRooms.length === 0}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 disabled:opacity-40 ${
              activeSubTab === "floors"
                ? "bg-gray-950 text-white shadow-xs"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
            }`}
          >
            <span>2. Floor / Location</span>
          </button>
        </div>
      )}

      {/* Selected Rooms Count Summary Banner (Clean, NO floor locations) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-none flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-950 text-white flex items-center justify-center font-bold text-sm">
            {existingRooms.length}
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-950">
              {existingRooms.length === 0
                ? "No Spaces Selected Yet"
                : `${existingRooms.length} ${
                    existingRooms.length === 1 ? "Space" : "Spaces"
                  } Configured`}
            </h3>
            <p className="text-xs text-gray-400">
              {existingRooms.reduce((acc, r) => acc + (r.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0), 0)} devices planned across selected areas
            </p>
          </div>
        </div>

        {existingRooms.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-w-2xl">
            {existingRooms.map((r) => (
              <span
                key={r.id ?? (r as any)._id}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-gray-50 border border-gray-200 text-gray-800 text-xs font-semibold"
              >
                {getRoomDisplayName(r, existingRooms)}
                <button
                  type="button"
                  onClick={() => handleRemovePreset(r)}
                  className="hover:text-red-600 p-0.5 text-xs font-bold leading-none text-gray-400"
                  title="Remove space"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* VIEW 1: TAB 1 — SELECT ROOMS */}
      {activeSubTab === "rooms" && (
        <div className="space-y-6">
          {/* Loading Skeletons while fetching */}
          {loadingPresets && allPresets.length === 0 && (
            <div className="space-y-4">
              <div className="h-4 w-44 bg-gray-200 rounded animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-gray-200 p-4 bg-gray-50/70 animate-pulse min-h-[120px] flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-8 h-8 rounded-xl bg-gray-200" />
                      <div className="w-5 h-5 rounded-full bg-gray-200" />
                    </div>
                    <div className="h-4 w-3/4 bg-gray-200 rounded my-2" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!loadingPresets && allPresets.length === 0 && (
            <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-gray-200 bg-white">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center mb-3">
                <Layers size={24} />
              </div>
              <h3 className="text-base font-bold text-gray-900">No room presets available</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Add a custom room to continue configuring your automated spaces.
              </p>
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-950 text-white rounded-xl text-xs font-semibold hover:bg-gray-800 transition"
              >
                <Plus size={14} />
                Add Custom Room
              </button>
            </div>
          )}

          {/* Recommended Spaces for House Type */}
          {hasHouseTypeContext && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold">
                    Recommended for {selectedHouseType?.name}
                  </h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {recommendedPresets.length} presets
                  </span>
                </div>
                <span className="text-xs text-gray-400 hidden sm:inline">
                  Click a card to add space
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
                {recommendedPresets.map((preset) => {
                  const matchingRooms = existingRooms.filter((r) => {
                    const rRoomTypeId = r.roomTypeId !== undefined && r.roomTypeId !== null ? Number(r.roomTypeId) : null;
                    if (preset.roomTypeId && rRoomTypeId === Number(preset.roomTypeId)) return true;
                    if (!rRoomTypeId && r.customName && preset.name && r.customName.trim().toLowerCase() === preset.name.trim().toLowerCase()) return true;
                    return false;
                  });

                  if (matchingRooms.length > 0) {
                    return matchingRooms.map((room) => renderTab1SelectedRoomCard(room));
                  }
                  return renderTab1PresetCard(preset);
                })}
              </div>
            </div>
          )}

          {/* Additional / Available Space Presets */}
          {((hasHouseTypeContext && otherPresets.length > 0) ||
            (!hasHouseTypeContext && allPresets.length > 0)) && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold">
                  {hasHouseTypeContext ? "Additional Space Presets" : "Available Space Presets"}
                </h3>
                <span className="text-xs text-gray-400 hidden sm:inline">
                  Click a card to add space
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
                {(hasHouseTypeContext ? otherPresets : allPresets).map((preset) => {
                  const matchingRooms = existingRooms.filter((r) => {
                    const rRoomTypeId = r.roomTypeId !== undefined && r.roomTypeId !== null ? Number(r.roomTypeId) : null;
                    if (preset.roomTypeId && rRoomTypeId === Number(preset.roomTypeId)) return true;
                    if (!rRoomTypeId && r.customName && preset.name && r.customName.trim().toLowerCase() === preset.name.trim().toLowerCase()) return true;
                    return false;
                  });

                  if (matchingRooms.length > 0) {
                    return matchingRooms.map((room) => renderTab1SelectedRoomCard(room));
                  }
                  return renderTab1PresetCard(preset);
                })}

                {/* + Add Custom Room Card */}
                <div
                  className={`rounded-2xl border border-dashed transition-all duration-200 flex flex-col justify-center items-center p-4 min-h-[120px] cursor-pointer ${
                    showCustomInput
                      ? "bg-white border-gray-950 shadow-xs sm:col-span-2"
                      : "bg-gray-50/70 hover:bg-gray-100/70 border-gray-300 text-gray-700"
                  }`}
                  onClick={() => {
                    if (!showCustomInput) setShowCustomInput(true);
                  }}
                >
                  {showCustomInput ? (
                    <form
                      onSubmit={(e) => handleAddCustomRoom(e)}
                      className="w-full space-y-2.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="block text-xs font-bold text-gray-900">
                        Custom Space Name
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          autoFocus
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                          placeholder="e.g. Home Theater, Terrace, Bar"
                          className="flex-1 h-9 px-3 border border-gray-300 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-gray-950 bg-white"
                        />
                        <button
                          type="submit"
                          disabled={addingCustom || !customName.trim()}
                          className="h-9 px-3 bg-gray-950 text-white text-xs font-bold rounded-xl hover:bg-gray-800 disabled:opacity-50 transition"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCustomInput(false);
                            setCustomName("");
                          }}
                          className="h-9 px-2 text-xs text-gray-500 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="text-center py-1">
                      <div className="w-8 h-8 mx-auto rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-700 mb-1">
                        <Plus size={16} />
                      </div>
                      <p className="font-bold text-xs sm:text-sm text-gray-900">+ Add Custom Room</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: TAB 2 — FLOOR / LOCATION (Multi-Floor Properties Only) */}
      {activeSubTab === "floors" && isMultiFloor && (
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-1 border-b border-gray-200">
            <div>
              <h3 className="text-xs uppercase tracking-wider text-gray-900 font-extrabold flex items-center gap-2">
                <Layers size={14} className="text-accent" />
                Floor / Location Assignment
              </h3>
              <p className="text-xs text-gray-500 font-medium mt-0.5">
                Organize your selected rooms by floor. Drag cards between sections or use the dropdowns.
              </p>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-xl bg-gray-950 text-white shadow-2xs">
              {existingRooms.length} {existingRooms.length === 1 ? "Space" : "Spaces"}
            </span>
          </div>

          {/* Render Floor Sections Grouped Floorwise */}
          <div className="space-y-5">
            {groupRoomsByFloor(existingRooms, isMultiFloor).map((group: { floor: string; rooms: QuotationRoom[] }) => {
              const rawFloor = group.floor?.trim() || "Unspecified Location";
              const floorTitle = rawFloor.toUpperCase();
              const isUnspecified = rawFloor.toLowerCase() === "unspecified location";
              const isOther = rawFloor.toLowerCase() === "other";
              const floorSubtitle = isUnspecified
                ? "Rooms needing floor assignment"
                : isOther
                ? "Rooms in Other Locations"
                : `Rooms on ${rawFloor}`;

              const isTargetOver = dragOverFloor === group.floor;

              return (
                <div
                  key={group.floor}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragOverFloor(group.floor);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverFloor(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFloor(null);
                    const droppedIdStr = e.dataTransfer.getData("text/plain");
                    const targetRoomId = Number(droppedIdStr || draggingRoomId);
                    if (targetRoomId) {
                      handleMoveRoomToFloor(targetRoomId, rawFloor);
                    }
                    setDraggingRoomId(null);
                  }}
                  className={`space-y-3.5 p-4 rounded-2xl transition-all duration-200 ${
                    isTargetOver
                      ? "bg-accent/10 border-2 border-dashed border-accent ring-4 ring-accent/20 shadow-md"
                      : isUnspecified
                      ? "bg-amber-50/50 border border-amber-200/80"
                      : "bg-white border border-gray-200/90 shadow-2xs"
                  }`}
                >
                  {/* Floor Section Header */}
                  <div className="flex items-center justify-between px-1 border-b border-gray-100 pb-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gray-950 text-accent flex items-center justify-center shrink-0 shadow-2xs">
                        <Building size={14} />
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-gray-950 tracking-wider uppercase flex items-center gap-2">
                          <span>{floorTitle}</span>
                        </h4>
                        <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                          {floorSubtitle}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-xl bg-gray-100 text-gray-700 border border-gray-200">
                        {group.rooms.length} {group.rooms.length === 1 ? "Space" : "Spaces"}
                      </span>

                      <button
                        type="button"
                        onClick={() => setAddRoomModalFloor(rawFloor)}
                        className="px-2.5 py-1 bg-gray-950 text-white hover:bg-gray-800 text-[11px] font-bold rounded-xl transition inline-flex items-center gap-1 shadow-2xs"
                      >
                        <Plus size={12} />
                        <span>Add Room</span>
                      </button>
                    </div>
                  </div>

                  {/* Floor Section Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
                    {group.rooms.map((room: QuotationRoom) => renderTab2FloorRoomCard(room))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ADD ROOM MODAL FOR TAB 2 */}
      {addRoomModalFloor !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => {
            setAddRoomModalFloor(null);
            setModalSearch("");
            setModalShowCustom(false);
          }}
        >
          <div
            className="bg-white rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-gray-200 space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-extrabold text-gray-950 flex items-center gap-2">
                  <Plus size={18} className="text-accent" />
                  <span>Add Room to <span className="text-accent">{addRoomModalFloor}</span></span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Select a room preset or add a custom space. It will default to <strong className="text-gray-900">{addRoomModalFloor}</strong>.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAddRoomModalFloor(null);
                  setModalSearch("");
                  setModalShowCustom(false);
                }}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center text-sm font-bold transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Search Bar */}
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                placeholder="Search room types (Living Room, Bedroom, Kitchen...)..."
                className="w-full h-10 pl-9 pr-4 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-950 focus:bg-white transition"
              />
            </div>

            {/* Modal Presets Grid */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {modalFilteredPresets.map((preset) => {
                  const IconComponent = getRoomIcon(preset.name);
                  return (
                    <button
                      key={`modal-preset-${preset.roomTypeId ?? "preset"}-${preset.name}`}
                      type="button"
                      onClick={async () => {
                        const targetFloor = addRoomModalFloor;
                        setAddRoomModalFloor(null);
                        setModalSearch("");
                        await handleAddPreset(preset, targetFloor);
                      }}
                      className="flex items-center gap-3 p-3.5 rounded-2xl border border-gray-200 hover:border-gray-950 hover:bg-gray-50 transition text-left group shadow-2xs"
                    >
                      <div className="w-9 h-9 rounded-xl bg-gray-100 group-hover:bg-gray-950 group-hover:text-accent text-gray-800 flex items-center justify-center shrink-0 transition-colors">
                        <IconComponent size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-xs sm:text-sm text-gray-950 truncate">
                          {preset.name}
                        </p>
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">
                          {preset.defaultDevicesHint || "Smart space"}
                        </p>
                      </div>
                      <span className="w-6 h-6 rounded-full bg-gray-100 group-hover:bg-gray-950 group-hover:text-white flex items-center justify-center text-xs font-bold transition">
                        +
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Add Custom Room inside Modal */}
              <div className="pt-2 border-t border-gray-100">
                {modalShowCustom ? (
                  <form
                    onSubmit={(e) => handleAddCustomRoom(e, addRoomModalFloor)}
                    className="p-3.5 rounded-2xl border border-gray-950 bg-gray-50/70 space-y-2.5"
                  >
                    <label className="block text-xs font-bold text-gray-900">
                      Custom Space Name for {addRoomModalFloor}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={modalCustomName}
                        onChange={(e) => setModalCustomName(e.target.value)}
                        placeholder="e.g. Home Theater, Terrace, Bar"
                        className="flex-1 h-9 px-3 border border-gray-300 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-gray-950 bg-white"
                      />
                      <button
                        type="submit"
                        disabled={addingCustom || !modalCustomName.trim()}
                        className="h-9 px-3 bg-gray-950 text-white text-xs font-bold rounded-xl hover:bg-gray-800 disabled:opacity-50 transition"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setModalShowCustom(false);
                          setModalCustomName("");
                        }}
                        className="h-9 px-2 text-xs text-gray-500 hover:text-gray-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setModalShowCustom(true)}
                    className="w-full py-3 px-4 rounded-2xl border border-dashed border-gray-300 hover:border-gray-950 hover:bg-gray-50 transition text-xs font-bold text-gray-800 inline-flex items-center justify-center gap-2"
                  >
                    <Plus size={14} />
                    <span>+ Add Custom Space to {addRoomModalFloor}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-6 border-t border-gray-100">
        {activeSubTab === "floors" ? (
          <button
            type="button"
            onClick={() => setActiveSubTab("rooms")}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 font-semibold text-sm rounded-xl hover:bg-gray-50 transition"
          >
            <ArrowLeft size={16} />
            Back to Select Rooms
          </button>
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 font-semibold text-sm rounded-xl hover:bg-gray-50 transition"
          >
            <ArrowLeft size={16} />
            Back to Project Details
          </button>
        )}

        {isMultiFloor && activeSubTab === "rooms" ? (
          <button
            type="button"
            onClick={() => setActiveSubTab("floors")}
            disabled={existingRooms.length === 0 || isLoading}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 bg-gray-950 text-white font-semibold text-sm rounded-xl hover:bg-gray-800 active:scale-[0.99] transition shadow-sm disabled:opacity-40"
          >
            <span>Next: Assign Floor / Location</span>
            <ArrowRight size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onContinue}
            disabled={existingRooms.length === 0 || isLoading}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 bg-gray-950 text-white font-semibold text-sm rounded-xl hover:bg-gray-800 active:scale-[0.99] transition shadow-sm disabled:opacity-40"
          >
            <span>Continue to Configure Products</span>
            <ArrowRight size={16} />
          </button>
        )}
      </div>

      {/* Delete confirmation is raised through the global ConfirmProvider portal. */}
    </div>
  );
}

const ROOM_CARD_IMAGE_SIZES = "(min-width: 1536px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw";

/** Decorative room photo + flat dark overlay. Self-clipping so card popovers (floor dropdown) are not cut off. */
function RoomBackdrop({ name }: { name: string }) {
  const entry = getRoomImage(name);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <Image
        src={roomImageSrc(entry)}
        alt=""
        fill
        sizes={ROOM_CARD_IMAGE_SIZES}
        className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        style={{ objectPosition: `50% ${Math.round(entry.focalY * 100)}%` }}
      />
      <div className="absolute inset-0 bg-gray-950/65" />
    </div>
  );
}
