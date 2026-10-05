"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Check,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Layers,
  Sparkles,
  Home,
} from "lucide-react";
import { RoomType, HouseType, Quotation, QuotationRoom } from "@/types";
import { getRoomIcon, formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import notify from "@/lib/notify";
import {
  resolveRoomPresets,
  ResolvedRoomPreset,
} from "@/lib/roomPresetsFallback";

interface Props {
  quotation: Quotation;
  roomTypes: RoomType[];
  houseTypes?: HouseType[];
  onAddRoom: (roomTypeId: number | null, customName?: string) => Promise<void>;
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
  onDeleteRoom,
  onContinue,
  onBack,
  isLoading = false,
}: Props) {
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const confirm = useConfirm();

  // Dynamic server-fetched room presets & loading state
  const [serverPresets, setServerPresets] = useState<{
    recommended: ResolvedRoomPreset[];
    other: ResolvedRoomPreset[];
    all: ResolvedRoomPreset[];
  } | null>(null);
  const [loadingPresets, setLoadingPresets] = useState(false);

  // Existing rooms in this quotation
  const existingRooms = quotation.rooms || [];
  const customRooms = existingRooms.filter((r) => r.roomTypeId === null);

  // Identify selected house type from Step 1 context
  const selectedHouseType = useMemo(() => {
    if (!quotation.houseTypeId || houseTypes.length === 0) return null;
    return (
      houseTypes.find((ht) => (ht.id ?? (ht as any)._id) === quotation.houseTypeId) ||
      null
    );
  }, [quotation.houseTypeId, houseTypes]);

  // Initial client-side fallback & DB-driven preset resolution
  const localResolved = useMemo(() => {
    return resolveRoomPresets({
      houseType: selectedHouseType,
      allRoomTypes: initialRoomTypes,
    });
  }, [selectedHouseType, initialRoomTypes]);

  // Fetch updated room presets from /api/room-presets (skipping global Whyte loader)
  useEffect(() => {
    let isMounted = true;
    const fetchPresets = async () => {
      // If we don't have DB roomTypes yet or want fresh server-side template resolution
      try {
        setLoadingPresets(true);
        const query = quotation.houseTypeId ? `?houseTypeId=${quotation.houseTypeId}` : "";
        const res = await fetch(`/api/room-presets${query}`, {
          headers: {
            "x-skip-api-loader": "true",
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setServerPresets({
              recommended: data.recommendedPresets || [],
              other: data.otherPresets || [],
              all: data.allPresets || [],
            });
          }
        }
      } catch (err) {
        console.warn("[StepSelectSpaces] Failed to load server room presets, using local resolution:", err);
      } finally {
        if (isMounted) setLoadingPresets(false);
      }
    };

    fetchPresets();
    return () => {
      isMounted = false;
    };
  }, [quotation.houseTypeId]);

  // Effective presets: prefer server presets when available, fallback to local resolution
  const recommendedPresets = serverPresets
    ? serverPresets.recommended
    : localResolved.recommendedPresets;

  const otherPresets = serverPresets
    ? serverPresets.other
    : localResolved.otherPresets;

  const allPresets = serverPresets
    ? serverPresets.all
    : localResolved.allPresets;

  const hasHouseTypeContext = Boolean(selectedHouseType && recommendedPresets.length > 0);

  // Add a standard room preset
  const handleAddPreset = async (preset: ResolvedRoomPreset) => {
    await onAddRoom(preset.roomTypeId ? Number(preset.roomTypeId) : null, preset.name);
  };

  // Remove a room (prompts if room has configured items, unselects immediately if empty)
  const handleRemovePreset = async (room: QuotationRoom) => {
    const roomId = Number(room.id ?? (room as any)._id);
    if (!roomId) return;

    if (room.items && room.items.length > 0) {
      await confirm({
        title: "Remove Space",
        message: `Are you sure you want to remove "${
          room.customName ?? room.roomType?.name
        }"?`,
        detail: "Any products assigned to this space will be deleted.",
        confirmText: "Remove Space",
        cancelText: "Cancel",
        variant: "danger",
        onConfirm: async () => {
          try {
            await onDeleteRoom(roomId);
          } catch {
            notify.error("Unable to remove space", "Failed to remove this space. Please try again.");
          }
        },
      });
    } else {
      await onDeleteRoom(roomId);
    }
  };

  // Add custom room handler
  const handleAddCustomRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    setAddingCustom(true);
    try {
      await onAddRoom(null, customName.trim());
      setCustomName("");
      setShowCustomInput(false);
    } finally {
      setAddingCustom(false);
    }
  };

  const getRoomSubtotal = (room: QuotationRoom) =>
    (room.items || []).reduce((acc, item) => acc + (item.quantity || 1) * Number(item.unitPrice || 0), 0);

  // Render an individual Preset Card
  const renderPresetCard = (preset: ResolvedRoomPreset) => {
    const IconComponent = getRoomIcon(preset.name);

    // Match rooms in this quotation matching preset roomTypeId or matching custom name
    const matchingRooms = existingRooms.filter((r) => {
      const rRoomTypeId = r.roomTypeId !== undefined && r.roomTypeId !== null ? Number(r.roomTypeId) : null;
      if (preset.roomTypeId && rRoomTypeId === Number(preset.roomTypeId)) return true;
      if (!rRoomTypeId && r.customName && preset.name && r.customName.trim().toLowerCase() === preset.name.trim().toLowerCase()) return true;
      return false;
    });

    const isSelected = matchingRooms.length > 0;
    const totalItems = matchingRooms.reduce((acc, r) => acc + (r.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0), 0);

    return (
      <div
        key={`${preset.roomTypeId ?? "preset"}-${preset.name}`}
        className={`group relative rounded-2xl border p-4 transition-all duration-200 select-none cursor-pointer flex flex-col justify-between min-h-[145px] sm:min-h-[155px] ${
          isSelected
            ? "bg-gray-950 text-white border-accent/40 shadow-md ring-2 ring-accent/20"
            : "bg-white text-gray-900 border-gray-200 hover:border-gray-950 hover:shadow-xs"
        }`}
        onClick={() => {
          if (!isSelected) {
            handleAddPreset(preset);
          } else if (matchingRooms.length === 1) {
            // Smooth toggle: unselect if single instance
            handleRemovePreset(matchingRooms[0]);
          } else {
            // Multiple instances: add another
            handleAddPreset(preset);
          }
        }}
      >
        {/* Top Bar: Icon & Selection Indicators */}
        <div className="flex items-center justify-between">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
              isSelected
                ? "bg-white/10 text-accent"
                : "bg-gray-100 text-gray-800 group-hover:bg-gray-200"
            }`}
          >
            <IconComponent size={18} />
          </div>

          {isSelected ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {matchingRooms.length > 1 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent/20 text-accent-light border border-accent/30">
                  ×{matchingRooms.length}
                </span>
              )}
              <span className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center text-xs font-black shadow-2xs">
                <Check size={12} strokeWidth={3} />
              </span>
              <button
                type="button"
                onClick={() => handleRemovePreset(matchingRooms[matchingRooms.length - 1])}
                className="w-5 h-5 rounded-full bg-white/10 hover:bg-red-500/20 text-gray-300 hover:text-red-300 flex items-center justify-center transition ml-0.5 text-xs font-bold"
                title="Unselect room"
              >
                ×
              </button>
            </div>
          ) : (
            <span className="w-6 h-6 rounded-full border border-gray-200 group-hover:border-gray-900 flex items-center justify-center text-gray-400 group-hover:text-gray-900 transition-colors">
              <Plus size={13} />
            </span>
          )}
        </div>

        {/* Room Name & Description */}
        <div className="my-2.5">
          <p
            className={`font-bold text-sm sm:text-base leading-snug truncate ${
              isSelected ? "text-white" : "text-gray-950"
            }`}
          >
            {preset.name}
          </p>
          <p
            className={`text-xs mt-0.5 font-normal line-clamp-2 leading-relaxed ${
              isSelected ? "text-gray-300" : "text-gray-500"
            }`}
          >
            {preset.description}
          </p>
        </div>

        {/* Bottom Bar: Device Hint & Action */}
        <div className="pt-2 border-t border-dashed flex items-center justify-between text-[11px] font-medium border-current/10">
          <span className={isSelected ? "text-gray-400" : "text-gray-400"}>
            {isSelected
              ? totalItems > 0
                ? `${totalItems} ${totalItems === 1 ? "device" : "devices"} configured`
                : "Selected space"
              : preset.defaultDevicesHint || "Smart space"}
          </span>

          {isSelected ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleAddPreset(preset);
              }}
              className="text-[10px] uppercase font-bold text-gray-300 hover:text-white underline-offset-2 hover:underline transition"
              title="Add another instance of this space"
            >
              + Add another
            </button>
          ) : (
            <span className="text-gray-400 group-hover:text-gray-900 transition-colors text-[10px] uppercase tracking-wider font-semibold">
              Select
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
        <div>
          <span className="text-xs uppercase tracking-widest text-gray-400 font-semibold block mb-0.5">
            Step 2 of 5
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-950 tracking-tight">
            Select Automated Spaces
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            {selectedHouseType ? (
              <span>
                Configuring spaces for{" "}
                <strong className="text-gray-900">{selectedHouseType.name}</strong>. Choose
                predefined spaces or add custom rooms to automate.
              </span>
            ) : (
              "Choose the rooms and spaces in this property to automate with smart devices."
            )}
          </p>
        </div>

        <div className="flex items-center gap-2.5 bg-white px-3.5 py-2 rounded-2xl border border-gray-200 shadow-none shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gray-950 text-white flex items-center justify-center font-bold text-xs">
            02
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Phase</p>
            <p className="text-xs font-bold text-gray-900 leading-tight">Space Selection</p>
          </div>
        </div>
      </div>

      {/* Selected Rooms Count Summary Banner */}
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
              {existingRooms.reduce((acc, r) => acc + (r.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0), 0)} devices planned across
              selected areas
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
                {r.customName ?? r.roomType?.name ?? "Room"}
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

      {/* Loading Skeletons while fetching */}
      {loadingPresets && allPresets.length === 0 && (
        <div className="space-y-4">
          <div className="h-4 w-44 bg-gray-200 rounded animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-gray-200 p-4 bg-gray-50/70 animate-pulse min-h-[145px] flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <div className="w-9 h-9 rounded-xl bg-gray-200" />
                  <div className="w-6 h-6 rounded-full bg-gray-200" />
                </div>
                <div className="space-y-2 my-2">
                  <div className="h-4 w-3/4 bg-gray-200 rounded" />
                  <div className="h-3 w-full bg-gray-200 rounded" />
                </div>
                <div className="h-3 w-1/3 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State if genuinely zero presets */}
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

      {/* Recommended Spaces for Selected House Type */}
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
              Click a card to add or unselect
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
            {recommendedPresets.map((preset) => renderPresetCard(preset))}
          </div>
        </div>
      )}

      {/* Additional / All Spaces Grid */}
      {((hasHouseTypeContext && otherPresets.length > 0) ||
        (!hasHouseTypeContext && allPresets.length > 0)) && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold">
              {hasHouseTypeContext ? "Additional Space Presets" : "Available Space Presets"}
            </h3>
            <span className="text-xs text-gray-400 hidden sm:inline">
              Click a card to add or unselect
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
            {(hasHouseTypeContext ? otherPresets : allPresets).map((preset) =>
              renderPresetCard(preset)
            )}

            {/* + Add Custom Room Card (Visually distinct at the end of the preset cards) */}
            <div
              className={`rounded-2xl border border-dashed transition-all duration-200 flex flex-col justify-center items-center p-4 min-h-[145px] sm:min-h-[155px] cursor-pointer ${
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
                  onSubmit={handleAddCustomRoom}
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
                <div className="text-center py-2">
                  <div className="w-9 h-9 mx-auto rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-700 mb-2">
                    <Plus size={18} />
                  </div>
                  <p className="font-bold text-xs sm:text-sm text-gray-900">+ Add Custom Room</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Theater, Terrace, Wine Cellar...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Rooms Section (if any were created by user) */}
      {customRooms.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-gray-100">
          <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold px-1">
            Custom Spaces Added ({customRooms.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5">
            {customRooms.map((room) => {
              const subtotal = getRoomSubtotal(room);
              const deviceCount = (room.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
              return (
                <div
                  key={room.id ?? (room as any)._id}
                  className="bg-gray-950 text-white rounded-2xl p-4 shadow-xs relative group flex flex-col justify-between min-h-[135px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30">
                      Custom Space
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemovePreset(room)}
                      className="p-1 text-gray-400 hover:text-red-400 rounded-md transition"
                      title="Remove custom room"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="mt-3">
                    <p className="font-bold text-sm sm:text-base truncate">{room.customName}</p>
                    <p className="text-xs text-gray-300 mt-0.5">
                      {deviceCount} {deviceCount === 1 ? "device" : "devices"}
                      {subtotal > 0 && ` • ${formatCurrency(subtotal)}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-6 border-t border-gray-100">
        <button
          type="button"
          onClick={onBack}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 font-semibold text-sm rounded-xl hover:bg-gray-50 transition"
        >
          <ArrowLeft size={16} />
          Back to Project Details
        </button>

        <button
          type="button"
          onClick={onContinue}
          disabled={existingRooms.length === 0 || isLoading}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 bg-gray-950 text-white font-semibold text-sm rounded-xl hover:bg-gray-800 active:scale-[0.99] transition shadow-sm disabled:opacity-40"
        >
          <span>Continue to Configure Products</span>
          <ArrowRight size={16} />
        </button>
      </div>

      {/* Delete confirmation is raised through the global ConfirmProvider portal. */}
    </div>
  );
}
