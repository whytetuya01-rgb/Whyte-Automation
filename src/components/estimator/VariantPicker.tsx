"use client";

import { useState, useMemo } from "react";
import { EditorCatalogProduct, EditorCatalogVariant, MatrixDimension } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { X, ChevronRight, AlertCircle } from "lucide-react";

interface Props {
  product: EditorCatalogProduct;
  onSelect: (variantId: number, config: Record<string, string>) => void;
  onClose: () => void;
}

import {
  NormalizedDimension,
  capitalize,
  buildVariantLabel as buildLabel,
  normalizeProductDimensions,
  findVariant,
} from "@/lib/variant-dimension";

/** Picker for a 2D matrix — renders a rows × columns grid */
function Grid2DPicker({
  dim1,
  dim2,
  variants,
  onSelect,
}: {
  dim1: NormalizedDimension;
  dim2: NormalizedDimension;
  variants: EditorCatalogVariant[];
  onSelect: (v: EditorCatalogVariant) => void;
}) {
  const dim1Options = Array.isArray(dim1?.options) ? dim1.options : [];
  const dim2Options = Array.isArray(dim2?.options) ? dim2.options : [];

  if (dim1Options.length === 0 || dim2Options.length === 0) {
    return (
      <div className="p-4 bg-amber-50 rounded-xl text-center text-xs text-amber-800">
        <AlertCircle size={16} className="mx-auto mb-1 text-amber-600" />
        Dimension options are not fully configured for this product.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="pb-2 pr-3 text-xs font-medium text-gray-400 text-left">
              {dim1.label || "Option"}
            </th>
            {dim2Options.map((opt) => (
              <th key={opt} className="pb-2 px-2 text-xs font-semibold text-gray-600 text-center">
                {capitalize(opt)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {dim1Options.map((row) => (
            <tr key={row}>
              <td className="py-2 pr-3 text-xs font-semibold text-gray-600 whitespace-nowrap">
                {capitalize(row)}
              </td>
              {dim2Options.map((col) => {
                const config = { [dim1.key]: row, [dim2.key]: col };
                const variant = findVariant(variants, config);
                return (
                  <td key={col} className="py-2 px-2 text-center">
                    {variant ? (
                      <button
                        type="button"
                        onClick={() => onSelect(variant)}
                        className="w-full min-w-[72px] px-2 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-800 hover:border-gray-950 hover:bg-gray-950 hover:text-white active:scale-95 transition-all shadow-none cursor-pointer"
                      >
                        {formatCurrency(variant.price)}
                      </button>
                    ) : (
                      <span className="inline-flex items-center justify-center w-full min-w-[72px] px-2 py-2 rounded-lg border border-gray-100 text-xs text-gray-300 bg-gray-50/50 cursor-not-allowed select-none">
                        N/A
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Picker for a 1D matrix — renders a simple scrollable list */
function List1DPicker({
  dim,
  variants,
  onSelect,
}: {
  dim: NormalizedDimension;
  variants: EditorCatalogVariant[];
  onSelect: (v: EditorCatalogVariant) => void;
}) {
  const options = Array.isArray(dim?.options) ? dim.options : [];

  if (options.length === 0) {
    return (
      <div className="p-4 bg-amber-50 rounded-xl text-center text-xs text-amber-800">
        <AlertCircle size={16} className="mx-auto mb-1 text-amber-600" />
        No options configured for this dimension.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const config = { [dim.key]: opt };
        const variant = findVariant(variants, config);
        if (!variant) {
          return (
            <div
              key={opt}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed"
            >
              <span className="text-sm font-medium text-gray-500">{capitalize(opt)}</span>
              <span className="text-xs text-gray-400">N/A</span>
            </div>
          );
        }
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(variant)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-950 hover:bg-gray-50/60 active:scale-[0.99] transition-all group cursor-pointer"
          >
            <span className="text-sm font-semibold text-gray-800 group-hover:text-gray-950">
              {capitalize(opt)}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold font-mono text-gray-950">
                {formatCurrency(variant.price)}
              </span>
              <ChevronRight size={14} className="text-gray-400 group-hover:text-gray-700" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Cascading picker for 3+ dimensions */
function CascadingPicker({
  dimensions,
  variants,
  onSelect,
}: {
  dimensions: NormalizedDimension[];
  variants: EditorCatalogVariant[];
  onSelect: (v: EditorCatalogVariant) => void;
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  const updateSelection = (key: string, value: string) => {
    setSelections((prev) => {
      const next: Record<string, string> = {};
      let found = false;
      for (const dim of dimensions) {
        if (dim.key === key) {
          next[dim.key] = value;
          found = true;
        } else if (!found) {
          if (prev[dim.key]) next[dim.key] = prev[dim.key];
        }
      }
      return next;
    });
  };

  const selectedVariant =
    Object.keys(selections).length === dimensions.length
      ? findVariant(variants, selections)
      : undefined;

  return (
    <div className="space-y-3">
      {dimensions.map((dim) => {
        const options = Array.isArray(dim?.options) ? dim.options : [];
        return (
          <div key={dim.key}>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{dim.label}</label>
            <div className="flex flex-wrap gap-1.5">
              {options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => updateSelection(dim.key, opt)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                    selections[dim.key] === opt
                      ? "border-gray-950 bg-gray-950 text-white"
                      : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {capitalize(opt)}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {selectedVariant && (
        <button
          type="button"
          onClick={() => onSelect(selectedVariant)}
          className="w-full mt-2 py-3 rounded-xl bg-gray-950 text-white text-sm font-semibold hover:bg-gray-800 active:scale-[0.99] transition-all shadow-sm cursor-pointer"
        >
          Add at {formatCurrency(selectedVariant.price)}
        </button>
      )}
      {Object.keys(selections).length === dimensions.length && !selectedVariant && (
        <p className="text-xs text-center text-gray-400 py-2">
          This combination is not available
        </p>
      )}
    </div>
  );
}

export default function VariantPicker({ product, onSelect, onClose }: Props) {
  const activeVariants = useMemo(
    () => (product?.variants ?? []).filter((v) => v && v.isActive),
    [product?.variants]
  );

  const dims = useMemo(
    () => (product ? normalizeProductDimensions(product, activeVariants) : []),
    [product, activeVariants]
  );

  if (!product) return null;

  const handleSelect = (variant: EditorCatalogVariant) => {
    const rawConfig = (variant.config as Record<string, string>) ?? {};
    const config: Record<string, string> = { ...rawConfig };

    if (!config.series && variant.automationTier) {
      config.series = variant.automationTier;
    }
    if (!config.finish && variant.surfaceFinish) {
      config.finish = variant.surfaceFinish;
    }

    const variantId = variant.id ?? (variant as any)._id;
    onSelect(variantId, config);
    onClose();
  };

  // Determine render mode based on valid dimensions with options
  const renderMode =
    dims.length === 0
      ? "list"
      : dims.length === 1
      ? "1d"
      : dims.length === 2
      ? "2d"
      : "cascade";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-2xs" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Select Variant
            </p>
            <h3 className="text-sm font-bold text-gray-950 truncate mt-0.5">{product.name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 max-h-[65vh] overflow-y-auto">
          {activeVariants.length === 0 ? (
            <div className="text-center py-6 text-gray-400 space-y-1">
              <AlertCircle size={24} className="mx-auto text-gray-300" />
              <p className="text-sm font-medium text-gray-600">No active variants available</p>
              <p className="text-xs text-gray-400">Please check back later or select another device.</p>
            </div>
          ) : renderMode === "2d" ? (
            <Grid2DPicker
              dim1={dims[0]}
              dim2={dims[1]}
              variants={activeVariants}
              onSelect={handleSelect}
            />
          ) : renderMode === "1d" ? (
            <List1DPicker dim={dims[0]} variants={activeVariants} onSelect={handleSelect} />
          ) : renderMode === "cascade" ? (
            <CascadingPicker dimensions={dims} variants={activeVariants} onSelect={handleSelect} />
          ) : (
            // Flat fallback list
            <div className="space-y-2">
              {activeVariants.map((v) => (
                <button
                  key={v.id ?? (v as any)._id}
                  type="button"
                  onClick={() => handleSelect(v)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-950 hover:bg-gray-50/60 active:scale-[0.99] transition-all group cursor-pointer"
                >
                  <span className="text-sm font-medium text-gray-800 group-hover:text-gray-950">
                    {buildLabel(v)}
                  </span>
                  <span className="text-sm font-bold font-mono text-gray-950">
                    {formatCurrency(v.price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          <p className="text-xs text-slate-400 text-center">
            {renderMode === "2d"
              ? "Click a price in the grid to add this product"
              : renderMode === "cascade"
              ? "Select each option then click Add"
              : "Click a variant to add it"}
          </p>
        </div>
      </div>
    </div>
  );
}
