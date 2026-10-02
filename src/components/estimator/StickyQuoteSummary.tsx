"use client";
import { Quotation, QuotationRoom } from "@/types";
import { formatCurrency, getRoomIcon } from "@/lib/utils";
import { ChevronUp, ChevronDown, ShoppingBag, Eye } from "lucide-react";
import Link from "next/link";

interface Props {
  quotation: Quotation;
  activeRoom: QuotationRoom | null;
  isOpen: boolean;
  onToggle: () => void;
}

export default function StickyQuoteSummary({ quotation, activeRoom, isOpen, onToggle }: Props) {
  // Calculate totals
  const grandTotal = quotation.rooms.reduce((sum, room) => {
    return sum + room.items.reduce((rSum, item) => rSum + item.quantity * Number(item.unitPrice), 0);
  }, 0);

  const discountValue = Number(quotation.discountValue ?? 0);
  const discountAmount =
    quotation.discountType === "percentage"
      ? (grandTotal * discountValue) / 100
      : quotation.discountType === "fixed"
      ? discountValue
      : 0;

  const clampedDiscount = Math.min(discountAmount, grandTotal);
  const finalTotal = grandTotal - clampedDiscount;

  const totalItems = quotation.rooms.reduce((s, r) => s + r.items.length, 0);

  const activeRoomName = activeRoom
    ? activeRoom.customName ?? activeRoom.roomType?.name ?? "Room"
    : "No Room";

  const activeRoomItemsCount = activeRoom?.items.length ?? 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900 text-white z-40 border-t border-slate-800 shadow-2xl transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 py-3 md:py-4 flex items-center justify-between">
        {/* Active Room Info (Left) */}
        <div className="flex lg:hidden flex-col min-w-0">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:block">Current Room</p>
          <p className="text-sm font-bold truncate">
            {activeRoomName}
            <span className="ml-1.5 font-normal text-xs text-slate-400">
              ({activeRoomItemsCount} {activeRoomItemsCount === 1 ? "item" : "items"})
            </span>
          </p>
        </div>

        {/* Totals & Toggle (Right) */}
        <div className="flex items-center gap-2.5 md:gap-4 shrink-0 lg:ml-auto">
          <div className="text-right">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Final Total</p>
            <p className="text-base md:text-lg font-black text-blue-400">
              {formatCurrency(finalTotal)}
            </p>
          </div>

          {/* Preview PDF Link (moved here) */}
          <Link
            href={`/quotation/${quotation.id}/preview`}
            className="flex items-center gap-1.5 px-3 py-2 bg-whyte-blue hover:bg-whyte-light text-white rounded-xl text-xs md:text-sm font-bold transition active:scale-95 shrink-0"
          >
            <Eye size={13} className="md:scale-110" />
            <span className="hidden xs:inline">Preview PDF</span>
            <span className="xs:hidden">Preview</span>
          </Link>

          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs md:text-sm font-semibold transition active:scale-95"
            aria-label={isOpen ? "Collapse Summary" : "Expand Summary"}
          >
            <span>{isOpen ? "Hide Summary" : "View Summary"}</span>
            {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronUp size={14} className="text-slate-400" />}
          </button>
        </div>
      </div>
    </div>
  );
}
