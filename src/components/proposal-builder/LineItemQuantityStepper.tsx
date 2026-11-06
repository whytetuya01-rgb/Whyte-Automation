"use client";

import { useState, useEffect, useRef } from "react";
import { Minus, Plus } from "lucide-react";
import { MAX_ITEM_QUANTITY, parseQuantityInput } from "@/lib/quantity";

interface LineItemQuantityStepperProps {
  itemId: number;
  quantity: number;
  disabled?: boolean;
  onUpdateQuantity: (itemId: number, newQty: number) => void;
  onDelete: (itemId: number) => void;
  className?: string;
}

export default function LineItemQuantityStepper({
  itemId,
  quantity,
  disabled = false,
  onUpdateQuantity,
  onDelete,
  className = "",
}: LineItemQuantityStepperProps) {
  const [typedValue, setTypedValue] = useState<string>(String(quantity));
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Synchronize when quantity prop changes from outside (e.g. server update), unless currently being edited
  useEffect(() => {
    if (!isFocused) {
      setTypedValue(String(quantity));
    }
  }, [quantity, isFocused]);

  const commitValue = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      setTypedValue(String(quantity));
      return;
    }

    const parsed = parseQuantityInput(trimmed);
    if (parsed.ok) {
      if (parsed.value !== quantity) {
        onUpdateQuantity(itemId, parsed.value);
      }
      setTypedValue(String(parsed.value));
    } else {
      // Revert if invalid
      setTypedValue(String(quantity));
    }
  };

  const handleStepDown = () => {
    if (disabled) return;
    if (quantity > 1) {
      onUpdateQuantity(itemId, quantity - 1);
    } else {
      onDelete(itemId);
    }
  };

  const handleStepUp = () => {
    if (disabled || quantity >= MAX_ITEM_QUANTITY) return;
    onUpdateQuantity(itemId, quantity + 1);
  };

  return (
    <div
      className={`flex items-center border border-gray-200 rounded-lg bg-gray-50/70 overflow-hidden shadow-2xs ${className}`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={handleStepDown}
        className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-200 active:scale-90 transition disabled:opacity-30 disabled:cursor-not-allowed"
        title={quantity > 1 ? "Decrease quantity" : "Remove product"}
      >
        <Minus size={11} />
      </button>

      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={typedValue}
        onChange={(e) => {
          const digitsOnly = e.target.value.replace(/\D/g, "");
          setTypedValue(digitsOnly);
        }}
        onFocus={(e) => {
          setIsFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setIsFocused(false);
          commitValue(typedValue);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setTypedValue(String(quantity));
            e.currentTarget.blur();
          }
        }}
        className="min-w-[1.75rem] max-w-[3.25rem] px-1 h-6 text-center text-xs font-mono font-bold text-gray-900 bg-white border-x border-gray-200 focus:outline-none focus:ring-1 focus:ring-accent selection:bg-accent-light"
        title="Type quantity (1-999)"
      />

      <button
        type="button"
        disabled={disabled || quantity >= MAX_ITEM_QUANTITY}
        onClick={handleStepUp}
        className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-200 active:scale-90 transition disabled:opacity-30 disabled:cursor-not-allowed"
        title="Increase quantity"
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

