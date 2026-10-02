"use client";
import { Quotation, QuotationRoom } from "@/types";
import { Plus } from "lucide-react";
import { getRoomIcon } from "@/lib/utils";

interface Props {
  quotation: Quotation;
  activeRoomId: number | null;
  onSelectRoom: (id: number) => void;
  onAddRoomClick: () => void;
}

export default function MobileRoomSelector({ quotation, activeRoomId, onSelectRoom, onAddRoomClick }: Props) {
  const getRoomName = (room: QuotationRoom) =>
    room.customName ?? room.roomType?.name ?? "Room";

  return (
    <div className="lg:hidden w-full bg-slate-50 border-b border-gray-150 py-2.5 px-4 overflow-x-auto scrollbar-none flex items-center gap-2">
      {quotation.rooms.map((room) => {
        const isActive = room.id === activeRoomId;
        const itemCount = room.items.length;
        const roomName = getRoomName(room);
        const RoomIcon = getRoomIcon(roomName);

        return (
          <button
            key={room.id}
            onClick={() => onSelectRoom(room.id)}
            className={`whitespace-nowrap flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all shrink-0 ${
              isActive
                ? "bg-whyte-blue text-white border-whyte-blue shadow-sm shadow-blue-500/10"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
            }`}
          >
            <span>{roomName}</span>
            <span
              className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] ${
                isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
              }`}
            >
              {itemCount}
            </span>
          </button>
        );
      })}

      <button
        onClick={onAddRoomClick}
        className="whitespace-nowrap flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-blue-50 text-whyte-blue border border-dashed border-blue-200 hover:bg-blue-100 transition-colors shrink-0"
      >
        <Plus size={12} />
        Add Room
      </button>
    </div>
  );
}
