"use client";
import { useState, useEffect } from "react";
import { Quotation } from "@/types";
import { formatCurrency, getProductTotals } from "@/lib/utils";
import { Select } from "@/components/ui/Select";

type DiscountTypeValue = "percentage" | "fixed" | "none";

interface Props {
  quotation: Quotation;
  onUpdateDiscount: (type: DiscountTypeValue, value: number) => Promise<void>;
}

export default function QuotationSummary({ quotation, onUpdateDiscount }: Props) {
  // Sync discount state from server data when quotation prop changes
  const [discountType, setDiscountType] = useState(quotation.discountType ?? "none");
  const [discountValue, setDiscountValue] = useState(Number(quotation.discountValue ?? 0));
  const [saving, setSaving] = useState(false);

  // Re-sync when the quotation prop is refreshed from server
  useEffect(() => {
    setDiscountType(quotation.discountType ?? "none");
    setDiscountValue(Number(quotation.discountValue ?? 0));
  }, [quotation.discountType, quotation.discountValue]);

  // Calculate grand total from all rooms and items
  const grandTotal = quotation.rooms.reduce((sum, room) => {
    return sum + room.items.reduce((rSum, item) => rSum + item.quantity * Number(item.unitPrice), 0);
  }, 0);

  const discountAmount =
    discountType === "percentage"
      ? (grandTotal * discountValue) / 100
      : discountType === "fixed"
      ? discountValue
      : 0;

  // Clamp discount so it never exceeds grandTotal
  const clampedDiscount = Math.min(discountAmount, grandTotal);
  const finalTotal = grandTotal - clampedDiscount;

  const totalItems = quotation.rooms.reduce((s, r) => s + r.items.length, 0);
  const productTotals = getProductTotals(quotation);

  const handleSaveDiscount = async () => {
    setSaving(true);
    try {
      await onUpdateDiscount(discountType, discountValue);
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    "flex-1 px-2 py-1.5 md:px-3 md:py-2 border border-gray-200 rounded-lg text-sm md:text-base focus:outline-none focus:ring-1 focus:ring-blue-200 bg-white";

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 md:px-5 md:py-4 lg:px-6 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800 text-sm md:text-base lg:text-lg">Summary</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-5 lg:p-6 space-y-3 md:space-y-4">
        {/* Room Subtotals */}
        {quotation.rooms.map((room) => {
          const subtotal = room.items.reduce(
            (s, i) => s + i.quantity * Number(i.unitPrice), 0
          );
          if (subtotal === 0) return null;
          const roomName = room.customName ?? room.roomType?.name ?? "Room";
          return (
            <div key={room.id} className="flex justify-between items-center text-sm md:text-base">
              <span className="text-gray-600 truncate mr-2">
                {room.roomType?.icon && <span className="mr-1">{room.roomType.icon}</span>}
                {roomName}
              </span>
              <span className="font-medium text-gray-900 shrink-0">{formatCurrency(subtotal)}</span>
            </div>
          );
        })}

        {totalItems === 0 && (
          <p className="text-center text-gray-400 text-xs md:text-sm py-4 md:py-6">No items added yet</p>
        )}

        {/* Product Quantities */}
        {productTotals.length > 0 && (
          <div className="border-t border-gray-100 pt-3 md:pt-4">
            <p className="text-xs md:text-sm font-semibold text-gray-600 mb-2 md:mb-3 uppercase tracking-wide">Product Totals</p>
            <div className="space-y-1.5 md:space-y-2">
              {productTotals.map((item) => (
                <div key={item.product.id} className="flex justify-between items-center text-xs md:text-sm">
                  <span className="text-gray-600 truncate mr-2">{item.product.name}</span>
                  <span className="text-gray-900 font-medium shrink-0">{item.totalQuantity}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grand Total before discount */}
        {totalItems > 0 && (
          <div className="border-t border-gray-100 pt-3 md:pt-4">
            <div className="flex justify-between items-center text-sm md:text-base font-semibold">
              <span className="text-gray-700">Subtotal</span>
              <span className="text-gray-900">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        )}

        {/* Discount */}
        <div className="border-t border-gray-100 pt-3 md:pt-4">
          <p className="text-xs md:text-sm font-medium text-gray-500 mb-2 md:mb-3">Discount</p>
          <div className="flex gap-2 md:gap-3 mb-2 md:mb-3">
            <div className="w-36 shrink-0">
              <Select
                value={discountType}
                onChange={(e) => {
                  const nextType = e.target.value as DiscountTypeValue;
                  setDiscountType(nextType);
                  if (nextType === "none") setDiscountValue(0);
                }}
                triggerClassName="h-10 rounded-xl text-xs md:text-sm border-gray-200"
                options={[
                  { value: "none", label: "None" },
                  { value: "percentage", label: "Percentage (%)" },
                  { value: "fixed", label: "Fixed (₹)" },
                ]}
              />
            </div>
            {discountType !== "none" && (
              <input
                type="number"
                min={0}
                max={discountType === "percentage" ? 100 : undefined}
                step={discountType === "percentage" ? 0.5 : 1}
                value={discountValue}
                onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value)))}
                className="w-20 md:w-24 px-2 py-1.5 md:px-3 md:py-2 border border-gray-200 rounded-lg text-sm md:text-base focus:outline-none focus:ring-1 focus:ring-blue-200 text-center"
              />
            )}
          </div>
          {clampedDiscount > 0 && (
            <div className="flex justify-between items-center text-sm md:text-base text-red-500 mb-2 md:mb-3">
              <span>
                Discount{" "}
                {discountType === "percentage" ? `(${discountValue}%)` : "(Fixed)"}
              </span>
              <span>− {formatCurrency(clampedDiscount)}</span>
            </div>
          )}
          <button
            onClick={handleSaveDiscount}
            disabled={saving || discountType === "none"}
            className="w-full py-1.5 md:py-2 text-xs md:text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition disabled:opacity-50"
          >
            {saving ? "Saving..." : "Apply Discount"}
          </button>
        </div>
      </div>

      {/* Final Total */}
      <div className="p-4 md:p-5 lg:p-6 border-t border-gray-100 bg-whyte-dark rounded-b-2xl">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-white/80 text-sm md:text-base">Final Total</span>
          <span className="font-bold text-white text-lg md:text-xl lg:text-2xl">{formatCurrency(finalTotal)}</span>
        </div>
        <p className="text-white/40 text-xs md:text-sm mt-0.5 md:mt-1">
          {totalItems} {totalItems === 1 ? "item" : "items"} across {quotation.rooms.length} {quotation.rooms.length === 1 ? "room" : "rooms"}
        </p>
      </div>
    </div>
  );
}
