"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Package,
  X,
  SlidersHorizontal,
  RotateCcw,
  Check,
  AlertCircle,
  ArrowRight,
  Loader2,
  Layers,
  Palette,
  MapPin,
  ChevronDown,
  Info,
} from "lucide-react";
import { QuotationRoom, QuotationItem, EditorCatalogProduct, Category } from "@/types";
import { formatCurrency, getRoomIcon } from "@/lib/utils";
import { getRoomFullTitle } from "@/lib/roomUtils";
import {
  analyzeProductVariants,
  resolveCompatibleSelection,
  extractVariantTier,
  extractVariantFinish,
  VariantDimensionOption,
} from "@/lib/variantSelection";
import { Select, SelectOption } from "@/components/ui/Select";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getItemImageUrl, formatProposalProductName } from "@/components/proposal-builder/StepProposalPreview";

export interface MassEditRowState {
  itemId: number;
  originalItem: QuotationItem;
  isModified: boolean;
  selectedProductId: number;
  selectedTier: string | null;
  selectedFinish: string | null;
  selectedVariantId: number | null;
  selectedVariantLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface Props {
  isOpen: boolean;
  room: QuotationRoom;
  allRooms: QuotationRoom[];
  products: EditorCatalogProduct[];
  categories: Category[];
  quotationDefaults?: { defaultTier?: string | null; defaultFinish?: string | null };
  onClose: () => void;
  onSave: (updates: Array<{
    itemId: number;
    productId: number;
    productVariantId?: number | null;
    variantConfig?: Record<string, string> | null;
    variantLabel?: string | null;
    quantity?: number;
  }>) => Promise<void>;
}

export default function RoomMassEditModal({
  isOpen,
  room,
  allRooms,
  products = [],
  categories = [],
  quotationDefaults,
  onClose,
  onSave,
}: Props) {
  const [rowStates, setRowStates] = useState<Record<number, MassEditRowState>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  const roomItems = useMemo(() => room.items || [], [room.items]);
  const roomIcon = getRoomIcon(room.customName ?? room.roomType?.name ?? "Room");

  // Products lookup map by ID
  const productMap = useMemo(() => {
    const map = new Map<number, EditorCatalogProduct>();
    for (const p of products) {
      map.set(Number(p.id ?? (p as any)._id), p);
    }
    return map;
  }, [products]);

  // Product select options for searchable replacement selector
  const productOptions: SelectOption[] = useMemo(() => {
    return products
      .filter((p) => p.isActive)
      .map((p) => {
        const id = String(p.id ?? (p as any)._id);
        const name = p.name;
        const code = p.code || "";
        const price =
          p.variants && p.variants.length > 0
            ? Math.min(...p.variants.filter((v) => v.isActive).map((v) => Number(v.price || 0)))
            : Number(p.price || 0);
        const priceLabel = `from ${formatCurrency(price)}`;

        return {
          value: id,
          label: name,
          subLabel: code ? code : undefined,
          badge: priceLabel,
          searchTerms: [name, code].filter(Boolean),
        };
      });
  }, [products]);

  // Initialize row states from current room items
  useEffect(() => {
    if (!isOpen) return;

    setErrorFeedback(null);
    const initial: Record<number, MassEditRowState> = {};

    for (const item of roomItems) {
      const itId = Number(item.id ?? (item as any)._id);
      const prodId = Number(item.productId);
      const prod = productMap.get(prodId);

      const tier =
        item.productVariant?.automationTier ||
        (item.variantConfig as Record<string, string> | undefined)?.series ||
        (item.variantConfig as Record<string, string> | undefined)?.tier ||
        null;

      const finish =
        item.productVariant?.surfaceFinish ||
        (item.variantConfig as Record<string, string> | undefined)?.finish ||
        (item.variantConfig as Record<string, string> | undefined)?.surfaceFinish ||
        null;

      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice || 0);

      initial[itId] = {
        itemId: itId,
        originalItem: item,
        isModified: false,
        selectedProductId: prodId,
        selectedTier: tier,
        selectedFinish: finish,
        selectedVariantId: item.productVariantId ?? null,
        selectedVariantLabel: item.variantLabel ?? null,
        quantity: qty,
        unitPrice,
        lineTotal: qty * unitPrice,
      };
    }

    setRowStates(initial);
  }, [isOpen, roomItems, productMap]);

