"use client";
import { useState } from "react";
import { RoomType } from "@/types";
import { Plus, Pencil, ToggleLeft, ToggleRight } from "lucide-react";
import { getRoomIcon } from "@/lib/utils";
import notify from "@/lib/notify";
import Modal from "@/components/shared/Modal";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useRoomTypes } from "@/lib/swr";
import { Input, Button } from "@/components/ui";

function RoomTypeForm({ roomType, onSuccess }: { roomType?: RoomType | null; onSuccess: () => void }) {
  const [name, setName] = useState(roomType?.name ?? "");
  const icon = roomType?.icon ?? "";
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = roomType ? `/api/room-types/${roomType.id}` : "/api/room-types";
      const res = await fetch(url, {
        method: roomType ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon, sortOrder: 0, isActive: true }),
      });
      if (!res.ok) throw new Error();
      notify.success(
        roomType ? "Room type updated" : "Room type created",
        roomType ? "Room type details have been saved." : "New room type created successfully."
      );
      onSuccess();
    } catch {
      notify.error("Unable to save room type", "Please check your inputs and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Room Name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Living Room"
      />
      <Button
        type="submit"
        loading={saving}
        fullWidth
        variant="primary"
        size="md"
      >
        {roomType ? "Update" : "Create Room Type"}
      </Button>
    </form>
  );
}

export default function RoomTypesPage() {
  const { data: roomTypes = [], isLoading: loading, mutate } = useRoomTypes();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<RoomType | null>(null);

  const handleToggle = async (rt: RoomType) => {
    try {
      const res = await fetch(`/api/room-types/${rt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rt.isActive }),
      });
      if (!res.ok) throw new Error();
      mutate();
      notify.success(
        !rt.isActive ? "Room type activated" : "Room type deactivated",
        !rt.isActive ? "Room type is now active in quotations." : "Room type has been deactivated."
      );
    } catch {
      notify.error("Status update failed", "Unable to update room type status. Please try again.");
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Room Types</h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">{roomTypes.length} room types</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-black text-white rounded-xl font-medium text-sm hover:bg-neutral-800 transition-colors w-full sm:w-auto shadow-2xs"
        >
          <Plus size={16} />
          Add Room Type
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-xs border border-neutral-200 overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y divide-neutral-100">
          {roomTypes.map((rt: RoomType) => {
            const RoomIcon = getRoomIcon(rt.name);
            return (
              <div key={rt.id} className={`flex items-center justify-between px-3 sm:px-4 py-3 sm:border-r border-neutral-100 hover:bg-neutral-50/80 transition-colors ${!rt.isActive ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <RoomIcon size={16} className="text-neutral-500 shrink-0" />
                  <span className="text-sm font-medium text-neutral-800 truncate">{rt.name}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditTarget(rt); setShowForm(true); }} className="p-1.5 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleToggle(rt)} className="text-neutral-400 hover:text-neutral-600 transition">
                    {rt.isActive ? <ToggleRight size={22} className="text-admin-primary" /> : <ToggleLeft size={22} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditTarget(null); }}
        title={editTarget ? "Edit Room Type" : "Add Room Type"}
      >
        <RoomTypeForm
          roomType={editTarget}
          onSuccess={() => { setShowForm(false); setEditTarget(null); mutate(); }}
        />
      </Modal>
    </div>
  );
}
