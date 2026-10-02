"use client";
import { Product } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { Plus, Package } from "lucide-react";

interface Props {
  product: Product;
  onAdd: () => void;
}

const typeColors: Record<string, string> = {
  switch_board: "bg-blue-50 text-blue-600",
  accessory: "bg-purple-50 text-purple-600",
  retrofit: "bg-orange-50 text-orange-600",
  curtain: "bg-green-50 text-green-600",
  smart_lock: "bg-yellow-50 text-yellow-700",
  vdp: "bg-pink-50 text-pink-600",
  other: "bg-gray-50 text-gray-600",
};

const typeLabels: Record<string, string> = {
  switch_board: "Switch Board",
  accessory: "Accessory",
  retrofit: "Retrofit",
  curtain: "Curtain",
  smart_lock: "Smart Lock",
  vdp: "VDP",
  other: "Other",
};

export default function ProductCard({ product, onAdd }: Props) {
  // For matrix products, show "From ₹X" using the min variant price (stored in product.price)
  // For flat products, show the exact price
  const priceDisplay = product.isMatrix
    ? `From ${formatCurrency(product.price)}`
    : formatCurrency(product.price);

  // Show a badge if this is a matrix product (has variants)
  const variantCount = product.variants?.filter((v) => v.isActive).length ?? 0;

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 md:p-4 hover:border-blue-200 hover:shadow-md transition-all group flex flex-col h-full min-h-[220px] sm:min-h-[260px] lg:min-h-[280px]">
      {/* Image area */}
      <div className="w-full h-20 sm:h-24 md:h-28 lg:h-32 bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg mb-2 flex items-center justify-center overflow-hidden shrink-0">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <Package size={22} className="text-gray-300 md:scale-110" />
        )}
      </div>

      <div className="flex-1 flex flex-col justify-start min-w-0">
        <div className="flex flex-wrap gap-1 mb-1">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold uppercase tracking-wide ${typeColors[product.type] ?? typeColors.other}`}>
            {typeLabels[product.type] ?? product.type}
          </span>
          {product.moduleSize && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-slate-100 text-slate-600">
              {product.moduleSize}
            </span>
          )}
        </div>

        <p className="font-bold text-gray-900 text-xs sm:text-sm md:text-base leading-snug line-clamp-2 min-h-[2.5rem] mb-0.5">
          {product.name}
        </p>

        {product.code && (
          <p className="text-[9px] sm:text-xs text-gray-400 font-mono mb-1 truncate">
            {product.code}
          </p>
        )}

        {product.description && (
          <p className="hidden sm:block text-xs text-gray-500 line-clamp-2 mb-2 leading-relaxed">
            {product.description}
          </p>
        )}
      </div>

      {/* Pricing & Add/Pick Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-auto pt-2 border-t border-slate-50 shrink-0">
        <div className="min-w-0">
          <p className={`font-black text-gray-950 text-xs sm:text-sm md:text-base leading-none ${product.isMatrix ? "text-blue-700" : ""}`}>
            {priceDisplay}
          </p>
          <p className="text-[9px] sm:text-xs text-slate-400 mt-1">
            /{product.unit}
            {product.isMatrix && variantCount > 0 && (
              <span className="ml-1 text-blue-500 font-bold block sm:inline">{variantCount} opt</span>
            )}
          </p>
        </div>
        <button
          onClick={onAdd}
          className="w-full sm:w-auto flex items-center justify-center gap-1 px-2.5 py-1.5 bg-whyte-blue text-white text-[10px] sm:text-xs font-bold rounded-lg hover:bg-whyte-light transition-all active:scale-95 shrink-0"
        >
          <Plus size={12} />
          {product.isMatrix ? "Pick" : "Add"}
        </button>
      </div>
    </div>
  );
}