  // Handle changing replacement product for a row
  const handleProductChange = (itemId: number, newProductId: number) => {
    const current = rowStates[itemId];
    if (!current) return;

    const original = current.originalItem;
    const isBackToOriginalProduct = Number(original.productId) === newProductId;

    const newProd = productMap.get(newProductId);
    if (!newProd) return;

    // Resolve compatible variant and finish
    const resolution = resolveCompatibleSelection({
      product: newProd,
      existingItem: original,
      quotationDefaults,
    });

    const isModified =
      !isBackToOriginalProduct ||
      resolution.variantId !== original.productVariantId ||
      resolution.tier !== (original.productVariant?.automationTier ?? null) ||
      resolution.finish !== (original.productVariant?.surfaceFinish ?? null);

    setRowStates((prev) => ({
      ...prev,
      [itemId]: {
        ...current,
        isModified,
        selectedProductId: newProductId,
        selectedTier: resolution.tier,
        selectedFinish: resolution.finish,
        selectedVariantId: resolution.variantId,
        selectedVariantLabel: resolution.variantLabel,
        unitPrice: resolution.price,
        lineTotal: current.quantity * resolution.price,
      },
    }));
  };

  // Handle changing Tier for a row
  const handleTierChange = (itemId: number, newTier: string) => {
    const current = rowStates[itemId];
    if (!current) return;

    const prod = productMap.get(current.selectedProductId);
    if (!prod) return;

    const analysis = analyzeProductVariants(prod);
    const availableFinishes = analysis.getFinishesForTier(newTier);

    // If current finish valid in new tier, keep it; otherwise pick first available
    let nextFinish = current.selectedFinish;
    const finishValid = availableFinishes.some((f) => f.value === nextFinish);
    if (!finishValid) {
      nextFinish = availableFinishes.length > 0 ? availableFinishes[0].value : null;
    }

    const resolution = resolveCompatibleSelection({
      product: prod,
      existingItem: current.originalItem,
      quotationDefaults,
      desiredTier: newTier,
      desiredFinish: nextFinish,
    });

    const original = current.originalItem;
    const isModified =
      Number(current.selectedProductId) !== Number(original.productId) ||
      resolution.variantId !== original.productVariantId ||
      resolution.tier !== (original.productVariant?.automationTier ?? null) ||
      resolution.finish !== (original.productVariant?.surfaceFinish ?? null);

    setRowStates((prev) => ({
      ...prev,
      [itemId]: {
        ...current,
        isModified,
        selectedTier: resolution.tier,
        selectedFinish: resolution.finish,
        selectedVariantId: resolution.variantId,
        selectedVariantLabel: resolution.variantLabel,
        unitPrice: resolution.price,
        lineTotal: current.quantity * resolution.price,
      },
    }));
  };

  // Handle changing Finish for a row
  const handleFinishChange = (itemId: number, newFinish: string) => {
    const current = rowStates[itemId];
    if (!current) return;

    const prod = productMap.get(current.selectedProductId);
    if (!prod) return;

    const resolution = resolveCompatibleSelection({
      product: prod,
      existingItem: current.originalItem,
      quotationDefaults,
      desiredTier: current.selectedTier,
      desiredFinish: newFinish,
    });

    const original = current.originalItem;
    const isModified =
      Number(current.selectedProductId) !== Number(original.productId) ||
      resolution.variantId !== original.productVariantId ||
      resolution.tier !== (original.productVariant?.automationTier ?? null) ||
      resolution.finish !== (original.productVariant?.surfaceFinish ?? null);

    setRowStates((prev) => ({
      ...prev,
      [itemId]: {
        ...current,
        isModified,
        selectedFinish: resolution.finish,
        selectedVariantId: resolution.variantId,
        selectedVariantLabel: resolution.variantLabel,
        unitPrice: resolution.price,
        lineTotal: current.quantity * resolution.price,
      },
    }));
  };

