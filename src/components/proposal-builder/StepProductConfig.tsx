"use client";

import { useState, useMemo, useEffect } from "react";
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
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ShoppingBag,
  Sparkles,
  MapPin,
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
import { getCategoryConfig } from "@/lib/categoryConfig";
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
  const currentRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0] || null;

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
    const parts: string[] = [];
    if (v.config && Object.keys(v.config).length > 0) {
      for (const [, val] of Object.entries(v.config)) {
        if (val) parts.push(val);
      }
    }
    if (parts.length === 0) {
      if (v.automationTier) parts.push(v.automationTier);
      if (v.surfaceFinish) parts.push(v.surfaceFinish);
    }
    return parts.length > 0 ? parts.join(" · ") : "Standard";
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
        locMap[item.id] = item.notes ?? "";
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

  // Set default active room if not set
  useEffect(() => {
    if ((!activeRoomId || !currentRoom) && rooms.length > 0) {
      onSelectRoom(rooms[0].id);
    }
  }, [activeRoomId, currentRoom, rooms, onSelectRoom]);

  // Set default category on first load if available
  useEffect(() => {
    if (selectedCategoryId === null && categories.length > 0) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [categories, selectedCategoryId]);

  // Active Category & Subcategory Objects
  const activeCategory = useMemo(() => {
    return categories.find((c) => c.id === selectedCategoryId) || null;
  }, [categories, selectedCategoryId]);

  const subcategories = useMemo(() => {
    return activeCategory?.children || [];
  }, [activeCategory]);

  const activeSubcategory = useMemo(() => {
    return subcategories.find((c) => c.id === selectedSubcategoryId) || null;
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
      if (!categoryConfig.validTierValues.includes(selectedTier)) {
        setSelectedTier(categoryConfig.configuredTiers[0].value);
      }
    } else {
      setSelectedTier("");
    }

    if (categoryConfig.hasSurfaceFinishes && categoryConfig.configuredFinishes.length > 0) {
      if (!categoryConfig.validFinishValues.includes(selectedFinish)) {
        setSelectedFinish(categoryConfig.configuredFinishes[0].value);
      }
    } else {
      setSelectedFinish("");
    }
  }, [categoryConfig, selectedTier, selectedFinish]);

  // Mandatory Validation State
  const tierRequired = categoryConfig.hasAutomationTiers;
  const finishRequired = categoryConfig.hasSurfaceFinishes;
  const isTierMissing = tierRequired && !selectedTier;
  const isFinishMissing = finishRequired && !selectedFinish;
  const isConfigIncomplete = isTierMissing || isFinishMissing;

  // Filtered Products Catalog
  const filteredProducts = useMemo(() => {
    let list = products;

    if (selectedSubcategoryId) {
      list = list.filter((p) => p.categoryId === selectedSubcategoryId);
    } else if (selectedCategoryId) {
      const subIds = subcategories.map((s) => s.id);
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
  }, [products, selectedCategoryId, selectedSubcategoryId, productTypeFilter, search, subcategories]);

  // Resolve price and variant for a product based on current dynamic tier/finish
  const resolveProductPricing = (product: Product) => {
    if (!product.isMatrix || !product.variants || product.variants.length === 0) {
      return {
        price: Number(product.price || 0),
        variant: null,
        label: null,
      };
    }

    const activeVariants = product.variants.filter((v) => v.isActive);

    if (selectedTier && selectedFinish) {
      const match = activeVariants.find((v) => {
        const conf = v.config || {};
        const tierMatch =
          v.automationTier === selectedTier ||
          conf.series === selectedTier ||
          conf.tier === selectedTier;
        const finishMatch =
          v.surfaceFinish === selectedFinish || conf.finish === selectedFinish;
        return tierMatch && finishMatch;
      });
      if (match) {
        return {
          price: Number(match.price),
          variant: match,
          label: `${selectedTier} + ${selectedFinish}`,
        };
      }
    } else if (selectedTier) {
      const match = activeVariants.find((v) => {
        const conf = v.config || {};
        return (
          v.automationTier === selectedTier ||
          conf.series === selectedTier ||
          conf.tier === selectedTier
        );
      });
      if (match) {
        return {
          price: Number(match.price),
          variant: match,
          label: selectedTier,
        };
      }
    }

    const minPrice = Math.min(...activeVariants.map((v) => Number(v.price || 0)));
    return {
      price: minPrice,
      variant: null,
      label: null,
    };
  };

  // Add product handler - ALWAYS creates a new independent product record
  const handleAddProduct = async (product: Product) => {
    if (!currentRoom || isConfigIncomplete) return;
    const { variant } = resolveProductPricing(product);

    if (product.isMatrix && !variant) {
      setPickerProduct(product);
      return;
    }

    const config: Record<string, string> = {};
    if (selectedTier) config.series = selectedTier;
    if (selectedFinish) config.finish = selectedFinish;

    await onAddItem(
      currentRoom.id,
      product.id,
      variant ? variant.id : undefined,
      Object.keys(config).length > 0 ? config : undefined
    );
  };

  // Remove one instance of product in current room
  const handleRemoveProductInstance = async (product: Product) => {
    if (!currentRoom) return;
    const matchingItems = currentRoom.items.filter((i) => i.productId === product.id);
    if (matchingItems.length === 0) return;
    const lastItem = matchingItems[matchingItems.length - 1];
    await onDeleteItem(lastItem.id);
  };

  // Totals Calculation for Live Summary
  const grandTotal = useMemo(() => {
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

  const totalProductsCount = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return sum + (r.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
    }, 0);
  }, [rooms]);

  const currentRoomSubtotal = useMemo(() => {
    if (!currentRoom || !currentRoom.items) return 0;
    return currentRoom.items.reduce(
      (acc, i) => acc + (i.quantity || 1) * Number(i.unitPrice || 0),
      0
    );
  }, [currentRoom]);

  const currentRoomProductsCount = useMemo(() => {
    if (!currentRoom || !currentRoom.items) return 0;
    return currentRoom.items.reduce((acc, i) => acc + (i.quantity || 1), 0);
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
      <div className="bg-white rounded-2xl border border-gray-200 p-3 shadow-none">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
            Select Active Room ({rooms.length} Spaces)
          </span>
          <span className="text-xs text-gray-500 font-medium hidden sm:inline">
            Active: <strong className="text-gray-900">{currentRoom?.customName ?? currentRoom?.roomType?.name}</strong>
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {rooms.map((room) => {
            const isCurrent = room.id === currentRoom?.id;
            const IconComp = getRoomIcon(room.customName ?? room.roomType?.name ?? "Room");
            const roomSub = (room.items || []).reduce(
              (acc, i) => acc + Number(i.unitPrice || 0),
              0
            );
            const roomProdCount = room.items ? room.items.length : 0;

            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onSelectRoom(room.id)}
                className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 border select-none ${
                  isCurrent
                    ? "bg-gray-950 text-white border-accent/40 shadow-xs ring-1 ring-accent/25"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    isCurrent ? "bg-white/15 text-accent" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  <IconComp size={14} />
                </div>
                <span className="truncate max-w-[120px] sm:max-w-[150px]">
                  {room.customName ?? room.roomType?.name}
                </span>

                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    isCurrent ? "bg-accent/20 text-accent-light border border-accent/30 font-bold" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {roomProdCount}
                </span>

                {roomSub > 0 && (
                  <span
                    className={`font-mono text-[11px] hidden md:inline ${
                      isCurrent ? "text-gray-300" : "text-gray-500"
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
                  const isSelected = selectedCategoryId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategoryId(cat.id);
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
                    const isSelected = selectedSubcategoryId === sub.id;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setSelectedSubcategoryId(sub.id)}
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
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Automation Tier <span className="text-red-500">*</span>
                    </label>
                    <Select
                      value={selectedTier}
                      onChange={(e) => setSelectedTier(e.target.value)}
                      placeholder="— Select Automation Tier —"
                      options={[
                        { value: "", label: "— Select Automation Tier —" },
                        ...categoryConfig.configuredTiers.map((t) => ({
                          value: t.value,
                          label: t.label,
                        })),
                      ]}
                      triggerClassName={`h-10 rounded-xl text-xs sm:text-sm font-medium ${
                        isTierMissing
                          ? "border-red-400 text-red-700 ring-1 ring-red-400/20"
                          : "border-gray-200 text-gray-900 focus:border-gray-950 focus:ring-1 focus:ring-gray-950/10"
                      }`}
                    />
                  </div>
                )}

                {categoryConfig.hasSurfaceFinishes && (
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Surface Finish <span className="text-red-500">*</span>
                    </label>
                    <Select
                      value={selectedFinish}
                      onChange={(e) => setSelectedFinish(e.target.value)}
                      placeholder="— Select Surface Finish —"
                      options={[
                        { value: "", label: "— Select Surface Finish —" },
                        ...categoryConfig.configuredFinishes.map((f) => ({
                          value: f.value,
                          label: f.label,
                        })),
                      ]}
                      triggerClassName={`h-10 rounded-xl text-xs sm:text-sm font-medium ${
                        isFinishMissing
                          ? "border-red-400 text-red-700 ring-1 ring-red-400/20"
                          : "border-gray-200 text-gray-900 focus:border-gray-950 focus:ring-1 focus:ring-gray-950/10"
                      }`}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Validation notice if mandatory tier/finish missing */}
            {isConfigIncomplete && (
              <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200 flex items-center gap-2 text-xs text-amber-800">
                <AlertCircle size={15} className="shrink-0 text-amber-600" />
                <span>
                  Please select the required{" "}
                  <strong>{isTierMissing ? "Automation Tier" : "Surface Finish"}</strong> to
                  configure devices for this category.
                </span>
              </div>
            )}

            {/* Search and Product Type Filter */}
            <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-gray-100">
              <div className="relative flex-1">
                <Search
                  size={15}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search devices by name or code..."
                  className="w-full h-9 pl-10 pr-3.5 border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-950 focus:ring-1 focus:ring-gray-950/10 bg-white"
                />
              </div>

              <div className="w-full sm:w-56 shrink-0">
                <Select
                  value={productTypeFilter}
                  onChange={(e) => setProductTypeFilter(e.target.value)}
                  triggerClassName="h-9 rounded-xl text-xs sm:text-sm text-gray-700 border-gray-200"
                  options={[
                    { value: "all", label: "All Device Types" },
                    { value: "switch_board", label: "Switch Boards" },
                    { value: "retrofit", label: "Retrofit Modules" },
                    { value: "accessory", label: "Accessories" },
                    { value: "smart_lock", label: "Smart Locks" },
                    { value: "curtain", label: "Curtains / Blinds" },
                    { value: "vdp", label: "Video Door Phones" },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Product Catalog Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold">
                Product Catalog ({filteredProducts.length} devices)
              </h3>
              {currentRoom && (
                <span className="text-xs text-gray-500 font-medium">
                  Adding into:{" "}
                  <strong className="text-gray-950">
                    {currentRoom.customName ?? currentRoom.roomType?.name}
                  </strong>
                </span>
              )}
            </div>

            {filteredProducts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400 shadow-none">
                <Package size={32} className="mx-auto text-gray-300 mb-2" />
                <p className="font-semibold text-gray-800 text-sm">No products found</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Try clearing search or switching categories.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
                {filteredProducts.map((prod) => {
                  const { price } = resolveProductPricing(prod);
                  const inRoomCount = currentRoom
                    ? currentRoom.items.filter((i) => i.productId === prod.id).length
                    : 0;

                  return (
                    <div
                      key={prod.id}
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
                          <Package size={26} className="text-gray-300" />
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
                          {prod.variants && prod.variants.length > 1 && (
                            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                              {prod.variants.filter((v) => v.isActive).length} variants
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
                            {selectedTier && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-accent-light text-accent-foreground border border-accent-border/60">
                                {selectedTier}
                              </span>
                            )}
                            {selectedFinish && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-accent-light text-accent-foreground border border-accent-border/60">
                                {selectedFinish}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Variants inline display & toggle */}
                        {(() => {
                          const activeVariants = (prod.variants || []).filter((v) => v.isActive);
                          if (activeVariants.length <= 1) return null;
                          const isCardExpanded = expandedCardIds.has(prod.id);

                          return (
                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={() => toggleCardVariants(prod.id)}
                                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-50 hover:bg-gray-100 text-gray-800 transition-colors border border-gray-200/80 cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Layers size={12} className="text-accent" />
                                  <span>{activeVariants.length} Variants</span>
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

                              {/* Expanded Variants List right on card */}
                              {isCardExpanded && (
                                <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                                  {activeVariants.map((v) => {
                                    const vLabel = getVariantName(v);
                                    const vCount = currentRoom
                                      ? currentRoom.items.filter(
                                          (i) => i.productId === prod.id && i.productVariantId === v.id
                                        ).length
                                      : 0;

                                    return (
                                      <div
                                        key={v.id}
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
                                          <p className="font-mono font-bold text-accent text-[11px]">
                                            {formatCurrency(v.price)}
                                          </p>
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => onAddItem(currentRoom!.id, prod.id, v.id, v.config)}
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
                            {prod.variants && prod.variants.filter((v) => v.isActive).length > 1 && !selectedTier && !selectedFinish
                              ? "Starting at"
                              : "Unit Price"}
                          </p>
                          <p className="text-sm font-extrabold font-mono text-gray-950">
                            {formatCurrency(price)}
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
                            disabled={isConfigIncomplete}
                            onClick={() => handleAddProduct(prod)}
                            className={`w-7 h-7 flex items-center justify-center transition active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed ${
                              inRoomCount > 0
                                ? "hover:bg-white/20 text-white"
                                : "hover:bg-gray-100 text-gray-700"
                            }`}
                            title={
                              isConfigIncomplete
                                ? "Select required tier/finish first"
                                : "Add product to room"
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

            {/* Room Breakdown Scrollable List */}
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
              {rooms.map((room) => {
                const sub = (room.items || []).reduce(
                  (acc, i) => acc + Number(i.unitPrice || 0),
                  0
                );
                const isCurrent = room.id === currentRoom?.id;
                const prodCount = room.items ? room.items.length : 0;

                return (
                  <div
                    key={room.id}
                    onClick={() => onSelectRoom(room.id)}
                    className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between text-xs select-none ${
                      isCurrent
                        ? "bg-gray-950 text-white border-gray-950 shadow-xs"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold truncate">
                        {room.customName ?? room.roomType?.name}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          isCurrent ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {prodCount} {prodCount === 1 ? "product" : "products"}
                      </span>
                    </div>
                    <span className="font-mono font-bold shrink-0">{formatCurrency(sub)}</span>
                  </div>
                );
              })}
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
                className="w-full py-3 bg-gray-950 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-gray-800 transition active:scale-[0.99] shadow-sm flex items-center justify-center gap-2 select-none"
              >
                <span>Continue to Review</span>
                <ArrowRight size={15} />
              </button>
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
                  <p className="text-sm font-extrabold text-gray-950 mt-0.5">
                    {currentRoom.customName ?? currentRoom.roomType?.name} ·{" "}
                    <span className="font-normal text-xs text-gray-500">
                      {currentRoom.items.length}{" "}
                      {currentRoom.items.length === 1 ? "product" : "products"}
                    </span>
                  </p>
                </div>

                <span className="text-xs font-bold font-mono text-gray-700 bg-gray-100 px-2.5 py-0.5 rounded-md">
                  {currentRoomProductsCount} {currentRoomProductsCount === 1 ? "product" : "products"}
                </span>
              </div>

              {currentRoom.items.length === 0 ? (
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
                    const unitPrice = Number(item.unitPrice || 0);

                    return (
                      <div key={item.id} className="py-3.5 space-y-2.5">
                        {/* Product Header: Index, Name, Code, Config & Delete */}
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

                            <p className="text-xs font-extrabold font-mono text-gray-950 mt-1">
                              {formatCurrency(unitPrice)}
                            </p>
                          </div>

                          {/* Delete Action (No quantity badge, no aggregation) */}
                          <button
                            type="button"
                            onClick={() => onDeleteItem(item.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition shrink-0"
                            title="Remove product"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Individual Installation Location Input */}
                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1">
                            <MapPin size={11} className="text-accent shrink-0" />
                            <span>Installation Location</span>
                          </label>
                          <input
                            type="text"
                            value={itemLocations[item.id] ?? item.notes ?? ""}
                            onChange={(e) => handleLocationChange(item.id, e.target.value)}
                            onBlur={() => handleLocationBlur(item.id)}
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
            className="px-4 py-2 bg-gray-950 text-white rounded-xl text-xs font-bold hover:bg-gray-800"
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
                  (acc, i) => acc + Number(i.unitPrice || 0),
                  0
                );
                return (
                  <div key={room.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                    <div className="flex justify-between font-bold text-xs text-gray-900">
                      <span>{room.customName ?? room.roomType?.name}</span>
                      <span className="font-mono">{formatCurrency(sub)}</span>
                    </div>
                    {(room.items || []).map((i) => (
                      <div key={i.id} className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>{i.product?.name ?? "Product"}</span>
                        <span className="font-mono">
                          {formatCurrency(Number(i.unitPrice || 0))}
                        </span>
                      </div>
                    ))}
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
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 bg-gray-950 text-white font-semibold text-sm rounded-xl hover:bg-gray-800 active:scale-[0.99] transition shadow-sm"
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
            if (currentRoom) {
              onAddItem(currentRoom.id, pickerProduct.id, variantId, conf);
            }
            setPickerProduct(null);
          }}
          onClose={() => setPickerProduct(null)}
        />
      )}
    </div>
  );
}
