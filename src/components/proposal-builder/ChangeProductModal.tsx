"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Package,
  Search,
  X,
  Sparkles,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  Palette,
} from "lucide-react";
import { QuotationItem, EditorCatalogProduct, Category } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import {
  analyzeProductVariants,
  resolveCompatibleSelection,
  VariantDimensionOption,
} from "@/lib/variantSelection";
import { getItemImageUrl, formatProposalProductName } from "@/components/proposal-builder/StepProposalPreview";

interface Props {
  isOpen: boolean;
  mode: "add" | "change";
  roomId: number;
  roomName: string;
  targetItem?: QuotationItem;
  products: EditorCatalogProduct[];
  categories: Category[];
  quotationDefaults?: { defaultTier?: string | null; defaultFinish?: string | null };
  onClose: () => void;
  onConfirmChange: (params: {
    itemId: number;
    productId: number;
    productVariantId: number | null;
    variantConfig: Record<string, string> | null;
    unitPrice: number;
    variantLabel: string | null;
  }) => Promise<void>;
  onConfirmAdd?: (params: {
    roomId: number;
    productId: number;
    productVariantId: number | null;
    variantConfig: Record<string, string> | null;
    unitPrice: number;
    variantLabel: string | null;
  }) => Promise<void>;
}

export default function ChangeProductModal({
  isOpen,
  mode,
  roomId,
  roomName,
  targetItem,
  products = [],
  categories = [],
  quotationDefaults,
  onClose,
  onConfirmChange,
  onConfirmAdd,
}: Props) {
  // Modal filter states
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("all");

  // Selected replacement product & configuration state
  const [selectedProduct, setSelectedProduct] = useState<EditorCatalogProduct | null>(null);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [selectedFinish, setSelectedFinish] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  // Initialize selected category on open
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setErrorFeedback(null);
      if (categories.length > 0 && selectedCategoryId === null) {
        setSelectedCategoryId(Number(categories[0].id ?? (categories[0] as any)._id));
      }
    }
  }, [isOpen, categories, selectedCategoryId]);

  // When a replacement product is selected, resolve initial variant & finish with compatibility preservation
  const handleSelectProduct = (product: EditorCatalogProduct) => {
    setErrorFeedback(null);
    setSelectedProduct(product);

    const initial = resolveCompatibleSelection({
      product,
      existingItem: targetItem,
      quotationDefaults,
    });

    setSelectedTier(initial.tier);
    setSelectedFinish(initial.finish);
  };

  // Analyze the selected product's variant options
  const productAnalysis = useMemo(() => {
    return analyzeProductVariants(selectedProduct);
  }, [selectedProduct]);

  // Dynamic finishes scoped to currently selected tier
  const tierFinishes = useMemo(() => {
    if (!productAnalysis) return [];
    return productAnalysis.getFinishesForTier(selectedTier);
  }, [productAnalysis, selectedTier]);

  // Handle tier change: dynamically re-verify and update finish options
  const handleTierChange = (newTier: string) => {
    setSelectedTier(newTier);

    if (productAnalysis) {
      const availableFinishes = productAnalysis.getFinishesForTier(newTier);
      // If current finish is valid in new tier, keep it
      const currentValid = availableFinishes.some((f) => f.value === selectedFinish);
      if (!currentValid) {
        // Fall back to first available finish for this tier
        setSelectedFinish(availableFinishes.length > 0 ? availableFinishes[0].value : null);
      }
    }
  };

  // Resolved final variant and price for the current configuration
  const currentResolution = useMemo(() => {
    if (!selectedProduct) return null;

    return resolveCompatibleSelection({
      product: selectedProduct,
      existingItem: targetItem,
      quotationDefaults,
      desiredTier: selectedTier,
      desiredFinish: selectedFinish,
    });
  }, [selectedProduct, selectedTier, selectedFinish, targetItem, quotationDefaults]);

  // Filtered products list for browsing
  const filteredProducts = useMemo(() => {
    let list = products.filter((p) => p.isActive);

    if (selectedCategoryId !== null) {
      const activeCat = categories.find(
        (c) => Number(c.id ?? (c as any)._id) === selectedCategoryId
      );
      const subIds = (activeCat?.children || []).map((s) => Number(s.id ?? (s as any)._id));
      list = list.filter((p) => {
        const pCatId = Number(p.categoryId ?? (p as any).category?.id ?? (p as any).category?._id);
        return pCatId === selectedCategoryId || subIds.includes(pCatId);
      });
    }

    if (productTypeFilter !== "all") {
      list = list.filter((p) => p.type === productTypeFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code && p.code.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q))
      );
    }

    return list;
  }, [products, categories, selectedCategoryId, productTypeFilter, search]);

  if (!isOpen) return null;

  const targetItemId = targetItem ? Number(targetItem.id ?? (targetItem as any)._id) : 0;
  const targetQty = Number(targetItem?.quantity) || 1;
  const currentUnitPrice = Number(targetItem?.unitPrice || 0);
  const currentLineTotal = targetQty * currentUnitPrice;
  const resolvedUnitPrice = currentResolution?.price ?? 0;
  const resolvedLineTotal = targetQty * resolvedUnitPrice;
  const priceDifference = resolvedLineTotal - currentLineTotal;

  const handleConfirm = async () => {
    if (!selectedProduct || !currentResolution) return;
    const prodId = Number(selectedProduct.id ?? (selectedProduct as any)._id);
    const variantId = currentResolution.variantId;
    const unitPrice = currentResolution.price;
    const variantLabel = currentResolution.variantLabel;
    const rawConfig = (currentResolution.variant?.config as Record<string, string>) || {};
    const variantConfig: Record<string, string> = { ...rawConfig };

    if (selectedTier) variantConfig.series = selectedTier;
    if (selectedFinish) variantConfig.finish = selectedFinish;

    setIsSubmitting(true);
    setErrorFeedback(null);

    try {
      if (mode === "change") {
        await onConfirmChange({
          itemId: targetItemId,
          productId: prodId,
          productVariantId: variantId,
          variantConfig: Object.keys(variantConfig).length > 0 ? variantConfig : null,
          unitPrice,
          variantLabel,
        });
      } else if (mode === "add" && onConfirmAdd) {
        await onConfirmAdd({
          roomId,
          productId: prodId,
          productVariantId: variantId,
          variantConfig: Object.keys(variantConfig).length > 0 ? variantConfig : null,
          unitPrice,
          variantLabel,
        });
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to replace product. Please try again.";
      setErrorFeedback(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-gray-200 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-start justify-between gap-3 bg-gray-50/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-accent-foreground bg-accent-light px-2 py-0.5 rounded border border-accent-border/60">
                {mode === "add" ? "Add Product" : "Replace Product"}
              </span>
              <span className="text-xs text-gray-400 font-semibold">• {roomName}</span>
            </div>
            <h3 className="font-extrabold text-gray-950 text-lg sm:text-xl mt-1">
              {mode === "add" ? `Add Device to ${roomName}` : `Change Product in ${roomName}`}
            </h3>
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

        {/* Existing Product Snapshot (only in change mode) */}
        {mode === "change" && targetItem && (
          <div className="px-4 sm:px-5 py-3 bg-gray-50/50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[10px] uppercase font-bold text-gray-400 shrink-0">Current Item:</span>
              <span className="font-bold text-gray-900 truncate">
                {formatProposalProductName(targetItem.product?.name)}
              </span>
              {targetItem.variantLabel && (
                <span className="px-2 py-0.5 rounded bg-gray-200/80 text-[11px] font-semibold text-gray-800 shrink-0">
                  {targetItem.variantLabel}
                </span>
              )}
              {targetItem.notes && (
                <span className="text-gray-400 truncate">({targetItem.notes})</span>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0 text-right">
              <span className="font-mono font-medium text-gray-500">
                Qty: {targetQty} · {formatCurrency(currentUnitPrice)}
              </span>
              <span className="font-mono font-bold text-gray-950">
                {formatCurrency(currentLineTotal)}
              </span>
            </div>
          </div>
        )}

        {/* Modal Body: Two column layout on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
          {/* Left Column: Product Catalog Search & List (Span 7) */}
          <div className="lg:col-span-7 flex flex-col min-h-0 bg-white">
            {/* Filter Bar */}
            <div className="p-3.5 border-b border-gray-100 space-y-2.5 bg-gray-50/30">
              {/* Category Pills */}
              {categories.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryId(null)}
                    className={`h-7 px-2.5 rounded-lg text-xs font-semibold shrink-0 transition border ${
                      selectedCategoryId === null
                        ? "bg-gray-950 text-white border-accent/40 shadow-xs ring-1 ring-accent/25"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-950"
                    }`}
                  >
                    All Categories
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCategoryId(c.id)}
                      className={`h-7 px-2.5 rounded-lg text-xs font-semibold shrink-0 transition border ${
                        selectedCategoryId === c.id
                          ? "bg-gray-950 text-white border-accent/40 shadow-xs ring-1 ring-accent/25"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-950"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Search & Type filter */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search devices by name or code..."
                    className="w-full h-8 pl-8 pr-2.5 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-950 bg-white"
                  />
                </div>

                <div className="w-36 shrink-0">
                  <Select
                    value={productTypeFilter}
                    onChange={(e) => setProductTypeFilter(e.target.value)}
                    triggerClassName="h-8 rounded-lg text-xs text-gray-700 border-gray-200"
                    options={[
                      { value: "all", label: "All Types" },
                      { value: "switch_board", label: "Switch Boards" },
                      { value: "accessory", label: "Accessories" },
                      { value: "smart_lock", label: "Smart Locks" },
                      { value: "curtain", label: "Curtains" },
                      { value: "vdp", label: "Video Door Phone" },
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Product List */}
            <div className="p-3 overflow-y-auto flex-1 divide-y divide-gray-100 space-y-1.5">
              {filteredProducts.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <Package size={26} className="mx-auto mb-1 opacity-40 text-gray-400" />
                  <p className="text-xs font-semibold text-gray-700">No products match your search</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Try clearing category or search filters</p>
                </div>
              ) : (
                filteredProducts.map((prod) => {
                  const isSelected = selectedProduct && Number(selectedProduct.id ?? (selectedProduct as any)._id) === Number(prod.id ?? (prod as any)._id);
                  const isCurrent = targetItem && Number(targetItem.productId) === Number(prod.id ?? (prod as any)._id);
                  const minPrice =
                    prod.variants && prod.variants.length > 0
                      ? Math.min(...prod.variants.filter((v) => v.isActive).map((v) => Number(v.price || 0)))
                      : Number(prod.price || 0);

                  return (
                    <div
                      key={prod.id}
                      onClick={() => handleSelectProduct(prod)}
                      className={`p-2.5 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition border ${
                        isSelected
                          ? "bg-accent-light/40 border-accent-border shadow-xs"
                          : isCurrent
                          ? "bg-gray-50/70 border-gray-200 hover:border-gray-300"
                          : "bg-white border-transparent hover:border-gray-200 hover:bg-gray-50/60"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                          {prod.imageUrl ? (
                            <img src={prod.imageUrl} alt={prod.name} className="w-full h-full object-contain p-1" />
                          ) : (
                            <Package size={16} className="text-gray-300" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h5 className="font-bold text-gray-950 text-xs sm:text-sm truncate">{prod.name}</h5>
                            {isCurrent && (
                              <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200">
                                Current
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                            <span className="text-gray-400 uppercase text-[10px] font-medium">{prod.category?.name ?? "Device"}</span>
                            {prod.code && (
                              <>
                                <span>•</span>
                                <span className="font-mono text-gray-400">{prod.code}</span>
                              </>
                            )}
                            <span>•</span>
                            <span className="font-mono font-semibold text-gray-900">
                              {prod.isMatrix ? `from ${formatCurrency(minPrice)}` : formatCurrency(minPrice)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectProduct(prod);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition ${
                          isSelected
                            ? "bg-gray-950 text-white"
                            : "border border-gray-200 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {isSelected ? "Configuring" : isCurrent ? "Reconfigure" : "Select"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Configuration & Variant/Finish Selection (Span 5) */}
          <div className="lg:col-span-5 flex flex-col min-h-0 bg-gray-50/40 p-4 sm:p-5 overflow-y-auto space-y-4">
            {!selectedProduct ? (
              <div className="my-auto py-12 text-center text-gray-400 space-y-2">
                <Layers size={32} className="mx-auto text-gray-300 opacity-60" />
                <p className="text-xs font-bold text-gray-700">Select a device from the list</p>
                <p className="text-[11px] text-gray-400 max-w-xs mx-auto">
                  Choose a device on the left to configure its automation tier, variant, and surface finish.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Selected Product Card */}
                <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-none space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                      {selectedProduct.imageUrl ? (
                        <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-full h-full object-contain p-1" />
                      ) : (
                        <Package size={20} className="text-gray-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        {selectedProduct.category?.name ?? "Automation"}
                      </span>
                      <h4 className="font-extrabold text-gray-950 text-sm sm:text-base leading-tight">
                        {selectedProduct.name}
                      </h4>
                      {selectedProduct.code && (
                        <p className="font-mono text-xs text-gray-400 mt-0.5">{selectedProduct.code}</p>
                      )}
                    </div>
                  </div>

                  {/* VARIANT / TIER SELECTOR */}
                  <div className="space-y-1.5 pt-2 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                        <Layers size={13} className="text-accent" />
                        <span>Automation Tier / Variant</span>
                      </label>
                      {currentResolution?.isPreservedTier && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          Preserved from current
                        </span>
                      )}
                    </div>

                    {productAnalysis.hasTiers ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {productAnalysis.availableTiers.map((tierOpt) => {
                          const isTierSelected = selectedTier === tierOpt.value;
                          return (
                            <button
                              key={tierOpt.value}
                              type="button"
                              onClick={() => handleTierChange(tierOpt.value)}
                              className={`p-2.5 rounded-xl text-left border text-xs transition ${
                                isTierSelected
                                  ? "bg-gray-950 text-white border-accent/40 shadow-xs"
                                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                              }`}
                            >
                              <p className="font-bold leading-tight">{tierOpt.label}</p>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="px-3 py-2 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-500 font-medium">
                        Standard Variant (No tier options)
                      </div>
                    )}
                  </div>

                  {/* FINISH SELECTOR */}
                  <div className="space-y-1.5 pt-2 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                        <Palette size={13} className="text-accent" />
                        <span>Surface Finish</span>
                      </label>
                      {currentResolution?.isPreservedFinish && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          Preserved from current
                        </span>
                      )}
                    </div>

                    {tierFinishes.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {tierFinishes.map((finishOpt) => {
                          const isFinishSelected = selectedFinish === finishOpt.value;
                          return (
                            <button
                              key={finishOpt.value}
                              type="button"
                              onClick={() => setSelectedFinish(finishOpt.value)}
                              className={`p-2.5 rounded-xl text-left border text-xs transition ${
                                isFinishSelected
                                  ? "bg-gray-950 text-white border-accent/40 shadow-xs"
                                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                              }`}
                            >
                              <p className="font-bold leading-tight">{finishOpt.label}</p>
                            </button>
                          );
                        })}
                      </div>
                    ) : productAnalysis.hasFinishes ? (
                      <div className="px-3 py-2 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 font-medium">
                        No finish options available for the selected tier.
                      </div>
                    ) : (
                      <div className="px-3 py-2 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-500 font-medium">
                        Standard Finish (No custom finish options)
                      </div>
                    )}
                  </div>
                </div>

                {/* Price & Summary Box */}
                <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-gray-100">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
                      Configuration Summary
                    </span>
                    {currentResolution?.variantLabel && (
                      <span className="font-semibold text-accent-foreground bg-accent-light px-2 py-0.5 rounded text-[11px] border border-accent-border/60">
                        {currentResolution.variantLabel}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>Unit Price</span>
                      <span className="font-mono font-bold text-gray-900">
                        {formatCurrency(resolvedUnitPrice)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-gray-600">
                      <span>Quantity</span>
                      <span className="font-mono font-bold text-gray-900">{targetQty}</span>
                    </div>

                    <div className="flex justify-between items-baseline pt-2 border-t border-gray-100">
                      <span className="font-extrabold text-gray-950 text-sm">Line Total</span>
                      <span className="font-mono font-black text-gray-950 text-base">
                        {formatCurrency(resolvedLineTotal)}
                      </span>
                    </div>

                    {/* Diff indicator (change mode only) */}
                    {mode === "change" && (
                      <div className="flex justify-between items-center pt-1 text-[11px]">
                        <span className="text-gray-400 font-medium">Price Difference:</span>
                        <span
                          className={`font-mono font-bold ${
                            priceDifference > 0
                              ? "text-emerald-600"
                              : priceDifference < 0
                              ? "text-blue-600"
                              : "text-gray-500"
                          }`}
                        >
                          {priceDifference > 0
                            ? `+${formatCurrency(priceDifference)}`
                            : priceDifference < 0
                            ? `-${formatCurrency(Math.abs(priceDifference))}`
                            : "No price change"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {errorFeedback && (
                  <div
                    role="alert"
                    className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2"
                  >
                    <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
                    <span>{errorFeedback}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-white">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 border border-gray-200 text-gray-700 font-semibold text-xs rounded-xl hover:bg-gray-50 transition active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedProduct || !currentResolution || isSubmitting}
            className="px-6 py-2.5 bg-gray-950 text-white font-bold text-xs rounded-xl hover:bg-gray-800 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm inline-flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                <span>Applying Changes...</span>
              </>
            ) : (
              <>
                <span>{mode === "add" ? "Add to Room" : "Save Replacement"}</span>
                <ArrowRight size={13} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
