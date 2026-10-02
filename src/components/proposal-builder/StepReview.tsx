"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import Image from "next/image";
import {
  Building,
  MapPin,
  Package,
  Plus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Search,
  X,
  Sparkles,
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Quotation, QuotationRoom, QuotationItem, Product, Category } from "@/types";
import { formatCurrency, getRoomIcon } from "@/lib/utils";
import VariantPicker from "@/components/estimator/VariantPicker";
import { Select } from "@/components/ui/Select";

/**
 * Responsive Category Pill Scroller for modal dialogs.
 * Displays horizontal pill buttons that stay within the modal width,
 * with smooth scroll, hidden scrollbars, and dynamic indicator buttons.
 */
function CategoryPillScroller({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: {
  categories: Category[];
  selectedCategoryId: number | null;
  onSelectCategory: (id: number | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 6);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll, categories.length]);

  const handleScroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const offset = direction === "left" ? -180 : 180;
    scrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
  };

  return (
    <div className="relative w-full min-w-0 overflow-hidden">
      {/* Left scroll fade & arrow button */}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 z-20 flex items-center pr-2 bg-gradient-to-r from-white via-white/90 to-transparent">
          <button
            type="button"
            onClick={() => handleScroll("left")}
            aria-label="Scroll categories left"
            className="w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-700 hover:bg-gray-50 hover:text-gray-950 transition active:scale-90"
          >
            <ChevronLeft size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* Horizontal pill list */}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto scrollbar-none scroll-smooth w-full min-w-0 py-0.5 px-0.5"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <button
          type="button"
          onClick={() => onSelectCategory(null)}
          className={`h-8 px-3.5 rounded-xl text-xs font-semibold shrink-0 transition border select-none inline-flex items-center justify-center ${
            selectedCategoryId === null
              ? "bg-gray-950 text-white border-accent/40 shadow-xs ring-1 ring-accent/25"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-950 hover:bg-gray-50/60"
          }`}
        >
          All Categories
        </button>

        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectCategory(c.id)}
            className={`h-8 px-3.5 rounded-xl text-xs font-semibold shrink-0 transition border select-none inline-flex items-center justify-center ${
              selectedCategoryId === c.id
                ? "bg-gray-950 text-white border-accent/40 shadow-xs ring-1 ring-accent/25"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-950 hover:bg-gray-50/60"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Right scroll fade & arrow button */}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 z-20 flex items-center pl-2 bg-gradient-to-l from-white via-white/90 to-transparent">
          <button
            type="button"
            onClick={() => handleScroll("right")}
            aria-label="Scroll categories right"
            className="w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-700 hover:bg-gray-50 hover:text-gray-950 transition active:scale-90"
          >
            <ChevronRight size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  quotation: Quotation;
  products?: Product[];
  categories?: Category[];
  onAddItem?: (
    roomId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>
  ) => Promise<void>;
  onReplaceItem?: (
    itemId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>,
    unitPrice?: number,
    variantLabel?: string
  ) => Promise<void>;
  onUpdateItem: (itemId: number, data: any) => Promise<void>;
  onDeleteItem: (itemId: number) => Promise<void>;
  onUpdateDiscount: (type: "percentage" | "fixed" | "none", value: number) => Promise<void>;
  onContinue: () => void;
  onBack: () => void;
}

export default function StepReview({
  quotation,
  products = [],
  categories = [],
  onAddItem,
  onReplaceItem,
  onUpdateItem,
  onDeleteItem,
  onUpdateDiscount,
  onContinue,
  onBack,
}: Props) {
  const [discountType, setDiscountType] = useState<"percentage" | "fixed" | "none">(
    quotation.discountType ?? "none"
  );
  const [discountVal, setDiscountVal] = useState<number>(
    Number(quotation.discountValue ?? 0)
  );
  const [savingDiscount, setSavingDiscount] = useState(false);

  // Product Selector Modal state (for Add or Change)
  const [selectorState, setSelectorState] = useState<{
    isOpen: boolean;
    mode: "add" | "change";
    roomId: number;
    roomName: string;
    targetItem?: QuotationItem;
  } | null>(null);

  // Variant Picker state for Matrix products
  const [pickerProduct, setPickerProduct] = useState<{
    product: Product;
    mode: "add" | "change";
    roomId: number;
    targetItemId?: number;
  } | null>(null);

  // Selector modal filters
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("all");

  const rooms = quotation.rooms || [];

  // Calculations (unitPrice multiplied by quantity)
  const subtotal = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return (
        sum +
        (r.items || []).reduce(
          (acc, i) => acc + (i.quantity || 1) * Number(i.unitPrice || 0),
          0
        )
      );
    }, 0);
  }, [rooms]);

  const totalDevices = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return sum + (r.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
    }, 0);
  }, [rooms]);

  const allocatedPercent = Number(quotation.allocatedDiscountPercent || 0);
  const isLocked = quotation.status === "approved" || quotation.status === "delivered";

  const discountAmount =
    discountType === "percentage"
      ? (subtotal * discountVal) / 100
      : discountType === "fixed"
      ? discountVal
      : 0;

  const clampedDiscount = Math.min(discountAmount, subtotal);
  const grandTotal = Math.max(0, subtotal - clampedDiscount);

  // Earning calculation for dealer quotations
  const earningPercent = allocatedPercent > 0 && discountType === "percentage"
    ? Math.max(0, allocatedPercent - discountVal)
    : allocatedPercent;
  const estimatedEarning = (subtotal * earningPercent) / 100;

  const discountExceedsAllocation =
    allocatedPercent > 0 && discountType === "percentage" && discountVal > allocatedPercent;

  const handleApplyDiscount = async () => {
    if (discountExceedsAllocation) return;
    setSavingDiscount(true);
    try {
      await onUpdateDiscount(discountType, discountVal);
    } finally {
      setSavingDiscount(false);
    }
  };

  // Open Add Product Modal
  const handleOpenAddModal = (roomId: number, roomName: string) => {
    setSelectorState({
      isOpen: true,
      mode: "add",
      roomId,
      roomName,
    });
    setSearch("");
    if (categories.length > 0 && selectedCategoryId === null) {
      setSelectedCategoryId(categories[0].id);
    }
  };

  // Open Change Product Modal
  const handleOpenChangeModal = (item: QuotationItem, roomId: number, roomName: string) => {
    setSelectorState({
      isOpen: true,
      mode: "change",
      roomId,
      roomName,
      targetItem: item,
    });
    setSearch("");
    if (categories.length > 0 && selectedCategoryId === null) {
      setSelectedCategoryId(categories[0].id);
    }
  };

  // Filtered Products for the Selector Modal
  const modalFilteredProducts = useMemo(() => {
    let list = products.filter((p) => p.isActive);

    if (selectedCategoryId !== null) {
      const activeCat = categories.find((c) => c.id === selectedCategoryId);
      const subIds = activeCat?.children?.map((s) => s.id) || [];
      list = list.filter(
        (p) => p.categoryId === selectedCategoryId || (p.categoryId && subIds.includes(p.categoryId))
      );
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

  // Handle Product Selection in Modal
  const handleSelectProduct = async (product: Product) => {
    if (!selectorState) return;

    // If matrix product with multiple variants, open VariantPicker
    const activeVariants = product.variants?.filter((v) => v.isActive) || [];
    if (product.isMatrix && activeVariants.length > 1) {
      setPickerProduct({
        product,
        mode: selectorState.mode,
        roomId: selectorState.roomId,
        targetItemId: selectorState.targetItem?.id,
      });
      setSelectorState(null);
      return;
    }

    const firstVariant = activeVariants[0];
    const price = firstVariant ? Number(firstVariant.price) : Number(product.price || 0);
    const variantLabel = firstVariant
      ? (firstVariant.automationTier || firstVariant.surfaceFinish
          ? [firstVariant.automationTier, firstVariant.surfaceFinish].filter(Boolean).join(" + ")
          : null)
      : null;

    if (selectorState.mode === "add") {
      if (onAddItem) {
        await onAddItem(
          selectorState.roomId,
          product.id,
          firstVariant?.id,
          firstVariant?.config as Record<string, string> | undefined
        );
      }
    } else if (selectorState.mode === "change" && selectorState.targetItem) {
      if (onReplaceItem) {
        await onReplaceItem(
          selectorState.targetItem.id,
          product.id,
          firstVariant?.id,
          firstVariant?.config as Record<string, string> | undefined,
          price,
          variantLabel ?? undefined
        );
      }
    }

    setSelectorState(null);
  };

  // Handle Variant Selection from VariantPicker
  const handleVariantChosen = async (variantId: number, config: Record<string, string>) => {
    if (!pickerProduct) return;
    const { product, mode, roomId, targetItemId } = pickerProduct;
    const variant = product.variants?.find((v) => (v.id || (v as any)._id) === variantId);
    const price = variant ? Number(variant.price) : Number(product.price || 0);
    const variantLabel = variant
      ? (variant.automationTier || variant.surfaceFinish
          ? [variant.automationTier, variant.surfaceFinish].filter(Boolean).join(" + ")
          : Object.values(config).filter(Boolean).join(" + "))
      : null;

    if (mode === "add") {
      if (onAddItem) {
        await onAddItem(roomId, product.id, variantId, config);
      }
    } else if (mode === "change" && targetItemId) {
      if (onReplaceItem) {
        await onReplaceItem(
          targetItemId,
          product.id,
          variantId,
          config,
          price,
          variantLabel ?? undefined
        );
      }
    }

    setPickerProduct(null);
  };

  return (
    <div className="w-full space-y-6">
      {/* Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
        <div>
          <span className="text-xs uppercase tracking-widest text-gray-400 font-semibold block mb-0.5">
            Step 4 of 5
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-950 tracking-tight">
            Review Quotation & Investment
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Manage room products, change or add devices, and set commercial discounts.
          </p>
        </div>

        <div className="flex items-center gap-2.5 bg-white px-3.5 py-2 rounded-2xl border border-gray-200 shadow-none shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gray-950 text-white flex items-center justify-center font-bold text-xs">
            04
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Phase</p>
            <p className="text-xs font-bold text-gray-900 leading-tight">Review & Discount</p>
          </div>
        </div>
      </div>

      {/* Main 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Project Overview & Space Products (Span 8) */}
        <div className="lg:col-span-8 xl:col-span-8 2xl:col-span-8 space-y-5">
          {/* Project Overview Card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 shadow-none space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <span className="text-xs uppercase tracking-wider text-gray-400 font-bold flex items-center gap-1.5">
                <Building size={14} className="text-gray-950" />
                Project & Client Overview
              </span>
              <span className="font-mono text-xs font-bold text-gray-950 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200">
                {quotation.quotationNumber}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-gray-400 uppercase font-semibold text-[10px]">Client Name</p>
                <p className="font-bold text-gray-950 text-sm mt-0.5">{quotation.clientName}</p>
              </div>

              <div>
                <p className="text-gray-400 uppercase font-semibold text-[10px]">Project Location</p>
                <p className="font-semibold text-gray-800 text-sm mt-0.5">
                  {quotation.clientAddress || "—"}
                </p>
              </div>

              <div>
                <p className="text-gray-400 uppercase font-semibold text-[10px]">Project Type</p>
                <p className="font-semibold text-gray-800 text-sm mt-0.5">
                  {quotation.houseType?.name ?? "Residential / Smart Home"}
                </p>
              </div>

              <div>
                <p className="text-gray-400 uppercase font-semibold text-[10px]">Client Phone</p>
                <p className="font-mono text-gray-800 text-sm mt-0.5">
                  {quotation.clientPhone || "—"}
                </p>
              </div>
            </div>

            {/* Spaces Summary Pills */}
            <div className="pt-3 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 uppercase font-semibold mb-2">Automated Spaces</p>
              <div className="flex flex-wrap gap-2">
                {rooms.map((r) => {
                  const Icon = getRoomIcon(r.customName ?? r.roomType?.name ?? "Room");
                  const count = r.items ? r.items.length : 0;
                  return (
                    <div
                      key={r.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-800"
                    >
                      <Icon size={13} className="text-gray-500" />
                      <span>{r.customName ?? r.roomType?.name}</span>
                      <span className="text-[11px] font-mono text-gray-400">({count})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Products Grouped by Room */}
          <div className="space-y-4">
            <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold px-1">
              Configured Products Grouped by Space
            </h3>

            {rooms.map((room) => {
              const roomSubtotal = (room.items || []).reduce(
                (acc, i) => acc + (i.quantity || 1) * Number(i.unitPrice || 0),
                0
              );
              const roomProductCount = (room.items || []).reduce(
                (acc, i) => acc + (i.quantity || 1),
                0
              );
              const Icon = getRoomIcon(room.customName ?? room.roomType?.name ?? "Room");

              return (
                <div
                  key={room.id}
                  className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-none"
                >
                  {/* Room Header with [ + Add Product ] */}
                  <div className="px-5 py-3.5 bg-gray-50/70 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-gray-950 text-white flex items-center justify-center shrink-0">
                        <Icon size={15} />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-950 text-sm sm:text-base">
                          {room.customName ?? room.roomType?.name}
                        </h4>
                        <p className="text-[11px] text-gray-400">
                          {roomProductCount} {roomProductCount === 1 ? "product" : "products"} configured
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3.5">
                      <span className="font-mono font-bold text-gray-950 text-sm">
                        {formatCurrency(roomSubtotal)}
                      </span>

                      {/* Add Product Button */}
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenAddModal(
                            room.id,
                            room.customName ?? room.roomType?.name ?? "Space"
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-950 text-white text-xs font-semibold hover:bg-gray-800 transition active:scale-95 shadow-xs"
                      >
                        <Plus size={13} strokeWidth={2.5} />
                        <span>Add Product</span>
                      </button>
                    </div>
                  </div>

                  {/* Room Notes (if any) */}
                  {room.notes && (
                    <div className="px-5 py-2.5 bg-amber-50/40 border-b border-amber-100 text-xs text-amber-900">
                      <span className="font-semibold">Space Note: </span>
                      {room.notes}
                    </div>
                  )}

                  {/* Room Items */}
                  {(!room.items || room.items.length === 0) ? (
                    <div className="p-6 text-center text-xs text-gray-400">
                      <ShoppingBag size={20} className="mx-auto mb-1 opacity-40 text-gray-400" />
                      <p className="font-medium text-gray-600">No products added to this space yet.</p>
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenAddModal(
                            room.id,
                            room.customName ?? room.roomType?.name ?? "Space"
                          )
                        }
                        className="mt-2 text-xs font-semibold text-gray-950 underline hover:text-gray-700"
                      >
                        + Add product now
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {room.items.map((item, index) => {
                        const linePrice = (item.quantity || 1) * Number(item.unitPrice || 0);

                        return (
                          <div
                            key={item.id}
                            className="p-4 sm:p-5 hover:bg-gray-50/60 transition-colors"
                          >
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                              {/* COLUMN 1 — PRODUCT INFORMATION (45–50% -> md:col-span-6) */}
                              <div className="md:col-span-6 flex items-start gap-3.5 min-w-0">
                                {/* Product Image / Icon */}
                                <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden mt-0.5">
                                  {item.product?.imageUrl ? (
                                    <img
                                      src={item.product.imageUrl}
                                      alt={item.product.name}
                                      className="w-full h-full object-contain p-1"
                                    />
                                  ) : (
                                    <Package size={20} className="text-gray-300" />
                                  )}
                                </div>

                                {/* Information Hierarchy */}
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-xs font-mono font-bold text-accent shrink-0">
                                      #{index + 1}
                                    </span>
                                    <h5 className="font-bold text-gray-950 text-sm sm:text-base leading-snug break-words">
                                      {item.product?.name ?? "Product"}
                                    </h5>
                                  </div>

                                  {/* Product Code & Configuration / Tier / Finish */}
                                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                    {item.product?.code && (
                                      <span className="font-mono text-xs text-gray-400 font-medium">
                                        {item.product.code}
                                      </span>
                                    )}
                                    {item.product?.code && item.variantLabel && (
                                      <span className="text-gray-300">•</span>
                                    )}
                                    {item.variantLabel && (
                                      <span className="font-semibold text-accent-foreground bg-accent-light px-2 py-0.5 rounded text-[11px] border border-accent-border/60">
                                        {item.variantLabel}
                                      </span>
                                    )}
                                  </div>

                                  {/* Unit Price */}
                                  <p className="text-xs font-medium text-gray-500 font-mono">
                                    {formatCurrency(linePrice)} each
                                  </p>
                                </div>
                              </div>

                              {/* COLUMN 2 — INSTALLATION / DETAILS (25–30% -> md:col-span-3) */}
                              <div className="md:col-span-3 min-w-0 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100">
                                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">
                                  <MapPin size={13} className="text-accent shrink-0" />
                                  <span>Installation</span>
                                </div>
                                {item.notes && item.notes.trim() ? (
                                  <p className="text-xs sm:text-sm font-semibold text-gray-900 break-words leading-snug">
                                    {item.notes}
                                  </p>
                                ) : (
                                  <p className="text-xs text-gray-400 italic">
                                    Not specified
                                  </p>
                                )}
                              </div>

                              {/* COLUMN 3 — PRICE / ACTIONS (20–25% -> md:col-span-3) */}
                              <div className="md:col-span-3 flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-2.5 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100 text-left md:text-right">
                                <div>
                                  <span className="md:hidden text-[10px] uppercase font-bold text-gray-400 block">Price</span>
                                  <p className="font-mono font-black text-gray-950 text-base sm:text-lg">
                                    {formatCurrency(linePrice)}
                                  </p>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenChangeModal(
                                        item,
                                        room.id,
                                        room.customName ?? room.roomType?.name ?? "Space"
                                      )
                                    }
                                    className="px-3.5 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-accent-light hover:text-accent-foreground hover:border-accent-border transition active:scale-95 shadow-2xs"
                                  >
                                    Change
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => onDeleteItem(item.id)}
                                    className="px-3.5 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition active:scale-95 shadow-2xs"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Sticky Investment & Discount Summary (Span 4) */}
        <div className="lg:col-span-4 xl:col-span-4 2xl:col-span-4 space-y-5 lg:sticky lg:top-20">
          {/* Investment & Discount Summary Box */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 shadow-none space-y-5">
            <div className="pb-2 border-b border-gray-100">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold block">
                Financial Summary
              </span>
              <h3 className="text-base font-extrabold text-gray-950 mt-0.5">
                Investment Overview
              </h3>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 gap-2.5 py-2.5 px-3 bg-gray-50/70 rounded-xl border border-gray-100 text-xs">
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Total Spaces</p>
                <p className="text-base font-bold font-mono text-gray-950">{rooms.length}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Total Devices</p>
                <p className="text-base font-bold font-mono text-gray-950">{totalDevices}</p>
              </div>
            </div>

            {/* Lock Notice if approved/delivered */}
            {isLocked && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium">
                This quotation is <span className="font-bold uppercase">{quotation.status}</span> and locked for editing. Use the Clone button to create a new revision.
              </div>
            )}

            {/* Discount Configuration Controls */}
            <div className="space-y-2.5 p-3.5 bg-gray-50/50 rounded-xl border border-gray-200/80">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-gray-900">
                  {allocatedPercent > 0 ? "Customer Discount" : "Apply Project Discount"}
                </label>
                {allocatedPercent > 0 && (
                  <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                    Allocated: {allocatedPercent}%
                  </span>
                )}
              </div>

              {!isLocked && (
                <div className="flex gap-2">
                  <div className="w-36 shrink-0">
                    <Select
                      value={discountType}
                      onChange={(e) => setDiscountType(e.target.value as any)}
                      triggerClassName="h-9 rounded-lg text-xs font-medium text-gray-800 border-gray-200"
                      options={[
                        { value: "none", label: "No Discount" },
                        { value: "percentage", label: "Percentage (%)" },
                        ...(allocatedPercent === 0 ? [{ value: "fixed" as const, label: "Fixed Amount (₹)" }] : []),
                      ]}
                    />
                  </div>

                  {discountType !== "none" && (
                    <input
                      type="number"
                      min="0"
                      max={allocatedPercent > 0 ? allocatedPercent : 100}
                      value={discountVal}
                      onChange={(e) => setDiscountVal(Number(e.target.value))}
                      placeholder={discountType === "percentage" ? "10%" : "₹5000"}
                      className={`w-24 h-9 px-2.5 border rounded-lg text-xs font-mono font-bold bg-white focus:outline-none ${
                        discountExceedsAllocation ? "border-red-400 text-red-600" : "border-gray-200 focus:border-gray-950"
                      }`}
                    />
                  )}

                  {discountType !== "none" && (
                    <button
                      type="button"
                      onClick={handleApplyDiscount}
                      disabled={savingDiscount || discountExceedsAllocation}
                      className="h-9 px-3.5 bg-gray-950 text-white text-xs font-bold rounded-lg hover:bg-gray-800 disabled:opacity-50 transition shrink-0"
                    >
                      {savingDiscount ? "..." : "Apply"}
                    </button>
                  )}
                </div>
              )}

              {discountExceedsAllocation && (
                <p className="text-[11px] text-red-600 font-medium">
                  Customer discount cannot exceed the allocated {allocatedPercent}%.
                </p>
              )}

              {/* Estimated Earning Display for Dealer */}
              {allocatedPercent > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200/60 flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Estimated Earning ({earningPercent}%):</span>
                  <span className="font-mono font-bold text-emerald-600">
                    {formatCurrency(estimatedEarning)}
                  </span>
                </div>
              )}

              <p className="text-[11px] text-gray-400">
                Discount reflects in customer proposal calculations
              </p>
            </div>

            {/* Pricing Math Breakdown */}
            <div className="space-y-2.5 text-sm pt-2">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span className="font-mono font-bold text-gray-900">
                  {formatCurrency(subtotal)}
                </span>
              </div>
              {clampedDiscount > 0 && (
                <div className="flex justify-between text-emerald-600 font-semibold">
                  <span>
                    Discount ({discountType === "percentage" ? `${discountVal}%` : "Fixed"})
                  </span>
                  <span className="font-mono">− {formatCurrency(clampedDiscount)}</span>
                </div>
              )}
              <div className="pt-3 border-t border-gray-200 flex justify-between items-center">
                <div>
                  <span className="text-base font-extrabold text-gray-950 block">Grand Total</span>
                  <span className="text-[11px] text-gray-400">Estimated Project Investment</span>
                </div>
                <span className="text-2xl font-black font-mono text-gray-950">
                  {formatCurrency(grandTotal)}
                </span>
              </div>
            </div>

            {/* Continue Action Button */}
            <button
              type="button"
              onClick={onContinue}
              className="w-full py-3 bg-gray-950 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-gray-800 transition active:scale-[0.99] shadow-sm flex items-center justify-center gap-2 select-none"
            >
              <span>Generate Proposal Preview</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-6 border-t border-gray-100">
        <button
          type="button"
          onClick={onBack}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 font-semibold text-sm rounded-xl hover:bg-gray-50 transition"
        >
          <ArrowLeft size={16} />
          Back to Product Configuration
        </button>

        <button
          type="button"
          onClick={onContinue}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 bg-gray-950 text-white font-semibold text-sm rounded-xl hover:bg-gray-800 active:scale-[0.99] transition shadow-sm"
        >
          <span>Generate Client Proposal Preview</span>
          <ArrowRight size={16} />
        </button>
      </div>

      {/* Product Selector Modal for Add / Change */}
      {selectorState?.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col border border-gray-200 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3 bg-gray-50/60">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
                  {selectorState.mode === "add" ? "Add to Space" : "Replace Product"}
                </span>
                <h3 className="font-extrabold text-gray-950 text-lg sm:text-xl">
                  {selectorState.mode === "add"
                    ? `Add Product to ${selectorState.roomName}`
                    : `Change Product in ${selectorState.roomName}`}
                </h3>
                {selectorState.mode === "change" && selectorState.targetItem && (
                  <p className="text-xs text-gray-500 mt-1">
                    Replacing: <strong className="text-gray-900">{selectorState.targetItem.product?.name}</strong>
                    {selectorState.targetItem.notes && (
                      <span className="ml-1.5 text-gray-400 font-normal">
                        (Location: {selectorState.targetItem.notes})
                      </span>
                    )}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectorState(null)}
                className="p-1.5 text-gray-400 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Filters */}
            <div className="p-4 border-b border-gray-100 space-y-3 bg-white">
              {/* Category Pills Scroller */}
              {categories.length > 0 && (
                <CategoryPillScroller
                  categories={categories}
                  selectedCategoryId={selectedCategoryId}
                  onSelectCategory={setSelectedCategoryId}
                />
              )}

              {/* Search & Type filter */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search devices by name or code..."
                    className="w-full h-8 pl-9 pr-3 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-950 bg-white"
                  />
                </div>

                <div className="w-40 shrink-0">
                  <Select
                    value={productTypeFilter}
                    onChange={(e) => setProductTypeFilter(e.target.value)}
                    triggerClassName="h-8 rounded-lg text-xs text-gray-700 border-gray-200"
                    options={[
                      { value: "all", label: "All Types" },
                      { value: "switch_board", label: "Switch Boards" },
                      { value: "retrofit", label: "Retrofit" },
                      { value: "accessory", label: "Accessories" },
                      { value: "smart_lock", label: "Smart Locks" },
                      { value: "curtain", label: "Curtains" },
                      { value: "vdp", label: "Video Door Phone" },
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Products List */}
            <div className="p-4 overflow-y-auto flex-1 space-y-2 divide-y divide-gray-100">
              {modalFilteredProducts.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <Package size={28} className="mx-auto mb-1.5 opacity-40 text-gray-400" />
                  <p className="text-xs font-semibold text-gray-700">No products match your search</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Try clearing filters</p>
                </div>
              ) : (
                modalFilteredProducts.map((prod) => {
                  const minPrice = prod.variants && prod.variants.length > 0
                    ? Math.min(...prod.variants.filter((v) => v.isActive).map((v) => Number(v.price || 0)))
                    : Number(prod.price || 0);

                  return (
                    <div
                      key={prod.id}
                      className="pt-2.5 pb-1 flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-11 h-11 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                          {prod.imageUrl ? (
                            <img
                              src={prod.imageUrl}
                              alt={prod.name}
                              className="w-full h-full object-contain p-1"
                            />
                          ) : (
                            <Package size={18} className="text-gray-300" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase text-gray-400">
                            {prod.category?.name ?? "Automation"}
                          </p>
                          <h5 className="font-bold text-gray-950 text-xs sm:text-sm truncate">
                            {prod.name}
                          </h5>
                          <div className="flex items-center gap-2 text-[11px] text-gray-500">
                            {prod.code && <span className="font-mono text-gray-400">{prod.code}</span>}
                            <span>•</span>
                            <span className="font-mono font-semibold text-gray-950">
                              {prod.isMatrix ? `from ${formatCurrency(minPrice)}` : formatCurrency(minPrice)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelectProduct(prod)}
                        className="px-3.5 py-1.5 bg-gray-950 text-white rounded-lg text-xs font-semibold hover:bg-gray-800 transition active:scale-95 shrink-0"
                      >
                        {selectorState.mode === "add" ? "Add to Room" : "Replace with this"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Variant Picker for Matrix items in Step 4 */}
      {pickerProduct && (
        <VariantPicker
          product={pickerProduct.product}
          onSelect={(variantId, config) => handleVariantChosen(variantId, config)}
          onClose={() => setPickerProduct(null)}
        />
      )}
    </div>
  );
}
