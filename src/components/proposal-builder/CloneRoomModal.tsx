"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { Button } from "@/components/ui";
import { Copy, Check, AlertCircle } from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { QuotationRoom } from "@/types";
import { getRoomDisplayName } from "@/lib/roomUtils";

interface CloneRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  quotationId: string;
  sourceRoom: QuotationRoom | null;
  allRooms: QuotationRoom[];
  onRoomsUpdated: (updatedRooms: QuotationRoom[]) => void;
}

export default function CloneRoomModal({
  isOpen,
  onClose,
  quotationId,
  sourceRoom,
  allRooms,
  onRoomsUpdated,
}: CloneRoomModalProps) {
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<number>>(new Set());
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  if (!sourceRoom) return null;

  const sourceRoomId = Number(sourceRoom.id ?? (sourceRoom as any)._id);
  const sourceItemsCount = sourceRoom.items?.length || 0;
  const sourceName = getRoomDisplayName(sourceRoom);

  // Other rooms in the same quotation
  const eligibleTargetRooms = allRooms.filter(
    (r) => Number(r.id ?? (r as any)._id) !== sourceRoomId
  );

  const toggleTarget = (id: number) => {
    setSelectedTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedTargetIds.size === eligibleTargetRooms.length) {
      setSelectedTargetIds(new Set());
    } else {
      setSelectedTargetIds(new Set(eligibleTargetRooms.map((r) => Number(r.id ?? (r as any)._id))));
    }
  };

  const handleClone = async () => {
    if (selectedTargetIds.size === 0) {
      notify.error("Select destinations", "Please pick at least one room to copy devices into.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiJson.post<{ rooms: QuotationRoom[]; message: string }>(
        `/api/quotations/${quotationId}/rooms/${sourceRoomId}/clone-to`,
        {
          targetRoomIds: Array.from(selectedTargetIds),
          replaceExisting,
        }
      );

      if (res?.rooms) {
        onRoomsUpdated(res.rooms);
      }

      notify.success("Rooms duplicated", res?.message || "Successfully cloned devices to selected rooms.");
      onClose();
    } catch (err) {
      notifyApiError(err, "Failed to copy room devices");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Duplicate "${sourceName}" to Other Rooms`}
      size="md"
    >
      <div className="space-y-4 pt-1">
        <div className="rounded-xl border border-neutral-200/90 bg-neutral-50/70 p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Source Space</span>
            <p className="text-sm font-extrabold text-neutral-900">{sourceName}</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-accent/10 text-accent border border-accent/20">
            {sourceItemsCount} {sourceItemsCount === 1 ? "device" : "devices"} configured
          </span>
        </div>

        {sourceItemsCount === 0 ? (
          <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
            <p>
              This room doesn&apos;t have any devices yet. Add smart switches or products to <strong>{sourceName}</strong> first, then you can copy them anywhere.
            </p>
          </div>
        ) : eligibleTargetRooms.length === 0 ? (
          <p className="text-xs text-neutral-500 py-3 text-center">
            No other rooms found in this proposal. Add more spaces in Step 2 to duplicate.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-800">
                Select Destination Rooms ({selectedTargetIds.size} selected)
              </span>
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-accent font-semibold hover:underline"
              >
                {selectedTargetIds.size === eligibleTargetRooms.length ? "Deselect All" : "Select All"}
              </button>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 border border-neutral-200/80 rounded-xl p-2 bg-white">
              {eligibleTargetRooms.map((room) => {
                const rId = Number(room.id ?? (room as any)._id);
                const isSelected = selectedTargetIds.has(rId);
                const rName = getRoomDisplayName(room);
                const rCount = room.items?.length || 0;

                return (
                  <label
                    key={rId}
                    className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition ${
                      isSelected
                        ? "bg-accent/5 border-accent/40 text-neutral-900"
                        : "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTarget(rId)}
                        className="rounded border-neutral-300 text-accent focus:ring-accent h-4 w-4"
                      />
                      <span className="text-xs font-bold">{rName}</span>
                    </div>

                    <span className="text-[11px] font-medium text-neutral-400">
                      {rCount === 0 ? "Currently empty" : `${rCount} existing item${rCount > 1 ? "s" : ""}`}
                    </span>
                  </label>
                );
              })}
            </div>

            <label className="flex items-start gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                className="rounded border-neutral-300 text-accent focus:ring-accent mt-0.5 h-3.5 w-3.5"
              />
              <span className="text-xs text-neutral-600 leading-snug">
                <strong>Replace existing devices</strong> in destination rooms (recommended to avoid duplicate switchboards)
              </span>
            </label>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleClone}
            loading={submitting}
            disabled={sourceItemsCount === 0 || selectedTargetIds.size === 0}
          >
            <Copy size={13} className="mr-1.5" />
            <span>Copy Devices to {selectedTargetIds.size} Space{selectedTargetIds.size === 1 ? "" : "s"}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}

