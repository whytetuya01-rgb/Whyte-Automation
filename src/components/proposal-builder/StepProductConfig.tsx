"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ShoppingBag,
  MapPin,
  SlidersHorizontal,
  X,
  RotateCcw,
  Copy,
} from "lucide-react";
import {
  EditorCatalogProduct,
  Category,
  Quotation,
  QuotationRoom,
  QuotationItem,
  EditorCatalogVariant,
} from "@/types";
import { formatCurrency, getRoomIcon } from "@/lib/utils";
import { eligibleItemsOfRoom, isProtectedQuotationStatus } from "@/lib/quotationAvailability";
import UnavailabilityWarning from "./UnavailabilityWarning";
import {
  getRoomDisplayName,
  getRoomFloorLabel,
  groupRoomsByFloor,
  isMultiFloorHouseType,
} from "@/lib/roomUtils";
import { MAX_ITEM_QUANTITY, parseQuantityInput } from "@/lib/quantity";
import RoomNameEditor from "./RoomNameEditor";
import { getCategoryConfig, formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import {
  filterProductCatalog,
  FilteredProductResult,
  getVariantTier,
  getVariantFinish,
} from "@/lib/productFiltering";
import VariantPicker from "@/components/estimator/VariantPicker";
import { Select } from "@/components/ui/Select";
import ChangeProductModal from "./ChangeProductModal";
import LineItemQuantityStepper from "./LineItemQuantityStepper";
import { suggestAccessories } from "@/lib/productAccessories";
import CloneRoomModal from "./CloneRoomModal";
import notify from "@/lib/notify";
import Modal from "@/components/shared/Modal";
import { Button } from "@/components/ui";
import { DeviceCatalogueCard } from "./DeviceCatalogueCard";

/** The quantity of a new entry until the user types another one. */
const DEFAULT_NEW_ENTRY_QUANTITY = "1";

interface Props {
  quotation: Quotation;
  products: EditorCatalogProduct[];
  categories: Category[];
  activeRoomId: number | null;
  onSelectRoom: (roomId: number) => void;
  /** Resolves `false` when the request failed (the editor has already toasted the reason). */
  onAddItem: (
    roomId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>,
    quantity?: number
  ) => Promise<boolean | void>;
  onUpdateItem: (itemId: number, data: any) => Promise<boolean | void>;
  onDeleteItem: (itemId: number) => Promise<void>;
  onClearRoom?: (roomId: number) => Promise<void>;
  onRoomsUpdated?: (rooms: QuotationRoom[]) => void;
  onReplaceItem?: (
    itemId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>,
    unitPrice?: number,
    variantLabel?: string,
    quantity?: number
  ) => Promise<void>;
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
  onClearRoom,
  onRoomsUpdated,
  onReplaceItem,
  onUpdateRoom,
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

  // Approved/Delivered quotations never reach this editor step in practice
  // (the lock rejects the edit before the page gets this far), but the
  // check is explicit rather than assumed — see `isProtectedQuotationStatus`.
  const isLocked = isProtectedQuotationStatus(quotation.status);

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
  // Immediate search input for responsive typing
  const [searchInput, setSearchInput] = useState("");
  // Debounced search query that triggers expensive catalog filtering
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 180);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [productTypeFilter, setProductTypeFilter] = useState<string>("all");

  // Progressive Windowing / Client Pagination State
  const CATALOG_PAGE_SIZE = 24;
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE);

  // Variant Picker Modal State
  const [pickerProduct, setPickerProduct] = useState<EditorCatalogProduct | null>(null);
  const [changeItemTarget, setChangeItemTarget] = useState<QuotationItem | null>(null);

  // Expanded Product Card Variants state
  const [expandedCardIds, setExpandedCardIds] = useState<Set<number>>(new Set());

  // Direct quantity entry. Keys are "<roomId>:<productId>" so a draft or error never leaks to another room or product.
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [qtyErrors, setQtyErrors] = useState<Record<string, string>>({});
  const [addingKeys, setAddingKeys] = useState<Set<string>>(new Set());
  // Synchronous guard: state updates are async, so a fast double click must be stopped by a ref, not by `addingKeys`.
  const addInFlight = useRef<Set<string>>(new Set());

  // Room Duplication & Clearing State
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [confirmClearRoomOpen, setConfirmClearRoomOpen] = useState(false);
  const [clearingRoom, setClearingRoom] = useState(false);

  // Filters state
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedTier && selectedTier !== "all") count++;
    if (selectedFinish && selectedFinish !== "all") count++;
    if (productTypeFilter && productTypeFilter !== "all") count++;
    if (selectedSubcategoryId !== null) count++;
    return count;
  }, [selectedTier, selectedFinish, productTypeFilter, selectedSubcategoryId]);

  const toggleCardVariants = (productId: number) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
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

  // Reset visible count whenever category, filters, or search changes
  useEffect(() => {
    setVisibleCount(CATALOG_PAGE_SIZE);
  }, [selectedCategoryId, selectedSubcategoryId, selectedTier, selectedFinish, productTypeFilter, debouncedSearch]);

  // Reset all filters handler
  const handleResetFilters = () => {
    setSelectedTier("all");
    setSelectedFinish("all");
    setProductTypeFilter("all");
    setSearchInput("");
    setDebouncedSearch("");
    setSelectedSubcategoryId(null);
  };

  const hasActiveFilters = Boolean(
    (selectedTier && selectedTier !== "all") ||
    (selectedFinish && selectedFinish !== "all") ||
    (productTypeFilter && productTypeFilter !== "all") ||
    searchInput.trim() ||
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
      search: debouncedSearch,
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
    debouncedSearch,
    categoryConfig,
  ]);

  // Progressive slice of catalog for render efficiency
  const visibleCatalog = useMemo(() => {
    return filteredCatalog.slice(0, visibleCount);
  }, [filteredCatalog, visibleCount]);

  // Accessories the products in this room usually go with. Only ever SUGGESTED: nothing is added until the person clicks.
  const suggestedAccessories = useMemo(() => {
    const roomProductIds = (currentRoom?.items ?? [])
      .map((i) => Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (roomProductIds.length === 0) return [];
    const byId = new Map(products.map((p) => [Number(p.id ?? (p as any)._id), p]));
    return suggestAccessories(
      roomProductIds,
      products.map((p) => ({ id: Number(p.id ?? (p as any)._id), isActive: p.isActive, accessoryIds: p.accessoryIds }))
    ).flatMap((id) => (byId.get(id) ? [byId.get(id) as EditorCatalogProduct] : []));
  }, [currentRoom, products]);

  const handleAddSuggested = async (product: EditorCatalogProduct) => {
    if (!currentRoom || isLocked) return;
    const roomId = Number(currentRoom.id ?? (currentRoom as any)._id);
    const prodId = Number(product.id ?? (product as any)._id);
    const variants = (product.variants ?? []).filter((v) => v.isActive !== false);
    if (variants.length === 1) return handleAddVariant(product, variants[0]);
    if (variants.length === 0) {
      const key = `${roomId}:${prodId}`;
      if (addInFlight.current.has(key)) return;
      addInFlight.current.add(key);
      setAddingKeys(new Set(addInFlight.current));
      try {
        await onAddItem(roomId, prodId);
      } finally {
        addInFlight.current.delete(key);
        setAddingKeys(new Set(addInFlight.current));
      }
      return;
    }
    // Several variants: the person chooses one in the catalogue below.
    setSearchInput(product.name);
    setDebouncedSearch(product.name);
    setExpandedCardIds((prev) => new Set(prev).add(prodId));
  };

  // Add product handler. Every call creates a NEW, independent quotation item (its own id, quantity, installation
  // location and variant), even when the same product / variant is already in the room: entries are never merged.
  const handleAddProduct = async (catItem: FilteredProductResult) => {
    if (!currentRoom || isLocked) return;
    const roomId = Number(currentRoom.id ?? (currentRoom as any)._id);
    if (!roomId) return;

    const { product, eligibleVariants, exactVariant } = catItem;
    const prodId = Number(product.id ?? (product as any)._id);
    const key = `${roomId}:${prodId}`;
    if (addInFlight.current.has(key)) return;

    if (exactVariant) {
      const varId = Number(exactVariant.id ?? (exactVariant as any)._id);

      const config: Record<string, string> = { ...(exactVariant.config || {}) };
      const vTier = getVariantTier(exactVariant);
      const vFinish = getVariantFinish(exactVariant);
      if (vTier) config.series = vTier;
      if (vFinish) config.finish = vFinish;

      addInFlight.current.add(key);
      setAddingKeys(new Set(addInFlight.current));
      try {
        await onAddItem(
          roomId,
          prodId,
          varId,
          Object.keys(config).length > 0 ? config : undefined
        );
      } finally {
        addInFlight.current.delete(key);
        setAddingKeys(new Set(addInFlight.current));
      }
      return;
    }

    if (eligibleVariants.length > 1) {
      setExpandedCardIds((prev) => new Set(prev).add(prodId));
      return;
    }

    if (eligibleVariants.length === 1) {
      return handleAddVariant(product, eligibleVariants[0]);
    }

    // Flat product without variants
    addInFlight.current.add(key);
    setAddingKeys(new Set(addInFlight.current));
    try {
      await onAddItem(roomId, prodId);
    } finally {
      addInFlight.current.delete(key);
      setAddingKeys(new Set(addInFlight.current));
    }
  };

  // Add a specific variant directly. Always a new, independent entry (never merged into an existing line).
  const handleAddVariant = async (product: EditorCatalogProduct, variant: EditorCatalogVariant) => {
    if (!currentRoom || isLocked) return;
    const roomId = Number(currentRoom.id ?? (currentRoom as any)._id);
    const prodId = Number(product.id ?? (product as any)._id);
    const varId = Number(variant.id ?? (variant as any)._id);
    if (!roomId || !prodId || !varId) return;

    const cardKey = `${roomId}:${prodId}`;
    const variantKey = `${roomId}:${prodId}:${varId}`;
    if (addInFlight.current.has(cardKey) || addInFlight.current.has(variantKey)) return;

    const config: Record<string, string> = { ...(variant.config || {}) };
    const vTier = getVariantTier(variant);
    const vFinish = getVariantFinish(variant);
    if (vTier) config.series = vTier;
    if (vFinish) config.finish = vFinish;

    addInFlight.current.add(variantKey);
    addInFlight.current.add(cardKey);
    setAddingKeys(new Set(addInFlight.current));
    try {
      await onAddItem(
        roomId,
        prodId,
        varId,
        Object.keys(config).length > 0 ? config : undefined
      );
    } finally {
      addInFlight.current.delete(variantKey);
      addInFlight.current.delete(cardKey);
      setAddingKeys(new Set(addInFlight.current));
    }
  };

  const clearQtyEntry = (key: string) => {
    setQtyDrafts((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setQtyErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setQtyError = (key: string, message: string) => setQtyErrors((prev) => ({ ...prev, [key]: message }));

  // "Add" with a typed quantity. The number is the quantity of a NEW entry: every press of Add creates its own
  // quotation item (own id, quantity, installation location and variant) and never touches an existing one, so the
  // same product can sit in the same room several times, each entry managed on its own in "Added Products".
  const handleAddTypedQuantity = async (catItem: FilteredProductResult) => {
    if (!currentRoom || isLocked) return;
    const roomId = Number(currentRoom.id);
    const { product, eligibleVariants, exactVariant } = catItem;
    const prodId = Number(product.id);
    const key = `${roomId}:${prodId}`;
    if (!roomId || !prodId || addInFlight.current.has(key)) return;

    const parsed = parseQuantityInput(qtyDrafts[key] ?? DEFAULT_NEW_ENTRY_QUANTITY);
    if (!parsed.ok) {
      setQtyError(key, parsed.message);
      return;
    }

    const variant = exactVariant ?? (eligibleVariants.length === 1 ? eligibleVariants[0] : null);
    if (!variant && eligibleVariants.length > 1) {
      setExpandedCardIds((prev) => new Set(prev).add(prodId));
      setQtyError(key, "Choose a variant below, then press Add.");
      return;
    }
    const varId = variant ? Number(variant.id) : null;

    addInFlight.current.add(key);
    setAddingKeys(new Set(addInFlight.current));
    setQtyErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const config: Record<string, string> = { ...(variant?.config || {}) };
      if (variant) {
        const vTier = getVariantTier(variant);
        const vFinish = getVariantFinish(variant);
        if (vTier) config.series = vTier;
        if (vFinish) config.finish = vFinish;
      }
      const result = await onAddItem(
        roomId,
        prodId,
        varId ?? undefined,
        Object.keys(config).length > 0 ? config : undefined,
        parsed.value
      );
      if (result === false) {
        setQtyError(key, "Could not add. Your quantity was kept; please try again.");
        return;
      }
      clearQtyEntry(key);
    } catch {
      setQtyError(key, "Could not add. Your quantity was kept; please try again.");
    } finally {
      addInFlight.current.delete(key);
      setAddingKeys(new Set(addInFlight.current));
    }
  };

  // Take one unit off the most recently added entry of this product/variant in the current room (delete the entry
  // when it is down to one). Only that one quotation item is touched; other entries of the same product stay as they are.
  const handleRemoveProductInstance = async (catItem: FilteredProductResult) => {
    if (!currentRoom) return;
    const { product, exactVariant } = catItem;
    const prodId = Number(product.id ?? (product as any)._id);
    const exactVarId = exactVariant ? Number(exactVariant.id ?? (exactVariant as any)._id) : null;

    const matchingItems = (currentRoom.items || []).filter((i) => {
      const pId = Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id);
      if (pId !== prodId) return false;
      if (exactVarId !== null) {
        const pvId = Number(i.productVariantId ?? (i as any).productVariant?.id ?? (i as any).productVariant?._id);
        return pvId === exactVarId;
      }
      return true;
    });
    const matchingItem = matchingItems[matchingItems.length - 1];

    if (!matchingItem) return;
    const itemId = Number(matchingItem.id ?? (matchingItem as any)._id);
    if (!itemId) return;

    const currentQty = Number(matchingItem.quantity) || 1;
    if (currentQty > 1) {
      await onUpdateItem(itemId, { quantity: currentQty - 1 });
    } else {
      await onDeleteItem(itemId);
    }
  };

  // Quotation-specific space name: writes only `customName` on this quotation's room record (the room type, its
  // templates and every other quotation are untouched). Absent when the page was not given a room updater.
  const handleRenameRoom = async (roomId: number, customName: string) => {
    if (!onUpdateRoom) return;
    await onUpdateRoom(roomId, { customName });
  };

  // Totals Calculation for Live Summary. Excludes a room/item whose catalog
  // reference has been soft-deleted — the same rule the server applies in
  // `normalizeQuotation` and `aggregateQuotationRoomTotals` — so this live
  // total never disagrees with a fresh GET of the same quotation.
  const grandTotal = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return (
        sum +
        eligibleItemsOfRoom(r, r.items, isLocked).reduce(
          (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
          0
        )
      );
    }, 0);
  }, [rooms, isLocked]);

  const totalProductsCount = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return sum + eligibleItemsOfRoom(r, r.items, isLocked).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);
    }, 0);
  }, [rooms, isLocked]);

  const currentRoomSubtotal = useMemo(() => {
    if (!currentRoom) return 0;
    return eligibleItemsOfRoom(currentRoom, currentRoom.items, isLocked).reduce(
      (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
      0
    );
  }, [currentRoom, isLocked]);

  const currentRoomProductsCount = useMemo(() => {
    if (!currentRoom) return 0;
    return eligibleItemsOfRoom(currentRoom, currentRoom.items, isLocked).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);
  }, [currentRoom, isLocked]);

  return (
    <div className="w-full space-y-6 pb-24 lg:pb-0">
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
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
              Select Active Room ({rooms.length} {rooms.length === 1 ? "Space" : "Spaces"})
            </span>
            {currentRoom && (
              <span className="text-xs text-gray-500 font-medium hidden sm:inline">
                · Active:{" "}
                <strong className="text-gray-900 font-semibold">
                  {getRoomDisplayName(currentRoom, rooms)}
                </strong>
                {getRoomFloorLabel(currentRoom, rooms, isMultiFloor) && (
                  <span className="text-gray-400 font-normal">
                    {" · "}
                    {getRoomFloorLabel(currentRoom, rooms, isMultiFloor)}
                  </span>
                )}
              </span>
            )}
            {rooms.length > 5 && (
              <select
                value={Number(currentRoom?.id ?? (currentRoom as any)?._id ?? 0)}
                onChange={(e) => onSelectRoom(Number(e.target.value))}
                className="h-7 px-2 text-xs font-semibold rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-800 focus:bg-white cursor-pointer"
              >
                {rooms.map((r) => {
                  const rId = Number(r.id ?? (r as any)._id);
                  const count = eligibleItemsOfRoom(r, r.items, isLocked).reduce(
                    (a, i) => a + (Number(i.quantity) || 1),
                    0
                  );
                  return (
                    <option key={rId} value={rId}>
                      {getRoomDisplayName(r, rooms)} ({count} devices)
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Quick Room Actions: Clone & Clear */}
          {currentRoom && !isLocked && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCloneModalOpen(true)}
                disabled={currentRoomProductsCount === 0 || rooms.length <= 1}
                title={
                  currentRoomProductsCount === 0
                    ? "Add products to this room first to duplicate them"
                    : rooms.length <= 1
                      ? "Add more rooms in Step 2 to duplicate to"
                      : "Clone all devices in this room to other rooms"
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-accent hover:text-accent-hover bg-accent/10 hover:bg-accent/15 border border-accent/25 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed select-none cursor-pointer"
              >
                <Copy size={12} />
                <span>Clone Room</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmClearRoomOpen(true)}
                disabled={currentRoomProductsCount === 0}
                title={
                  currentRoomProductsCount === 0
                    ? "Room has no devices"
                    : "Clear all devices from this room"
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-red-600 bg-gray-50 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed select-none cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Clear</span>
              </button>
            </div>
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
            className={`shrink-0 w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center transition-all cursor-pointer select-none ${canScrollLeft
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
                const roomFloor = getRoomFloorLabel(room, rooms, isMultiFloor);
                const roomSub = eligibleItemsOfRoom(room, room.items, isLocked).reduce(
                  (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
                  0
                );
                const roomProdCount = eligibleItemsOfRoom(room, room.items, isLocked).reduce(
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
                    aria-label={`${roomDisplayName}${roomFloor ? `, ${roomFloor}` : ""}, ${roomProdCount} devices`}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border select-none flex-none shrink-0 cursor-pointer transition-all duration-150 ${isCurrent
                        ? "bg-gray-950 border-accent/40 shadow-xs ring-1 ring-accent/25 text-white"
                        : "bg-white border-gray-200 text-gray-800 hover:border-gray-300 hover:bg-gray-50/70"
                      }`}
                  >
                    {/* Room Icon */}
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isCurrent
                          ? "bg-white/10 text-accent"
                          : "bg-gray-100 text-gray-600"
                        }`}
                    >
                      <IconComp size={15} />
                    </div>

                    {/* Room Name + Floor */}
                    <div className="flex flex-col items-start text-left">
                      <span
                        className={`text-xs font-semibold leading-snug whitespace-nowrap ${isCurrent ? "text-white" : "text-gray-900"
                          }`}
                      >
                        {roomDisplayName}
                      </span>
                      {roomFloor && (
                        <span
                          className={`text-[10px] font-normal leading-none mt-0.5 whitespace-nowrap ${isCurrent ? "text-gray-400" : "text-gray-500"
                            }`}
                        >
                          {roomFloor}
                        </span>
                      )}
                    </div>

                    {/* Device Count Badge */}
                    <span
                      className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-full shrink-0 ${isCurrent
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
                        className={`font-mono text-[11px] font-medium hidden xl:inline shrink-0 ${isCurrent ? "text-gray-400" : "text-gray-500"
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
            className={`shrink-0 w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center transition-all cursor-pointer select-none ${canScrollRight
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
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition border select-none ${isSelected
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

            {/* Search and Filters Toggle Bar */}
            <div className="flex items-center gap-2.5 pt-1">
              <div className="relative flex-1">
                <Search
                  size={15}
                  className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors ${searchInput.trim() ? "text-accent" : "text-gray-400"
                    }`}
                />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search devices by name or code..."
                  className={`w-full h-10 pl-10 pr-8 border rounded-xl text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none transition-all bg-white ${searchInput.trim()
                      ? "border-accent/70 ring-1 ring-accent/20 font-medium"
                      : "border-gray-200 focus:border-gray-950 focus:ring-1 focus:ring-gray-950/10"
                    }`}
                />
                {searchInput.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setDebouncedSearch("");
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-0.5 cursor-pointer"
                    title="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Filters Toggle Button */}
              <button
                type="button"
                onClick={() => setFiltersExpanded(!filtersExpanded)}
                className={`h-10 px-3.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition select-none cursor-pointer shrink-0 ${filtersExpanded || activeFiltersCount > 0
                    ? "bg-accent/10 border-accent/40 text-accent font-bold"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
                  }`}
              >
                <SlidersHorizontal size={13} />
                <span>Filters</span>
                {activeFiltersCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-accent text-neutral-950 font-bold text-[10px] flex items-center justify-center font-mono">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </div>

            {/* Collapsible Advanced Filters Panel */}
            {filtersExpanded && (
              <div className="p-3.5 rounded-xl border border-neutral-200/80 bg-neutral-50/70 space-y-3 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    Advanced Filters
                  </span>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="text-[11px] font-semibold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw size={11} />
                      <span>Reset Filters</span>
                    </button>
                  )}
                </div>

                {/* Subcategories (if any) */}
                {subcategories.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                      Subcategory
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedSubcategoryId(null)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition border select-none ${selectedSubcategoryId === null
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
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition border select-none ${isSelected
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

                {/* Dropdowns Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {categoryConfig.hasAutomationTiers && (
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Automation Tier
                      </label>
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
                        triggerClassName="h-9 rounded-xl text-xs"
                      />
                    </div>
                  )}

                  {categoryConfig.hasSurfaceFinishes && (
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Surface Finish
                      </label>
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
                        triggerClassName="h-9 rounded-xl text-xs"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                      Device Type
                    </label>
                    <Select
                      value={productTypeFilter}
                      onChange={(e) => setProductTypeFilter(e.target.value)}
                      triggerClassName="h-9 rounded-xl text-xs"
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
              </div>
            )}

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
                {searchInput.trim() && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-700 font-medium text-[11px]">
                    <span>Search: &ldquo;{searchInput.trim()}&rdquo;</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInput("");
                        setDebouncedSearch("");
                      }}
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

          {suggestedAccessories.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-3.5 sm:p-4 space-y-2.5" aria-label="Suggested accessories" data-testid="suggested-accessories">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-bold">Suggested accessories</h3>
                <span className="text-[11px] text-gray-400">Usually go with what is in this room</span>
              </div>
              <ul className="flex flex-wrap gap-2">
                {suggestedAccessories.map((accessory) => {
                  const active = (accessory.variants ?? []).filter((v) => v.isActive !== false);
                  return (
                    <li key={accessory.id} className="inline-flex max-w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 py-1.5 pl-3 pr-1.5 text-xs" data-testid="suggested-accessory">
                      <span className="truncate font-semibold text-gray-900">{accessory.name}</span>
                      <button
                        type="button"
                        onClick={() => void handleAddSuggested(accessory)}
                        className="shrink-0 rounded-lg bg-gray-900 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-black cursor-pointer"
                        data-testid="suggested-accessory-add"
                      >
                        {active.length > 1 ? "Choose variant" : "Add"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

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
                    <RoomNameEditor
                      key={`adding-into-${currentRoom.id ?? (currentRoom as any)._id}`}
                      roomId={Number(currentRoom.id ?? (currentRoom as any)._id)}
                      name={getRoomDisplayName(currentRoom, rooms)}
                      floorLabel={getRoomFloorLabel(currentRoom, rooms, isMultiFloor)}
                      onRename={onUpdateRoom ? handleRenameRoom : undefined}
                      disabled={isLocked}
                    />
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
                {visibleCatalog.map((catItem) => {
                  const prodId = Number(catItem.product.id ?? (catItem.product as any)._id);
                  const cardRoomId = currentRoom ? Number(currentRoom.id) : 0;
                  const cardKey = `${cardRoomId}:${prodId}`;
                  return (
                    <DeviceCatalogueCard
                      key={prodId}
                      catItem={catItem}
                      currentRoom={currentRoom}
                      allRooms={rooms}
                      isLocked={isLocked}
                      selectedTier={selectedTier}
                      selectedFinish={selectedFinish}
                      categoryConfig={categoryConfig}
                      isCardExpanded={expandedCardIds.has(prodId)}
                      onToggleExpand={toggleCardVariants}
                      cardKey={cardKey}
                      draftValue={qtyDrafts[cardKey] ?? DEFAULT_NEW_ENTRY_QUANTITY}
                      cardError={qtyErrors[cardKey]}
                      isAdding={addingKeys.has(cardKey)}
                      onDraftChange={(key, val) => setQtyDrafts((prev) => ({ ...prev, [key]: val }))}
                      onClearQtyError={(key) =>
                        setQtyErrors((prev) => {
                          if (!(key in prev)) return prev;
                          const copy = { ...prev };
                          delete copy[key];
                          return copy;
                        })
                      }
                      onAddTypedQuantity={(item) => void handleAddTypedQuantity(item)}
                      onAddProduct={(item) => {
                        clearQtyEntry(cardKey);
                        void handleAddProduct(item);
                      }}
                      onRemoveProductInstance={(item) => {
                        clearQtyEntry(cardKey);
                        void handleRemoveProductInstance(item);
                      }}
                      onAddVariant={(prod, v) => void handleAddVariant(prod, v)}
                    />
                  );
                })}
              </div>
            )}

            {/* Show More / Show All Pagination Controls */}
            {filteredCatalog.length > visibleCount && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4 pb-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => Math.min(prev + CATALOG_PAGE_SIZE, filteredCatalog.length))}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-gray-300 transition shadow-xs active:scale-95 cursor-pointer"
                >
                  <span>Show more devices ({filteredCatalog.length - visibleCount} remaining)</span>
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filteredCatalog.length)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-900 transition underline underline-offset-4 cursor-pointer"
                >
                  Show all {filteredCatalog.length} devices
                </button>
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
                    <span>{isMultiFloor ? group.floor : "All spaces"}</span>
                    <span className="font-mono text-[9px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded">
                      {group.rooms.length} {group.rooms.length === 1 ? "Space" : "Spaces"}
                    </span>
                  </div>
                  <div className="space-y-1 pt-0.5">
                    {group.rooms.map((room) => {
                      const currentId = Number(currentRoom?.id ?? (currentRoom as any)?._id);
                      const roomId = Number(room.id ?? (room as any)._id);
                      const sub = eligibleItemsOfRoom(room, room.items, isLocked).reduce(
                        (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
                        0
                      );
                      const isCurrent = Boolean(currentId && roomId === currentId);
                      const prodCount = eligibleItemsOfRoom(room, room.items, isLocked).reduce(
                        (acc, i) => acc + (Number(i.quantity) || 1),
                        0
                      );

                      return (
                        <div
                          key={roomId}
                          onClick={() => onSelectRoom(roomId)}
                          className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between text-xs select-none ${isCurrent
                              ? "bg-gray-950 text-white border-gray-950 shadow-xs"
                              : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                            }`}
                        >
                          <div className="flex flex-col min-w-0 pr-1">
                            <span className="font-semibold truncate">
                              {getRoomDisplayName(room, rooms)}
                            </span>
                            {getRoomFloorLabel(room, rooms, isMultiFloor) && (
                              <span
                                className={`text-[10px] truncate ${isCurrent ? "text-gray-300" : "text-gray-400"
                                  }`}
                              >
                                {getRoomFloorLabel(room, rooms, isMultiFloor)}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isCurrent ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
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
                  <div className="mt-0.5">
                    <RoomNameEditor
                      key={`added-products-${currentRoom.id ?? (currentRoom as any)._id}`}
                      roomId={Number(currentRoom.id ?? (currentRoom as any)._id)}
                      name={getRoomDisplayName(currentRoom, rooms)}
                      floorLabel={getRoomFloorLabel(currentRoom, rooms, isMultiFloor)}
                      onRename={onUpdateRoom ? handleRenameRoom : undefined}
                      disabled={isLocked}
                      prominent
                    />
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <span className="text-xs font-bold font-mono text-gray-700 bg-gray-100 px-2.5 py-0.5 rounded-md">
                    {currentRoomProductsCount} {currentRoomProductsCount === 1 ? "device" : "devices"}
                  </span>
                  {!isLocked && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCloneModalOpen(true)}
                        disabled={currentRoomProductsCount === 0 || rooms.length <= 1}
                        title="Clone devices to other rooms"
                        className="text-[10px] font-semibold text-accent hover:underline flex items-center gap-0.5 disabled:opacity-40 disabled:no-underline cursor-pointer"
                      >
                        <Copy size={10} />
                        <span>Clone</span>
                      </button>
                      {currentRoomProductsCount > 0 && (
                        <>
                          <span className="text-gray-300 text-[10px]">·</span>
                          <button
                            type="button"
                            onClick={() => setConfirmClearRoomOpen(true)}
                            title="Clear all devices from this room"
                            className="text-[10px] font-medium text-gray-400 hover:text-red-500 hover:underline flex items-center gap-0.5 cursor-pointer"
                          >
                            <Trash2 size={10} />
                            <span>Clear</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {!isLocked && currentRoom.isUnavailable && (
                <UnavailabilityWarning
                  reason={currentRoom.unavailableReason}
                  label={getRoomDisplayName(currentRoom, rooms)}
                />
              )}

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
                              {onReplaceItem && !isLocked && (
                                <button
                                  type="button"
                                  onClick={() => setChangeItemTarget(item)}
                                  className="text-[10px] font-semibold text-accent hover:text-accent-hover hover:underline ml-1 cursor-pointer"
                                  title="Change variant, finish, or product"
                                >
                                  Change
                                </button>
                              )}
                            </div>

                            {!isLocked && !currentRoom.isUnavailable && item.isUnavailable && (
                              <UnavailabilityWarning reason={item.unavailableReason} className="mt-1.5" />
                            )}

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
                            {/* Quantity Stepper with Direct Typed Input */}
                            <LineItemQuantityStepper
                              itemId={itemId}
                              quantity={qty}
                              disabled={isLocked}
                              onUpdateQuantity={(id, newQty) => onUpdateItem(id, { quantity: newQty })}
                              onDelete={(id) => onDeleteItem(id)}
                            />

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
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg z-30 flex items-center justify-between pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
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
                const sub = eligibleItemsOfRoom(room, room.items, isLocked).reduce(
                  (acc, i) => acc + (Number(i.quantity) || 1) * Number(i.unitPrice || 0),
                  0
                );
                return (
                  <div key={room.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                    <div className="flex justify-between font-bold text-xs text-gray-900">
                      <span>{getRoomDisplayName(room, rooms)}</span>
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

      {/* Change Product Modal for editing variant, finish, or replacing device */}
      {changeItemTarget && (
        <ChangeProductModal
          isOpen={Boolean(changeItemTarget)}
          mode="change"
          roomId={Number(currentRoom?.id ?? (currentRoom as any)?._id ?? 0)}
          roomName={getRoomDisplayName(currentRoom, rooms)}
          targetItem={changeItemTarget}
          products={products}
          categories={categories}
          quotationDefaults={{
            defaultTier: quotation.defaultTier ?? null,
            defaultFinish: quotation.defaultFinish ?? null,
          }}
          onClose={() => setChangeItemTarget(null)}
          onConfirmChange={async ({ itemId, productId, productVariantId, variantConfig, unitPrice, variantLabel, quantity }) => {
            if (onReplaceItem) {
              await onReplaceItem(
                itemId,
                productId,
                productVariantId ?? undefined,
                variantConfig ?? undefined,
                unitPrice,
                variantLabel ?? undefined,
                quantity
              );
            }
            setChangeItemTarget(null);
          }}
          onConfirmAdd={async ({ roomId, productId, productVariantId, variantConfig, quantity }) => {
            await onAddItem(
              roomId,
              productId,
              productVariantId ?? undefined,
              variantConfig ?? undefined,
              quantity
            );
            setChangeItemTarget(null);
          }}
        />
      )}

      {/* Clone Room to Other Spaces Modal */}
      {cloneModalOpen && currentRoom && (
        <CloneRoomModal
          isOpen={cloneModalOpen}
          onClose={() => setCloneModalOpen(false)}
          quotationId={String(quotation.id ?? (quotation as any)._id)}
          sourceRoom={currentRoom}
          allRooms={rooms}
          onRoomsUpdated={(updatedRooms) => {
            if (onRoomsUpdated) {
              onRoomsUpdated(updatedRooms);
            }
          }}
        />
      )}

      {/* Confirm Clear Room Modal */}
      {confirmClearRoomOpen && currentRoom && (
        <Modal
          isOpen={confirmClearRoomOpen}
          onClose={() => setConfirmClearRoomOpen(false)}
          title={`Clear devices from ${getRoomDisplayName(currentRoom, rooms)}?`}
          size="sm"
        >
          <div className="space-y-4 pt-1">
            <p className="text-xs text-gray-600 leading-relaxed">
              Are you sure you want to remove all <strong>{currentRoomProductsCount} devices</strong> configured in{" "}
              <strong>{getRoomDisplayName(currentRoom, rooms)}</strong>?
              <br />
              <span className="text-gray-400 text-[11px] block mt-1">
                This will empty this room so you can start fresh or apply another package.
              </span>
            </p>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmClearRoomOpen(false)}
                disabled={clearingRoom}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (!onClearRoom || !currentRoom) return;
                  const rId = Number(currentRoom.id ?? (currentRoom as any)._id);
                  setClearingRoom(true);
                  try {
                    await onClearRoom(rId);
                    setConfirmClearRoomOpen(false);
                  } catch (e: any) {
                    notify.error("Clear room failed", e?.message || "Failed to clear room devices.");
                  } finally {
                    setClearingRoom(false);
                  }
                }}
                loading={clearingRoom}
              >
                <Trash2 size={13} className="mr-1.5" />
                Clear Devices
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
