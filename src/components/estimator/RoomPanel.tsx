"use client";
import { useState } from "react";
import { Quotation, QuotationRoom, RoomType } from "@/types";
import { formatCurrency, isBathroomLikeRoomName, getRoomIcon } from "@/lib/utils";
import { Plus, Trash2, ChevronRight, ChevronLeft } from "lucide-react";
import Modal from "@/components/shared/Modal";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import notify from "@/lib/notify";
import { Select } from "@/components/ui/Select";

interface Props {
  quotation: Quotation;
  roomTypes: RoomType[];
  activeRoomId: number | null;
  onSelectRoom: (id: number) => void;
  onAddRoom: (roomTypeId: number | null, customName?: string) => Promise<void>;
  onDeleteRoom: (id: number) => Promise<void>;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function RoomPanel({
  quotation,
  roomTypes,
  activeRoomId,
  onSelectRoom,
  onAddRoom,
  onDeleteRoom,
  isCollapsed = false,
  onToggleCollapse,
}: Props) {
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>("");
  const [customRoomName, setCustomRoomName] = useState("");
  const [adding, setAdding] = useState(false);
  const confirm = useConfirm();

  const getRoomName = (room: QuotationRoom) =>
    room.customName ?? room.roomType?.name ?? "Room";

  const handleDeleteRoom = async (room: QuotationRoom) => {
    await confirm({
      title: "Delete Room",
      message: `Delete "${getRoomName(room)}" and all its items?`,
      detail: "This cannot be undone.",
      confirmText: "Delete Room",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: async () => {
        try {
          await onDeleteRoom(room.id);
        } catch {
          notify.error("Unable to delete room", "Failed to delete this room. Please try again.");
        }
      },
    });
  };

  const getRoomSubtotal = (room: QuotationRoom) =>
    room.items.reduce((sum, item) => sum + item.quantity * Number(item.unitPrice), 0);

  const getRoomInitials = (name: string) => {
    const parts = name.split(/[\s/_]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const handleAdd = async () => {
    if (!selectedRoomTypeId && !customRoomName.trim()) return;
    setAdding(true);
    try {
      const roomTypeId = selectedRoomTypeId ? Number(selectedRoomTypeId) : null;
      const custom = !selectedRoomTypeId ? customRoomName.trim() : undefined;
      await onAddRoom(roomTypeId, custom);
      setSelectedRoomTypeId("");
      setCustomRoomName("");
      setShowAddRoom(false);
    } finally {
      setAdding(false);
    }
  };

  const handleCloseModal = () => {
    setShowAddRoom(false);
    setSelectedRoomTypeId("");
    setCustomRoomName("");
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all duration-300">
      {/* Header */}
      <div className={`px-4 py-3 md:px-5 md:py-4 border-b border-gray-100 flex items-center ${isCollapsed ? "justify-center" : "justify-between"}`}>
        {!isCollapsed && <h2 className="font-semibold text-gray-800 text-sm md:text-base lg:text-lg">Rooms</h2>}
        {!isCollapsed && <span className="text-xs md:text-sm text-gray-400 mr-2">{quotation.rooms.length}</span>}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
      </div>

      {/* Room List */}
      <div className="flex-1 overflow-y-auto">
        {quotation.rooms.length === 0 && !isCollapsed && (
          <div className="p-4 md:p-5 text-center text-gray-400 text-xs md:text-sm">No rooms yet. Add a room to begin.</div>
        )}
        {quotation.rooms.map((room) => {
          const isActive = room.id === activeRoomId;
          const subtotal = getRoomSubtotal(room);
          const roomName = getRoomName(room);

          if (isCollapsed) {
            return (
              <div
                key={room.id}
                onClick={() => onSelectRoom(room.id)}
                className={`flex items-center justify-center py-4 cursor-pointer border-b border-gray-50 transition-all group relative ${
                  isActive ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
                title={roomName}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all ${
                  isActive ? "bg-whyte-blue text-white shadow-xs" : "bg-gray-100 text-gray-500 group-hover:bg-gray-200"
                }`}>
                  {getRoomInitials(roomName)}
                </div>
                {/* Floating indicator for items count */}
                {room.items.length > 0 && (
                  <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center scale-90">
                    {room.items.length}
                  </span>
                )}
              </div>
            );
          }

          return (
            <div
              key={room.id}
              onClick={() => onSelectRoom(room.id)}
              className={`group flex items-center justify-between px-3 py-3 md:px-4 md:py-3.5 lg:px-5 lg:py-4 cursor-pointer border-b border-gray-50 transition-all ${
                isActive ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-2 md:gap-2.5 min-w-0">
                {isActive && <ChevronRight size={14} className="text-whyte-blue shrink-0" />}
                <div className="min-w-0">
                  <p className={`text-sm md:text-base font-bold truncate ${isActive ? "text-whyte-blue" : "text-gray-800"}`}>
                    {roomName}
                  </p>
                  <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-gray-400">
                    <span>{room.items.length} items</span>
                    {subtotal > 0 && <span>• {formatCurrency(subtotal)}</span>}
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room); }}
                className="opacity-0 group-hover:opacity-100 p-1 md:p-1.5 text-gray-300 hover:text-red-500 transition rounded-lg"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Add Room */}
      <div className="p-3 border-t border-gray-100 flex justify-center">
        {isCollapsed ? (
          <button
            onClick={() => setShowAddRoom(true)}
            className="w-10 h-10 flex items-center justify-center text-whyte-blue rounded-full border border-dashed border-blue-200 hover:bg-blue-50 transition"
            title="Add Room"
          >
            <Plus size={18} />
          </button>
        ) : (
          <button
            onClick={() => setShowAddRoom(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm text-whyte-blue font-medium rounded-xl border border-dashed border-blue-200 hover:bg-blue-50 transition"
          >
            <Plus size={15} />
            Add Room
          </button>
        )}
      </div>

      {/* Add Room Modal */}
      <Modal isOpen={showAddRoom} onClose={handleCloseModal} title="Add Room" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Room Type
            </label>
            <Select
              value={selectedRoomTypeId}
              onChange={(e) => {
                setSelectedRoomTypeId(e.target.value);
                if (e.target.value) setCustomRoomName("");
              }}
              triggerClassName="h-10 rounded-xl text-sm border-gray-200"
              placeholder="— Other (Custom Name) —"
              options={[
                { value: "", label: "— Other (Custom Name) —" },
                ...roomTypes
                  .filter((rt) => rt.isActive && !isBathroomLikeRoomName(rt.name))
                  .map((rt) => ({ value: String(rt.id), label: rt.name })),
              ]}
            />
          </div>

          {!selectedRoomTypeId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Custom Room Name
              </label>
              <input
                autoFocus
                type="text"
                value={customRoomName}
                onChange={(e) => setCustomRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
                }}
                placeholder="e.g. Master Bedroom, Terrace"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}

          <button
            onClick={handleAdd}
            disabled={adding || (!selectedRoomTypeId && !customRoomName.trim())}
            className="w-full py-2.5 bg-whyte-blue text-white font-semibold rounded-xl hover:bg-whyte-light transition disabled:opacity-50"
          >
            {adding ? "Adding..." : "Add Room"}
          </button>
        </div>
      </Modal>

    </div>
  );
}
