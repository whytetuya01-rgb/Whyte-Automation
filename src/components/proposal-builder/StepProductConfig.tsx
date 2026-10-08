"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Image from "next/image";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Package,
  Layers,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ShoppingBag,
  Sparkles,
  MapPin,
  SlidersHorizontal,
  X,
  RotateCcw,
} from "lucide-react";
import {
  Product,
  Category,
  Quotation,
  QuotationRoom,
  QuotationItem,
  ProductVariant,
} from "@/types";
import { formatCurrency, getRoomIcon } from "@/lib/utils";
import {
  getRoomDisplayName,
  getRoomFullTitle,
  groupRoomsByFloor,
  isMultiFloorHouseType,
} from "@/lib/roomUtils";
import { getEffectiveFloorForRoom } from "@/lib/floorAssignment";
import { getCategoryConfig, formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import {
  filterProductCatalog,
  FilteredProductResult,
  getVariantTier,
  getVariantFinish,
} from "@/lib/productFiltering";
import VariantPicker from "@/components/estimator/VariantPicker";
import { Select } from "@/components/ui/Select";

interface Props {
  quotation: Quotation;
  products: Product[];
  categories: Category[];
  activeRoomId: number | null;
  onSelectRoom: (roomId: number) => void;
  onAddItem: (
    roomId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>
  ) => Promise<void>;
  onUpdateItem: (itemId: number, data: any) => Promise<void>;
  onDeleteItem: (itemId: number) => Promise<void>;
  onUpdateRoom?: (roomId: number, data: Partial<QuotationRoom>) => Promise<void>;
  onUpdateRoomNotes: (roomId: number, notes: string) => Promise<void>;
  onContinue: () => void;
  onBack: () => void;
}

export default function StepProductConfig({
  quotation,
  products,
  categories,
  activeRoomId,
  onSelectRoom,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onUpdateRoomNotes,
  onContinue,
  onBack,
}: Props) {
  // Navigation / Selection State
  const rooms = quotation.rooms || [];
  const currentRoom =
    rooms.find((r) => Number(r.id ?? (r as any)._id) === Number(activeRoomId)) ||
    rooms[0] ||
    null;

  // Property multi-floor status
  const isMultiFloor = useMemo(() => {
    return isMultiFloorHouseType(quotation.houseType);
  }, [quotation.houseType]);

  // Active Rooms horizontal scroll state & refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const roomRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollLeft = el.scrollLeft;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(maxScroll > 2 && maxScroll - scrollLeft > 2);
  };

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    updateScrollButtons();

    const ro = new ResizeObserver(() => {
      updateScrollButtons();
    });

    ro.observe(el);
    if (el.firstElementChild) {
      ro.observe(el.firstElementChild);
    }

    el.addEventListener("scroll", updateScrollButtons, { passive: true });
    window.addEventListener("resize", updateScrollButtons, { passive: true });

    const timer = setTimeout(updateScrollButtons, 100);

    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateScrollButtons);
      window.removeEventListener("resize", updateScrollButtons);
      clearTimeout(timer);
    };
  }, [rooms]);

  const handleScrollActiveRooms = (direction: "left" | "right") => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollAmount = 300;
    el.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
    const startTime = Date.now();
    const interval = setInterval(() => {
      updateScrollButtons();
      if (Date.now() - startTime > 600) clearInterval(interval);
    }, 50);
  };

  // Auto scroll active room pill into view
  useEffect(() => {
    if (activeRoomId && roomRefs.current[Number(activeRoomId)]) {
      const pill = roomRefs.current[Number(activeRoomId)];
      const container = scrollContainerRef.current;
      if (pill && container) {
        pill.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
        const timer = setTimeout(updateScrollButtons, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [activeRoomId]);

  // Live Overview rooms grouped by floor
  const floorGroups = useMemo(() => {
    return groupRoomsByFloor(rooms, isMultiFloor);
  }, [rooms, isMultiFloor]);

  // Filter State
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<number | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>("");
  const [selectedFinish, setSelectedFinish] = useState<string>("");
  const [search, setSearch] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState<string>("all");

  // Variant Picker Modal State
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);

  // Expanded Product Card Variants state
  const [expandedCardIds, setExpandedCardIds] = useState<Set<number>>(new Set());

  const toggleCardVariants = (productId: number) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  // Helper to extract clean display name for a variant
  const getVariantName = (v: ProductVariant) => {
    const tier = formatTierLabel(v.automationTier);
    const finish = formatFinishLabel(v.surfaceFinish);
    const parts: string[] = [];
    if (tier) parts.push(tier);
    if (finish) parts.push(finish);
    if (parts.length === 0 && v.config && Object.keys(v.config).length > 0) {
      for (const [, val] of Object.entries(v.config)) {
        if (val) parts.push(String(val));
      }
    }
    return parts.length > 0 ? parts.join(" · ") : (v.name || "Standard");
  };

  // Mobile Summary Drawer State
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);

  // Per-item Installation Location local state
  const [itemLocations, setItemLocations] = useState<Record<number, string>>({});

  // Sync initial notes from quotation items
  useEffect(() => {
    const locMap: Record<number, string> = {};
    quotation.rooms?.forEach((room) => {
      room.items?.forEach((item) => {
        const itId = Number(item.id ?? (item as any)._id);
        locMap[itId] = item.notes ?? "";
      });
    });
    setItemLocations((prev) => ({ ...locMap, ...prev }));
  }, [quotation.rooms]);

  const handleLocationChange = (itemId: number, value: string) => {
    setItemLocations((prev) => ({ ...prev, [itemId]: value }));
  };

  const handleLocationBlur = async (itemId: number) => {
    const val = itemLocations[itemId] !== undefined ? itemLocations[itemId].trim() : null;
    await onUpdateItem(itemId, { notes: val || null });
  };

  // Set default active room if not set or invalid
  useEffect(() => {
    if (rooms.length > 0) {
      const hasActive = activeRoomId && rooms.some((r) => Number(r.id ?? (r as any)._id) === Number(activeRoomId));
      if (!hasActive) {
        onSelectRoom(Number(rooms[0].id ?? (rooms[0] as any)._id));
      }
    }
  }, [activeRoomId, rooms, onSelectRoom]);

  // Set default category on first load if available
  useEffect(() => {
    if (selectedCategoryId === null && categories.length > 0) {
      setSelectedCategoryId(Number(categories[0].id ?? (categories[0] as any)._id));
    }
  }, [categories, selectedCategoryId]);

  // Active Category & Subcategory Objects
  const activeCategory = useMemo(() => {
    return categories.find((c) => Number(c.id ?? (c as any)._id) === Number(selectedCategoryId)) || null;
  }, [categories, selectedCategoryId]);

  const subcategories = useMemo(() => {
    return activeCategory?.children || [];
  }, [activeCategory]);

  const activeSubcategory = useMemo(() => {
    return subcategories.find((c) => Number(c.id ?? (c as any)._id) === Number(selectedSubcategoryId)) || null;
  }, [subcategories, selectedSubcategoryId]);

  // Inspect dynamic Category Config (Automation Tiers & Surface Finishes)
  const categoryConfig = useMemo(() => {
    if (activeSubcategory && (activeSubcategory.variantTiers || activeSubcategory.variantFinishes)) {
      return getCategoryConfig(activeSubcategory);
    }
    return getCategoryConfig(activeCategory);
  }, [activeCategory, activeSubcategory]);

  // Reset or initialize Tier & Finish when Category changes
  useEffect(() => {
    if (categoryConfig.hasAutomationTiers && categoryConfig.configuredTiers.length > 0) {
      if (!selectedTier || (selectedTier !== "all" && !categoryConfig.validTierValues.includes(selectedTier))) {
        const defaultTier =
          quotation.defaultTier && categoryConfig.validTierValues.includes(quotation.defaultTier)
            ? quotation.defaultTier
            : categoryConfig.configuredTiers[0].value;
        setSelectedTier(defaultTier);
      }
    } else {
      setSelectedTier("");
    }

    if (categoryConfig.hasSurfaceFinishes && categoryConfig.configuredFinishes.length > 0) {
      if (!selectedFinish || (selectedFinish !== "all" && !categoryConfig.validFinishValues.includes(selectedFinish))) {
        const defaultFinish =
          quotation.defaultFinish && categoryConfig.validFinishValues.includes(quotation.defaultFinish)
            ? quotation.defaultFinish
            : categoryConfig.configuredFinishes[0].value;
        setSelectedFinish(defaultFinish);
      }
    } else {
      setSelectedFinish("");
    }
  }, [categoryConfig, quotation.defaultTier, quotation.defaultFinish]);

  // Reset all filters handler
  const handleResetFilters = () => {
    setSelectedTier("all");
    setSelectedFinish("all");
    setProductTypeFilter("all");
    setSearch("");
    setSelectedSubcategoryId(null);
  };

  const hasActiveFilters = Boolean(
    (selectedTier && selectedTier !== "all") ||
    (selectedFinish && selectedFinish !== "all") ||
    (productTypeFilter && productTypeFilter !== "all") ||
    search.trim() ||
    selectedSubcategoryId !== null
  );

  // Filtered Products Catalog using pure AND logic
  const filteredCatalog = useMemo(() => {
    return filterProductCatalog(products, {
      categoryId: selectedCategoryId,
      subcategoryId: selectedSubcategoryId,
      subcategoryIds: subcategories.map((s) => Number(s.id ?? (s as any)._id)),
      automationTier: selectedTier,
      surfaceFinish: selectedFinish,
      productType: productTypeFilter,
      search,
      configuredTiers: categoryConfig.configuredTiers,
      configuredFinishes: categoryConfig.configuredFinishes,
      hasCategoryTiers: categoryConfig.hasAutomationTiers,
      hasCategoryFinishes: categoryConfig.hasSurfaceFinishes,
    });
  }, [
    products,
    selectedCategoryId,
    selectedSubcategoryId,
    subcategories,
    selectedTier,
    selectedFinish,
    productTypeFilter,
    search,
    categoryConfig,
  ]);

  // Backward-compatible reference for counts and external consumers
  const filteredProducts = useMemo(() => {
    return filteredCatalog.map((r) => r.product);
  }, [filteredCatalog]);

  // Add product handler - uses exact eligible variant or opens selection
  const handleAddProduct = async (catItem: FilteredProductResult) => {
    if (!currentRoom) return;
    const roomId = Number(currentRoom.id ?? (currentRoom as any)._id);
    if (!roomId) return;

    const { product, eligibleVariants, exactVariant } = catItem;
    const prodId = Number(product.id ?? (product as any)._id);

    if (exactVariant) {
      const varId = Number(exactVariant.id ?? (exactVariant as any)._id);
      const config: Record<string, string> = { ...(exactVariant.config || {}) };
      const vTier = getVariantTier(exactVariant);
      const vFinish = getVariantFinish(exactVariant);
      if (vTier) config.series = vTier;
      if (vFinish) config.finish = vFinish;

      await onAddItem(
        roomId,
        prodId,
        varId,
        Object.keys(config).length > 0 ? config : undefined
      );
      return;
    }

    if (eligibleVariants.length > 1) {
      setExpandedCardIds((prev) => new Set(prev).add(prodId));
      return;
    }

    // Flat product without variants
    await onAddItem(roomId, prodId);
  };

  // Add specific variant directly
  const handleAddVariant = async (product: Product, variant: ProductVariant) => {
    if (!currentRoom) return;
    const roomId = Number(currentRoom.id ?? (currentRoom as any)._id);
    const prodId = Number(product.id ?? (product as any)._id);
    const varId = Number(variant.id ?? (variant as any)._id);
    if (!roomId || !prodId || !varId) return;

    const config: Record<string, string> = { ...(variant.config || {}) };
    const vTier = getVariantTier(variant);
    const vFinish = getVariantFinish(variant);
    if (vTier) config.series = vTier;
    if (vFinish) config.finish = vFinish;

    await onAddItem(
      roomId,
      prodId,
      varId,
      Object.keys(config).length > 0 ? config : undefined
    );
  };

  // Remove one instance of product in current room (decrement quantity or delete)
  const handleRemoveProductInstance = async (product: Product) => {
    if (!currentRoom) return;
    const prodId = Number(product.id ?? (product as any)._id);
    const matchingItems = (currentRoom.items || []).filter((i) => {
      const pId = Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id);
      return pId === prodId;
    });
    if (matchingItems.length === 0) return;
    const lastItem = matchingItems[matchingItems.length - 1];
    const itemId = Number(lastItem.id ?? (lastItem as any)._id);
    if (!itemId) return;

    const currentQty = Number(lastItem.quantity) || 1;
    if (currentQty > 1) {
      await onUpdateItem(itemId, { quantity: currentQty - 1 });
    } else {
      await onDeleteItem(itemId);
    }
  };

  // Totals Calculation for Live Summary
  const grandTotal = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return (
        sum +
        (r.items || []).reduce(
          (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
          0
        )
      );
    }, 0);
  }, [rooms]);

  const totalProductsCount = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return sum + (r.items || []).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);
    }, 0);
  }, [rooms]);

  const currentRoomSubtotal = useMemo(() => {
    if (!currentRoom || !currentRoom.items) return 0;
    return currentRoom.items.reduce(
      (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
      0
    );
  }, [currentRoom]);

  const currentRoomProductsCount = useMemo(() => {
    if (!currentRoom || !currentRoom.items) return 0;
    return currentRoom.items.reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);
  }, [currentRoom]);

  return (
    <div className="w-full space-y-6">
      {/* 1. Step Header & Live Grand Total Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
        <div>
          <span className="text-xs uppercase tracking-widest text-gray-400 font-semibold block mb-0.5">
            Step 3 of 5
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-950 tracking-tight">
            Configure Smart Devices
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Assign products, set quantities, and specify installation locations for each room.
          </p>
        </div>

        {/* Live Total Pill */}
        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-2xl border border-gray-200 shadow-none shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gray-950 text-white flex items-center justify-center font-bold text-sm">
            {totalProductsCount}
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
              Quotation Total
            </p>
            <p className="text-base sm:text-lg font-black font-mono text-gray-950 leading-tight">
              {formatCurrency(grandTotal)}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Active Space Selection Bar */}
      <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 shadow-none max-w-full overflow-hidden">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
            Select Active Room ({rooms.length} {rooms.length === 1 ? "Space" : "Spaces"})
          </span>
          {currentRoom && (
            <span className="text-xs text-gray-500 font-medium hidden sm:inline">
              Active:{" "}
              <strong className="text-gray-900 font-semibold">
                {getRoomDisplayName(currentRoom, rooms)}
              </strong>
              <span className="text-gray-400 font-normal">
                {" · "}
                {getEffectiveFloorForRoom(currentRoom, rooms, isMultiFloor)}
              </span>
            </span>
          )}
        </div>

        {/* Scroll row: arrows + viewport */}
        <div className="flex items-center gap-2 w-full min-w-0">
          {/* Left Arrow */}
          <button
            type="button"
            disabled={!canScrollLeft}
            onClick={() => handleScrollActiveRooms("left")}
            aria-label="Scroll active rooms left"
            className={`shrink-0 w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center transition-all cursor-pointer select-none ${
              canScrollLeft
                ? "text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-xs"
                : "text-gray-300 opacity-40 cursor-not-allowed"
            }`}
          >
            <ChevronLeft size={14} strokeWidth={2.5} />
          </button>

          {/* Scrollable viewport — this is the element with overflow-x:auto */}
          <div
            ref={scrollContainerRef}
            className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden scrollbar-none"
          >
            {/* Inner track — width:max-content keeps all pills in one row */}
            <div className="flex flex-nowrap gap-2 w-max pb-0.5 pr-4">
              {rooms.map((room) => {
                const currentId = Number(currentRoom?.id ?? (currentRoom as any)?._id);
                const roomId = Number(room.id ?? (room as any)._id);
                const isCurrent = Boolean(currentId && roomId === currentId);
                const IconComp = getRoomIcon(room.customName ?? room.roomType?.name ?? "Room");
                const roomDisplayName = getRoomDisplayName(room, rooms);
                const roomFloor = getEffectiveFloorForRoom(room, rooms, isMultiFloor);
                const roomSub = (room.items || []).reduce(
                  (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
                  0
                );
                const roomProdCount = (room.items || []).reduce(
                  (acc, i) => acc + (Number(i.quantity) || 1),
                  0
                );

                return (
                  <button
                    key={roomId}
                    ref={(el) => {
                      roomRefs.current[roomId] = el;
                    }}
                    type="button"
                    onClick={() => onSelectRoom(roomId)}
                    aria-label={`${roomDisplayName}, ${roomFloor}, ${roomProdCount} devices`}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border select-none flex-none shrink-0 cursor-pointer transition-all duration-150 ${
                      isCurrent
                        ? "bg-gray-950 border-accent/40 shadow-xs ring-1 ring-accent/25 text-white"
                        : "bg-white border-gray-200 text-gray-800 hover:border-gray-300 hover:bg-gray-50/70"
                    }`}
                  >
                    {/* Room Icon */}
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? "bg-white/10 text-accent"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      <IconComp size={15} />
                    </div>

                    {/* Room Name + Floor */}
                    <div className="flex flex-col items-start text-left">
                      <span
                        className={`text-xs font-semibold leading-snug whitespace-nowrap ${
                          isCurrent ? "text-white" : "text-gray-900"
                        }`}
                      >
                        {roomDisplayName}
                      </span>
                      <span
                        className={`text-[10px] font-normal leading-none mt-0.5 whitespace-nowrap ${
                          isCurrent ? "text-gray-400" : "text-gray-500"
                        }`}
                      >
                        {roomFloor}
                      </span>
                    </div>

                    {/* Device Count Badge */}
                    <span
                      className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-full shrink-0 ${
                        isCurrent
                          ? "bg-white/15 text-white border border-white/20"
                          : roomProdCount > 0
                          ? "bg-accent/10 text-accent border border-accent/20"
                          : "bg-gray-100 text-gray-500 border border-gray-200/80"
                      }`}
                    >
                      {roomProdCount}
                    </span>

                    {/* Price (desktop-only, only when items exist) */}
                    {roomSub > 0 && (
                      <span
                        className={`font-mono text-[11px] font-medium hidden xl:inline shrink-0 ${
                          isCurrent ? "text-gray-400" : "text-gray-500"
                        }`}
                      >
                        • {formatCurrency(roomSub)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Arrow */}
          <button
            type="button"
            disabled={!canScrollRight}
            onClick={() => handleScrollActiveRooms("right")}
            aria-label="Scroll active rooms right"
            className={`shrink-0 w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center transition-all cursor-pointer select-none ${
              canScrollRight
                ? "text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-xs"
                : "text-gray-300 opacity-40 cursor-not-allowed"
            }`}
          >
            <ChevronRight size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* 3. Main 2-Column Responsive Layout (70-75% Left Catalog / 25-30% Right Sidebar) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Configuration & Product Catalog (Span 8-9) */}
        <div className="lg:col-span-8 xl:col-span-8 2xl:col-span-9 space-y-5">
          {/* Configuration Card: Categories, Tiers, Finishes, Search */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-none space-y-4">
            {/* Primary Category Selector */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                Product Category
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const catId = Number(cat.id ?? (cat as any)._id);
                  const isSelected = Boolean(selectedCategoryId && selectedCategoryId === catId);
                  return (
                    <button
                      key={catId}
                      type="button"
                      onClick={() => {
                        setSelectedCategoryId(catId);
                        setSelectedSubcategoryId(null);
                      }}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition border select-none ${
                        isSelected
                          ? "bg-gray-950 text-white border-accent/40 shadow-xs ring-1 ring-accent/25"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900 hover:bg-gray-50/50"
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Subcategories (if any) */}
            {subcategories.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                  Subcategory
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedSubcategoryId(null)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition border select-none ${
                      selectedSubcategoryId === null
                        ? "bg-gray-950 text-white border-gray-950"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900 hover:bg-gray-50/50"
                    }`}
                  >
                    All {activeCategory?.name}
                  </button>
                  {subcategories.map((sub) => {
                    const subId = Number(sub.id ?? (sub as any)._id);
                    const isSelected = Boolean(selectedSubcategoryId && selectedSubcategoryId === subId);
                    return (
                      <button
                        key={subId}
                        type="button"
                        onClick={() => setSelectedSubcategoryId(subId)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition border select-none ${
                          isSelected
                            ? "bg-gray-950 text-white border-gray-950"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900 hover:bg-gray-50/50"
                        }`}
                      >
                        {sub.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Automation Tier & Surface Finish Dropdowns */}
            {(categoryConfig.hasAutomationTiers || categoryConfig.hasSurfaceFinishes) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                {categoryConfig.hasAutomationTiers && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-gray-700">
                        Automation Tier
                      </label>
                      {selectedTier && selectedTier !== "all" && (
                        <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.2 rounded">
                          Filtered
                        </span>
                      )}
                    </div>
                    <Select
                      value={selectedTier || "all"}
                      onChange={(e) => setSelectedTier(e.target.value)}
                      options={[
                        { value: "all", label: "All Automation Tiers" },
                        ...categoryConfig.configuredTiers.map((t) => ({
                          value: t.value,
                          label: t.label,
                        })),
                      ]}
                      triggerClassName={`h-10 rounded-xl text-xs sm:text-sm font-medium transition-all ${
                        selectedTier && selectedTier !== "all"
                          ? "border-accent/70 bg-accent/[0.03] text-gray-950 font-semibold ring-1 ring-accent/20"
                          : "border-gray-200 text-gray-700 hover:border-gray-300"
                      }`}
                    />
                  </div>
                )}

                {categoryConfig.hasSurfaceFinishes && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-gray-700">
                        Surface Finish
                      </label>
                      {selectedFinish && selectedFinish !== "all" && (
                        <span className="text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.2 rounded">
                          Filtered
                        </span>
                      )}
                    </div>
                    <Select
                      value={selectedFinish || "all"}
                      onChange={(e) => setSelectedFinish(e.target.value)}
                      options={[
                        { value: "all", label: "All Surface Finishes" },
                        ...categoryConfig.configuredFinishes.map((f) => ({
                          value: f.value,
                          label: f.label,
                        })),
                      ]}
                      triggerClassName={`h-10 rounded-xl text-xs sm:text-sm font-medium transition-all ${
                        selectedFinish && selectedFinish !== "all"
                          ? "border-accent/70 bg-accent/[0.03] text-gray-950 font-semibold ring-1 ring-accent/20"
                          : "border-gray-200 text-gray-700 hover:border-gray-300"
                      }`}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Search and Product Type Filter */}
            <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-gray-100">
              <div className="relative flex-1">
                <Search
                  size={15}
                  className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors ${
                    search.trim() ? "text-accent" : "text-gray-400"
                  }`}
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search devices by name or code..."
                  className={`w-full h-9 pl-10 pr-8 border rounded-xl text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none transition-all bg-white ${
                    search.trim()
                      ? "border-accent/70 ring-1 ring-accent/20 font-medium"
                      : "border-gray-200 focus:border-gray-950 focus:ring-1 focus:ring-gray-950/10"
                  }`}
                />
                {search.trim() && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-0.5 cursor-pointer"
                    title="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="w-full sm:w-56 shrink-0">
                <Select
                  value={productTypeFilter}
                  onChange={(e) => setProductTypeFilter(e.target.value)}
                  triggerClassName={`h-9 rounded-xl text-xs sm:text-sm transition-all ${
                    productTypeFilter !== "all"
                      ? "border-accent/70 bg-accent/[0.03] text-gray-950 font-semibold ring-1 ring-accent/20"
                      : "border-gray-200 text-gray-700"
                  }`}
                  options={[
                    { value: "all", label: "All Device Types" },
                    { value: "switch_board", label: "Switch Boards" },
                    { value: "accessory", label: "Accessories" },
                    { value: "smart_lock", label: "Smart Locks" },
                    { value: "curtain", label: "Curtains / Blinds" },
                    { value: "vdp", label: "Video Door Phones" },
                  ]}
                />
              </div>
            </div>

            {/* Active Filter Chips & Clear Action */}
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-gray-100 text-xs">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mr-1">
                  Active Filters:
                </span>
                {selectedTier && selectedTier !== "all" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-accent font-medium text-[11px]">
                    <span>
                      Tier:{" "}
                      {categoryConfig.configuredTiers.find((t) => t.value === selectedTier)?.label ??
                        selectedTier}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedTier("all")}
                      className="hover:text-red-500 cursor-pointer ml-0.5"
                      title="Clear Tier filter"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
                {selectedFinish && selectedFinish !== "all" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-accent font-medium text-[11px]">
                    <span>
                      Finish:{" "}
                      {categoryConfig.configuredFinishes.find((f) => f.value === selectedFinish)?.label ??
                        selectedFinish}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedFinish("all")}
                      className="hover:text-red-500 cursor-pointer ml-0.5"
                      title="Clear Finish filter"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
                {productTypeFilter !== "all" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-700 font-medium text-[11px]">
                    <span>Type: {productTypeFilter}</span>
                    <button
                      type="button"
                      onClick={() => setProductTypeFilter("all")}
                      className="hover:text-red-500 cursor-pointer ml-0.5"
                      title="Clear Type filter"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
                {search.trim() && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-700 font-medium text-[11px]">
                    <span>Search: &ldquo;{search.trim()}&rdquo;</span>
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="hover:text-red-500 cursor-pointer ml-0.5"
                      title="Clear search"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-[11px] text-gray-500 hover:text-gray-900 underline font-semibold ml-auto cursor-pointer"
                >
                  Reset all filters
                </button>
              </div>
            )}
          </div>

          {/* Product Catalog Grid */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold">
                  Product Catalog
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                  {filteredCatalog.length} {filteredCatalog.length === 1 ? "device" : "devices"}
                </span>
              </div>
              {currentRoom && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-accent/[0.08] border border-accent/25 text-xs text-accent">
                  <span className="text-gray-500 font-normal">Adding into:</span>
                  <span className="font-extrabold text-accent flex items-center gap-1">
                    <MapPin size={11} className="text-accent shrink-0" />
                    <strong className="text-gray-950 font-bold">
                      {getRoomDisplayName(currentRoom, rooms)}
                    </strong>
                    <span className="text-gray-500 font-medium">
                      {" · "}
                      {getEffectiveFloorForRoom(currentRoom, rooms, isMultiFloor)}
                    </span>
                  </span>
                </div>
              )}
            </div>

            {filteredCatalog.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 sm:p-10 text-center text-gray-400 shadow-none">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-3 text-gray-400">
                  <SlidersHorizontal size={22} />
                </div>
                <h4 className="font-bold text-gray-800 text-sm sm:text-base">
                  No devices match your criteria
                </h4>
                <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                  No products in this category satisfy the selected tier, finish, type, or search filter.
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-gray-950 text-white hover:bg-gray-800 transition active:scale-95 cursor-pointer shadow-xs"
                  >
                    <RotateCcw size={12} />
                    <span>Reset Filters</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
                {filteredCatalog.map((catItem) => {
                  const { product: prod, eligibleVariants, minPrice, exactVariant } = catItem;
                  const prodId = Number(prod.id ?? (prod as any)._id);
                  const inRoomCount = currentRoom
                    ? (currentRoom.items || [])
                        .filter((i) => {
                          const pId = Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id);
                          return pId === prodId;
                        })
                        .reduce((acc, i) => acc + (Number(i.quantity) || 1), 0)
                    : 0;

                  return (
                    <div
                      key={prodId}
                      className={`bg-white rounded-xl border p-3.5 transition-all duration-200 flex flex-col justify-between group shadow-none ${
                        inRoomCount > 0
                          ? "border-accent/40 ring-1 ring-accent/20 shadow-2xs"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {/* Top: Product Image */}
                      <div className="w-full h-28 bg-[#FAFAFA] rounded-lg mb-2.5 flex items-center justify-center overflow-hidden relative border border-gray-100">
                        {prod.imageUrl ? (
                          <img
                            src={prod.imageUrl}
                            alt={prod.name}
                            className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1 text-gray-300">
                            <Package size={26} className="text-gray-300" />
                            <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                              {prod.type ? prod.type.replace("_", " ") : "Whyte Device"}
                            </span>
                          </div>
                        )}

                        {prod.moduleSize && (
                          <span className="absolute top-2 right-2 text-[10px] font-mono px-2 py-0.5 rounded bg-white/95 text-gray-700 border border-gray-200 shadow-none">
                            {prod.moduleSize}
                          </span>
                        )}

                        {inRoomCount > 0 && (
                          <span className="absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded bg-accent text-white shadow-xs flex items-center gap-1">
                            <Check size={10} strokeWidth={3} />
                            <span>{inRoomCount > 1 ? `${inRoomCount} in Room` : "In Room"}</span>
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-accent block truncate">
                            {prod.category?.name ?? "Automation"}
                          </span>
                          {eligibleVariants.length > 0 && (
                            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                              {eligibleVariants.length} {eligibleVariants.length === 1 ? "variant" : "variants"}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-gray-950 text-sm leading-snug line-clamp-2">
                          {prod.name}
                        </h4>
                        {prod.code && (
                          <p className="text-[11px] font-mono text-gray-400">{prod.code}</p>
                        )}
                        {prod.description && (
                          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                            {prod.description}
                          </p>
                        )}

                        {/* Selected configuration preview */}
                        {(selectedTier || selectedFinish) && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {selectedTier && selectedTier !== "all" && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-accent-light text-accent-foreground border border-accent-border/60">
                                {categoryConfig.configuredTiers.find((t) => t.value === selectedTier)?.label ?? selectedTier}
                              </span>
                            )}
                            {selectedFinish && selectedFinish !== "all" && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-accent-light text-accent-foreground border border-accent-border/60">
                                {categoryConfig.configuredFinishes.find((f) => f.value === selectedFinish)?.label ?? selectedFinish}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Variants inline display & toggle (strictly scoped to eligibleVariants) */}
                        {(() => {
                          if (eligibleVariants.length <= 1) return null;
                          const isCardExpanded = expandedCardIds.has(prodId);

                          return (
                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={() => toggleCardVariants(prodId)}
                                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-50 hover:bg-gray-100 text-gray-800 transition-colors border border-gray-200/80 cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Layers size={12} className="text-accent" />
                                  <span>{eligibleVariants.length} Matching Variants</span>
                                </span>
                                <span className="flex items-center gap-1 text-[11px] text-accent font-semibold">
                                  <span>{isCardExpanded ? "Hide" : "View"}</span>
                                  <ChevronDown
                                    size={13}
                                    className={`transition-transform duration-200 ${
                                      isCardExpanded ? "rotate-180" : ""
                                    }`}
                                  />
                                </span>
                              </button>

                              {/* Expanded Variants List right on card - ONLY eligible variants shown */}
                              {isCardExpanded && (
                                <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                                  {eligibleVariants.map((v) => {
                                    const vid = Number(v.id ?? (v as any)._id);
                                    const vLabel = getVariantName(v);
                                    const vTier = getVariantTier(v);
                                    const vFinish = getVariantFinish(v);
                                    const vCount = currentRoom
                                      ? (currentRoom.items || [])
                                          .filter(
                                            (i) => {
                                              const pId = Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id);
                                              const pvId = Number(i.productVariantId ?? (i as any).productVariant?.id ?? (i as any).productVariant?._id);
                                              return pId === prodId && pvId === vid;
                                            }
                                          )
                                          .reduce((acc, i) => acc + (Number(i.quantity) || 1), 0)
                                      : 0;

                                    return (
                                      <div
                                        key={vid}
                                        className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-2 transition-all ${
                                          vCount > 0
                                            ? "bg-accent/5 border-accent/40 shadow-2xs"
                                            : "bg-white border-gray-200 hover:border-gray-300"
                                        }`}
                                      >
                                        <div className="min-w-0 flex-1">
                                          <p className="font-semibold text-gray-900 text-[11px] truncate">
                                            {vLabel}
                                          </p>
                                          <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className="font-mono font-bold text-accent text-[11px]">
                                              {formatCurrency(v.price)}
                                            </span>
                                            {vTier && (
                                              <span className="text-[9px] text-gray-400 font-medium capitalize">
                                                {vTier}
                                              </span>
                                            )}
                                            {vFinish && (
                                              <span className="text-[9px] text-gray-400 font-medium capitalize">
                                                • {vFinish}
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => handleAddVariant(prod, v)}
                                          className={`px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                                            vCount > 0
                                              ? "bg-accent text-white hover:bg-accent-hover shadow-2xs"
                                              : "bg-gray-100 hover:bg-gray-200 text-gray-800"
                                          }`}
                                          title={`Add ${vLabel} to ${currentRoom?.customName ?? "room"}`}
                                        >
                                          <Plus size={10} strokeWidth={2.5} />
                                          <span>{vCount > 0 ? `+1 (${vCount})` : "Add"}</span>
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Pricing & Stepper Control Bar */}
                      <div className="mt-3.5 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[10px] text-gray-400 font-normal">
                            {exactVariant
                              ? "Unit Price"
                              : eligibleVariants.length > 1
                              ? "Starting at"
                              : "Unit Price"}
                          </p>
                          <p className="text-sm font-extrabold font-mono text-gray-950">
                            {formatCurrency(exactVariant ? exactVariant.price : minPrice)}
                          </p>
                        </div>

                        {/* Quantity Stepper: [-] [count] [+] */}
                        <div
                          className={`flex items-center border rounded-lg overflow-hidden transition-all ${
                            inRoomCount > 0
                              ? "border-gray-950 bg-gray-950 text-white shadow-xs"
                              : "border-gray-200 bg-gray-50/60 text-gray-700 shadow-none"
                          }`}
                        >
                          <button
                            type="button"
                            disabled={inRoomCount === 0}
                            onClick={() => handleRemoveProductInstance(prod)}
                            className={`w-7 h-7 flex items-center justify-center transition active:scale-90 disabled:opacity-20 disabled:cursor-not-allowed ${
                              inRoomCount > 0
                                ? "hover:bg-white/20 text-white"
                                : "hover:bg-gray-100 text-gray-600"
                            }`}
                            title="Remove one instance"
                          >
                            <Minus size={12} />
                          </button>

                          <span
                            className={`w-7 text-center text-xs font-mono ${
                              inRoomCount > 0 ? "text-white font-bold" : "text-gray-700 font-semibold"
                            }`}
                          >
                            {inRoomCount}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleAddProduct(catItem)}
                            className={`w-7 h-7 flex items-center justify-center transition active:scale-90 ${
                              inRoomCount > 0
                                ? "hover:bg-white/20 text-white"
                                : "hover:bg-gray-100 text-gray-700"
                            }`}
                            title={
                              exactVariant
                                ? `Add ${getVariantName(exactVariant)} to room`
                                : eligibleVariants.length > 1
                                ? "Select from matching variants"
                                : "Add device to room"
                            }
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Sticky Sidebar (Span 4-3) */}
        <div className="lg:col-span-4 xl:col-span-4 2xl:col-span-3 space-y-5 lg:sticky lg:top-20">
          {/* Panel 1: LIVE OVERVIEW */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-none space-y-4">
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-gray-100">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                  Live Overview
                </span>
                <h3 className="text-base font-extrabold text-gray-950 truncate max-w-[200px]">
                  {quotation.clientName || "Proposal Summary"}
                </h3>
                {quotation.clientAddress && (
                  <p className="text-xs text-gray-400 truncate">{quotation.clientAddress}</p>
                )}
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 gap-2.5 py-2.5 px-3 bg-gray-50/70 rounded-xl border border-gray-100">
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Rooms</p>
                <p className="text-base font-bold font-mono text-gray-950">{rooms.length}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Total Products</p>
                <p className="text-base font-bold font-mono text-gray-950">{totalProductsCount}</p>
              </div>
            </div>

            {/* Room Breakdown Scrollable List (Floor Grouped) */}
            <div className="space-y-3 max-h-[240px] overflow-y-auto pr-1 scrollbar-thin">
              {floorGroups.map((group) => (
                <div key={group.floor} className="space-y-1">
                  <div className="flex items-center justify-between px-1 py-0.5 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider border-b border-gray-100/80">
                    <span>{group.floor}</span>
                    <span className="font-mono text-[9px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded">
                      {group.rooms.length} {group.rooms.length === 1 ? "Space" : "Spaces"}
                    </span>
                  </div>
                  <div className="space-y-1 pt-0.5">
                    {group.rooms.map((room) => {
                      const currentId = Number(currentRoom?.id ?? (currentRoom as any)?._id);
                      const roomId = Number(room.id ?? (room as any)._id);
                      const sub = (room.items || []).reduce(
                        (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
                        0
                      );
                      const isCurrent = Boolean(currentId && roomId === currentId);
                      const prodCount = (room.items || []).reduce(
                        (acc, i) => acc + (Number(i.quantity) || 1),
                        0
                      );

                      return (
                        <div
                          key={roomId}
                          onClick={() => onSelectRoom(roomId)}
                          className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between text-xs select-none ${
                            isCurrent
                              ? "bg-gray-950 text-white border-gray-950 shadow-xs"
                              : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                          }`}
                        >
                          <div className="flex flex-col min-w-0 pr-1">
                            <span className="font-semibold truncate">
                              {getRoomDisplayName(room, rooms)}
                            </span>
                            <span
                              className={`text-[10px] truncate ${
                                isCurrent ? "text-gray-300" : "text-gray-400"
                              }`}
                            >
                              {getEffectiveFloorForRoom(room, rooms, isMultiFloor)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                isCurrent ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {prodCount}
                            </span>
                            <span className="font-mono font-bold text-xs">{formatCurrency(sub)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Estimated Total & Continue Action */}
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Estimated Total
                </span>
                <span className="text-lg font-black font-mono text-gray-950">
                  {formatCurrency(grandTotal)}
                </span>
              </div>

              <button
                type="button"
                onClick={onContinue}
                disabled={totalProductsCount === 0}
                title={totalProductsCount === 0 ? "Add at least one product before continuing" : undefined}
                className="w-full py-3 bg-gray-950 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-gray-800 transition active:scale-[0.99] shadow-sm flex items-center justify-center gap-2 select-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-950"
              >
                <span>Continue to Review</span>
                <ArrowRight size={15} />
              </button>
              {totalProductsCount === 0 && (
                <p className="text-[11px] text-center text-gray-400 font-medium">
                  Add at least one product to a space before continuing
                </p>
              )}
            </div>
          </div>

          {/* Panel 2: ADDED PRODUCTS IN ACTIVE ROOM */}
          {currentRoom && (
            <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-none space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    Added Products
                  </h3>
                  <p className="text-sm font-extrabold text-gray-950 mt-0.5 flex items-center gap-1 flex-wrap">
                    <span>{getRoomDisplayName(currentRoom, rooms)}</span>
                    <span className="text-xs font-normal text-gray-400">
                      · {getEffectiveFloorForRoom(currentRoom, rooms, isMultiFloor)}
                    </span>
                  </p>
                </div>

                <span className="text-xs font-bold font-mono text-gray-700 bg-gray-100 px-2.5 py-0.5 rounded-md">
                  {currentRoomProductsCount} {currentRoomProductsCount === 1 ? "device" : "devices"}
                </span>
              </div>

              {(!currentRoom.items || currentRoom.items.length === 0) ? (
                <div className="py-6 text-center text-gray-400">
                  <ShoppingBag size={22} className="mx-auto mb-1.5 opacity-40 text-gray-400" />
                  <p className="text-xs font-semibold text-gray-700">No products added yet</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Click &quot;Add&quot; on any product in the catalog to add devices to this room.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {currentRoom.items.map((item, index) => {
                    const itemId = Number(item.id ?? (item as any)._id);
                    const qty = Number(item.quantity) || 1;
                    const unitPrice = Number(item.unitPrice || 0);
                    const linePrice = qty * unitPrice;

                    return (
                      <div key={itemId} className="py-3.5 space-y-2.5">
                        {/* Product Header: Index, Name, Code, Config, Quantity Stepper & Delete */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[10px] font-mono font-bold text-gray-400">
                                #{index + 1}
                              </span>
                              <h4 className="font-bold text-gray-950 text-xs sm:text-sm leading-snug truncate">
                                {item.product?.name ?? "Product"}
                              </h4>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                              {item.product?.code && (
                                <span className="font-mono text-gray-400">{item.product.code}</span>
                              )}
                              {item.variantLabel && (
                                <>
                                  <span className="text-gray-300">•</span>
                                  <span className="font-medium text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">
                                    {item.variantLabel}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-xs font-extrabold font-mono text-gray-950">
                                {formatCurrency(linePrice)}
                              </span>
                              {qty > 1 && (
                                <span className="text-[10px] text-gray-400 font-mono">
                                  ({formatCurrency(unitPrice)} each)
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Quantity Stepper */}
                            <div className="flex items-center border border-gray-200 rounded-lg bg-gray-50/70 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  if (qty > 1) {
                                    onUpdateItem(itemId, { quantity: qty - 1 });
                                  } else {
                                    onDeleteItem(itemId);
                                  }
                                }}
                                className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-200 active:scale-90 transition"
                                title={qty > 1 ? "Decrease quantity" : "Remove product"}
                              >
                                <Minus size={11} />
                              </button>
                              <span className="w-6 text-center text-xs font-mono font-bold text-gray-900">
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => onUpdateItem(itemId, { quantity: qty + 1 })}
                                className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-200 active:scale-90 transition"
                                title="Increase quantity"
                              >
                                <Plus size={11} />
                              </button>
                            </div>

                            {/* Delete Action */}
                            <button
                              type="button"
                              onClick={() => onDeleteItem(itemId)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="Remove product"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Individual Installation Location Input */}
                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1">
                            <MapPin size={11} className="text-accent shrink-0" />
                            <span>Installation Location</span>
                          </label>
                          <input
                            type="text"
                            value={itemLocations[itemId] ?? item.notes ?? ""}
                            onChange={(e) => handleLocationChange(itemId, e.target.value)}
                            onBlur={() => handleLocationBlur(itemId)}
                            placeholder="e.g. Master switch near entrance, bedside..."
                            className="w-full h-8 px-2.5 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 bg-gray-50/40 focus:bg-white transition"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Room Subtotal Footer */}
              <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700">Room Subtotal</span>
                <span className="text-sm font-extrabold font-mono text-gray-950">
                  {formatCurrency(currentRoomSubtotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Sticky Summary Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg z-30 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-gray-400 font-semibold uppercase">Estimated Total</p>
          <p className="text-base font-extrabold font-mono text-gray-950">
            {formatCurrency(grandTotal)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileSummaryOpen(!mobileSummaryOpen)}
            className="px-3 py-2 border border-gray-300 rounded-xl text-xs font-semibold text-gray-700 bg-white"
          >
            {mobileSummaryOpen ? "Hide Summary" : "View Summary"}
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={totalProductsCount === 0}
            title={totalProductsCount === 0 ? "Add at least one product before continuing" : undefined}
            className="px-4 py-2 bg-gray-950 text-white rounded-xl text-xs font-bold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-950"
          >
            Review →
          </button>
        </div>
      </div>

      {/* Mobile Summary Drawer */}
      {mobileSummaryOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-2xs">
          <div className="bg-white w-full rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-950 text-base">Quotation Breakdown</h3>
              <button
                type="button"
                onClick={() => setMobileSummaryOpen(false)}
                className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-lg"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {rooms.map((room) => {
                const sub = (room.items || []).reduce(
                  (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
                  0
                );
                return (
                  <div key={room.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                    <div className="flex justify-between font-bold text-xs text-gray-900">
                      <span>{room.customName ?? room.roomType?.name}</span>
                      <span className="font-mono">{formatCurrency(sub)}</span>
                    </div>
                    {(room.items || []).map((i) => {
                      const iQty = Number(i.quantity) || 1;
                      return (
                        <div key={i.id} className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>
                            {i.product?.name ?? "Product"}{iQty > 1 ? ` (×${iQty})` : ""}
                          </span>
                          <span className="font-mono">
                            {formatCurrency(iQty * Number(i.unitPrice || 0))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="font-bold text-gray-950">Grand Total</span>
              <span className="font-black font-mono text-lg">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Step Navigation Bar */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-6 border-t border-gray-100">
        <button
          type="button"
          onClick={onBack}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 font-semibold text-sm rounded-xl hover:bg-gray-50 transition"
        >
          <ArrowLeft size={16} />
          Back to Spaces
        </button>

        <button
          type="button"
          onClick={onContinue}
          disabled={totalProductsCount === 0}
          title={totalProductsCount === 0 ? "Add at least one product before continuing" : undefined}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 bg-gray-950 text-white font-semibold text-sm rounded-xl hover:bg-gray-800 active:scale-[0.99] transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-950"
        >
          <span>Continue to Review Quotation</span>
          <ArrowRight size={16} />
        </button>
      </div>

      {/* Variant Picker Modal for Matrix items */}
      {pickerProduct && (
        <VariantPicker
          product={pickerProduct}
          onSelect={(variantId, conf) => {
            const currentRoomId = Number(currentRoom?.id ?? (currentRoom as any)?._id);
            const pId = Number(pickerProduct.id ?? (pickerProduct as any)._id);
            if (currentRoomId && pId) {
              onAddItem(currentRoomId, pId, variantId ? Number(variantId) : undefined, conf);
            }
            setPickerProduct(null);
          }}
          onClose={() => setPickerProduct(null)}
        />
      )}
    </div>
  );
}