  // Revert a row back to its original state
  const handleRevertRow = (itemId: number) => {
    const current = rowStates[itemId];
    if (!current) return;

    const item = current.originalItem;
    const qty = Number(item.quantity) || 1;
    const unitPrice = Number(item.unitPrice || 0);

    const tier =
      item.productVariant?.automationTier ||
      (item.variantConfig as Record<string, string> | undefined)?.series ||
      (item.variantConfig as Record<string, string> | undefined)?.tier ||
      null;

    const finish =
      item.productVariant?.surfaceFinish ||
      (item.variantConfig as Record<string, string> | undefined)?.finish ||
      (item.variantConfig as Record<string, string> | undefined)?.surfaceFinish ||
      null;

    setRowStates((prev) => ({
      ...prev,
      [itemId]: {
        itemId,
        originalItem: item,
        isModified: false,
        selectedProductId: Number(item.productId),
        selectedTier: tier,
        selectedFinish: finish,
        selectedVariantId: item.productVariantId ?? null,
        selectedVariantLabel: item.variantLabel ?? null,
        quantity: qty,
        unitPrice,
        lineTotal: qty * unitPrice,
      },
    }));
  };

  // Modified rows count and totals comparison
  const modifiedRows = Object.values(rowStates).filter((r) => r.isModified);
  const modifiedCount = modifiedRows.length;

  const originalRoomSubtotal = roomItems.reduce(
    (sum, it) => sum + (Number(it.quantity) || 1) * Number(it.unitPrice || 0),
    0
  );

  const newRoomSubtotal = Object.values(rowStates).reduce(
    (sum, r) => sum + r.lineTotal,
    0
  );

  const priceDiff = newRoomSubtotal - originalRoomSubtotal;

  const handleApply = async () => {
    if (modifiedCount === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setErrorFeedback(null);

    const updates = modifiedRows.map((r) => {
      const prod = productMap.get(r.selectedProductId);
      const analysis = analyzeProductVariants(prod);
      const v = analysis.findVariant(r.selectedTier, r.selectedFinish);

      const rawConfig = (v?.config as Record<string, string>) || {};
      const variantConfig: Record<string, string> = { ...rawConfig };
      if (r.selectedTier) variantConfig.series = r.selectedTier;
      if (r.selectedFinish) variantConfig.finish = r.selectedFinish;

      return {
        itemId: r.itemId,
        productId: r.selectedProductId,
        productVariantId: r.selectedVariantId,
        variantConfig: Object.keys(variantConfig).length > 0 ? variantConfig : null,
        variantLabel: r.selectedVariantLabel,
        quantity: r.quantity,
      };
    });

    try {
      await onSave(updates);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to apply mass edit changes. Please try again.";
      setErrorFeedback(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col border border-gray-200 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-start justify-between gap-3 bg-gray-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-950 text-white flex items-center justify-center shrink-0">
              {React.createElement(roomIcon, { size: 18 })}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-accent-foreground bg-accent-light px-2 py-0.5 rounded border border-accent-border/60">
                  Mass Edit
                </span>
                <span className="text-xs text-gray-400 font-semibold">
                  • {roomItems.length} {roomItems.length === 1 ? "device" : "devices"} configured
                </span>
              </div>
              <h3 className="font-extrabold text-gray-950 text-lg sm:text-xl mt-0.5">
                Mass Edit Space: {getRoomFullTitle(room, allRooms)}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-950 rounded-xl hover:bg-gray-100 transition active:scale-95"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Info Banner */}
        <div className="px-5 py-2.5 bg-blue-50/50 border-b border-blue-100/60 flex items-center gap-2 text-xs text-blue-900">
          <Info size={14} className="text-blue-600 shrink-0" />
          <span>
            Replace multiple devices, automation tiers, and finishes in this space at once. Changes are applied only to this space.
          </span>
        </div>

        {/* Rows List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-4 sm:p-5 space-y-4">
          {roomItems.map((item, index) => {
            const itId = Number(item.id ?? (item as any)._id);
            const state = rowStates[itId];
            if (!state) return null;

            const selectedProd = productMap.get(state.selectedProductId);
            const analysis = analyzeProductVariants(selectedProd);
            const tierFinishes = analysis.getFinishesForTier(state.selectedTier);

            const isModified = state.isModified;
            const originalProdName = formatProposalProductName(item.product?.name);
            const imgUrl = getItemImageUrl(item);

            return (
              <div
                key={itId}
                className={`pt-4 first:pt-0 rounded-2xl transition-colors ${
                  isModified ? "bg-amber-50/30 p-4 border border-amber-200/80" : ""
                }`}
              >
                {/* Row Header / Distinction */}
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-accent">#{index + 1}</span>
                    <span className="text-xs font-bold text-gray-900">
                      {isModified ? "Replacement Configuration" : originalProdName}
                    </span>
                    {isModified && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        Modified
                      </span>
                    )}
                  </div>

                  {isModified && (
                    <button
                      type="button"
                      onClick={() => handleRevertRow(itId)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-gray-900 hover:underline"
                    >
                      <RotateCcw size={11} />
                      <span>Revert row</span>
                    </button>
                  )}
                </div>

                {/* 2-Column Row Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  {/* Left: Original Item Info (Span 4) */}
                  <div className="lg:col-span-4 bg-gray-50/60 rounded-xl p-3 border border-gray-100 space-y-2 text-xs">
                    <div className="flex items-start gap-2.5">
                      <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                        {imgUrl ? (
                          <img src={imgUrl} alt={originalProdName} className="w-full h-full object-contain p-0.5" />
                        ) : (
                          <Package size={16} className="text-gray-300" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current Item</p>
                        <p className="font-bold text-gray-950 text-xs truncate leading-snug">{originalProdName}</p>
                        {item.product?.code && (
                          <p className="font-mono text-[10px] text-gray-400">{item.product.code}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                      {item.variantLabel && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-200/80 text-[10px] font-semibold text-gray-700">
                          {item.variantLabel}
                        </span>
                      )}
                      <span className="font-mono text-gray-500">
                        Qty: {item.quantity} · {formatCurrency(item.unitPrice)}
                      </span>
                    </div>

                    {item.notes && (
                      <div className="flex items-center gap-1 text-[10px] text-gray-400 pt-1 border-t border-gray-200/40">
                        <MapPin size={10} className="shrink-0" />
                        <span className="truncate">{item.notes}</span>
                      </div>
                    )}
                  </div>

                  {/* Right: Replacement Product & Variant Selectors (Span 8) */}
                  <div className="lg:col-span-8 space-y-3">
                    {/* Product Selector */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">
                        Select Replacement Product
                      </label>
                      <SearchableSelect
                        value={String(state.selectedProductId)}
                        onChange={(e) => handleProductChange(itId, Number(e.target.value))}
                        placeholder="Select a replacement product"
                        searchPlaceholder="Search by product code or name..."
                        emptyText="No products found"
                        triggerClassName="h-9 rounded-xl text-xs font-semibold text-gray-900 border-gray-200 bg-white"
                        options={productOptions}
                      />
                    </div>

                    {/* Variant & Finish Selectors */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Automation Tier / Variant */}
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                          <Layers size={11} className="text-accent" />
                          <span>Automation Tier</span>
                        </label>
                        {analysis.hasTiers ? (
                          <Select
                            value={state.selectedTier || ""}
                            onChange={(e) => handleTierChange(itId, e.target.value)}
                            triggerClassName="h-8 rounded-lg text-xs font-medium text-gray-800 border-gray-200 bg-white"
                            options={analysis.availableTiers}
                          />
                        ) : (
                          <div className="h-8 px-2.5 rounded-lg border border-gray-200 bg-gray-50 flex items-center text-[11px] text-gray-400">
                            Standard (No tiers)
                          </div>
                        )}
                      </div>

                      {/* Surface Finish */}
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                          <Palette size={11} className="text-accent" />
                          <span>Surface Finish</span>
                        </label>
                        {tierFinishes.length > 0 ? (
                          <Select
                            value={state.selectedFinish || ""}
                            onChange={(e) => handleFinishChange(itId, e.target.value)}
                            triggerClassName="h-8 rounded-lg text-xs font-medium text-gray-800 border-gray-200 bg-white"
                            options={tierFinishes}
                          />
                        ) : analysis.hasFinishes ? (
                          <div className="h-8 px-2.5 rounded-lg border border-amber-200 bg-amber-50 flex items-center text-[11px] text-amber-700">
                            No finishes for tier
                          </div>
                        ) : (
                          <div className="h-8 px-2.5 rounded-lg border border-gray-200 bg-gray-50 flex items-center text-[11px] text-gray-400">
                            Standard (No finish options)
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Pricing Comparison for Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-100 text-xs">
                      <div className="flex items-center gap-2">
                        {state.selectedVariantLabel && (
                          <span className="text-[10px] font-bold text-accent-foreground bg-accent-light px-2 py-0.5 rounded border border-accent-border/60">
                            {state.selectedVariantLabel}
                          </span>
                        )}
                        <span className="font-mono text-gray-500">
                          {formatCurrency(state.unitPrice)} each × {state.quantity}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono font-extrabold text-gray-950 text-sm">
                          {formatCurrency(state.lineTotal)}
                        </span>
                        {isModified && (
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              state.lineTotal > (Number(item.quantity) || 1) * Number(item.unitPrice || 0)
                                ? "text-emerald-600"
                                : state.lineTotal < (Number(item.quantity) || 1) * Number(item.unitPrice || 0)
                                ? "text-blue-600"
                                : "text-gray-400"
                            }`}
                          >
                            ({state.lineTotal - (Number(item.quantity) || 1) * Number(item.unitPrice || 0) > 0 ? "+" : ""}
                            {formatCurrency(state.lineTotal - (Number(item.quantity) || 1) * Number(item.unitPrice || 0))})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer / Summary Bar */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="flex items-center gap-3 text-xs">
            <span
              className={`px-2.5 py-1 rounded-lg font-bold border ${
                modifiedCount > 0
                  ? "bg-amber-100/70 text-amber-900 border-amber-300"
                  : "bg-gray-100 text-gray-500 border-gray-200"
              }`}
            >
              {modifiedCount} of {roomItems.length} items modified
            </span>

            <div className="flex items-center gap-1.5 font-mono text-xs">
              <span className="text-gray-400">Space Subtotal:</span>
              <span className="font-semibold text-gray-700">{formatCurrency(originalRoomSubtotal)}</span>
              {modifiedCount > 0 && (
                <>
                  <span className="text-gray-400">→</span>
                  <span className="font-extrabold text-gray-950">{formatCurrency(newRoomSubtotal)}</span>
                  <span
                    className={`font-bold ${
                      priceDiff > 0 ? "text-emerald-600" : priceDiff < 0 ? "text-blue-600" : "text-gray-500"
                    }`}
                  >
                    ({priceDiff > 0 ? `+${formatCurrency(priceDiff)}` : `${formatCurrency(priceDiff)}`})
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-gray-200 text-gray-700 font-semibold text-xs rounded-xl hover:bg-white transition active:scale-95 disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={modifiedCount === 0 || isSubmitting}
              className="px-6 py-2.5 bg-gray-950 text-white font-bold text-xs rounded-xl hover:bg-gray-800 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm inline-flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Applying Changes...</span>
                </>
              ) : (
                <>
                  <span>Apply Changes ({modifiedCount})</span>
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </div>
        </div>

        {errorFeedback && (
          <div className="px-5 py-2.5 bg-red-50 border-t border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0 text-red-600" />
            <span>{errorFeedback}</span>
          </div>
        )}
      </div>
    </div>
  );
}
