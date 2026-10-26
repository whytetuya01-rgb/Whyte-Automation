"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import Image from "next/image";
import {
  Building,
  MapPin,
  Package,
  Plus,
  Minus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Search,
  X,
  Sparkles,
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Edit3,
  RotateCcw,
  Check,
} from "lucide-react";
import { Quotation, QuotationRoom, QuotationItem, EditorCatalogProduct, Category } from "@/types";
import { formatCurrency, getRoomIcon } from "@/lib/utils";
import UnavailabilityWarning from "./UnavailabilityWarning";
import { eligibleItemsOfRoom } from "@/lib/quotationAvailability";
import { calculateQuotationGst } from "@/lib/pricing";
import { calculateDealerEarning, customerDiscountError } from "@/lib/dealerEarnings";
import { useSession } from "next-auth/react";
import { getRoomDisplayName, getRoomFloorLabel, getRoomFullTitle, groupRoomsByFloor, isMultiFloorHouseType } from "@/lib/roomUtils";
import { Select } from "@/components/ui/Select";
import { getItemImageUrl, formatProposalProductName } from "@/components/proposal-builder/StepProposalPreview";
import ChangeProductModal from "./ChangeProductModal";
import RoomMassEditModal from "./RoomMassEditModal";
import RoomNameEditor from "./RoomNameEditor";




interface Props {
  quotation: Quotation;
  products?: EditorCatalogProduct[];
  categories?: Category[];
  onAddItem?: (
    roomId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>,
    quantity?: number
  ) => Promise<boolean | void>;
  onReplaceItem?: (
    itemId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>,
    unitPrice?: number,
    variantLabel?: string
  ) => Promise<void>;
  onMassUpdateRoomItems?: (
    roomId: number,
    updates: Array<{
      itemId: number;
      productId: number;
      productVariantId?: number | null;
      variantConfig?: Record<string, string> | null;
      variantLabel?: string | null;
      quantity?: number;
    }>
  ) => Promise<void>;
  onUpdateItem: (itemId: number, data: any) => Promise<boolean | void>;
  onDeleteItem: (itemId: number) => Promise<void>;
  onUpdateDiscount: (type: "percentage" | "fixed" | "none", value: number) => Promise<void>;
  /** The same quotation-specific room updater the Space Selection and Product Configuration steps use. */
  onUpdateRoom?: (roomId: number, data: Partial<QuotationRoom>) => Promise<void>;
  onContinue: () => void;
  onBack: () => void;
}

export default function StepReview({
  quotation,
  products = [],
  categories = [],
  onAddItem,
  onReplaceItem,
  onMassUpdateRoomItems,
  onUpdateItem,
  onDeleteItem,
  onUpdateDiscount,
  onUpdateRoom,
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
  const { data: session } = useSession();

  // Product Selector Modal state (for Add or Change)
  const [selectorState, setSelectorState] = useState<{
    isOpen: boolean;
    mode: "add" | "change";
    roomId: number;
    roomName: string;
    targetItem?: QuotationItem;
  } | null>(null);

  // Room-wise Mass Edit state
  const [massEditRoom, setMassEditRoom] = useState<QuotationRoom | null>(null);

  // Custom unit price editing state
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editPriceInput, setEditPriceInput] = useState<string>("");
  const [editPriceError, setEditPriceError] = useState<string | null>(null);
  const [isSavingPrice, setIsSavingPrice] = useState<number | null>(null);

  const getCatalogDefaultPrice = useCallback(
    (item: QuotationItem): number | null => {
      if (item.originalUnitPrice) {
        const parsed = Number(item.originalUnitPrice);
        if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
      }
      if (item.productVariantId && products && products.length > 0) {
        const prod = products.find((p) => Number(p.id ?? (p as any)._id) === Number(item.productId));
        if (prod && Array.isArray(prod.variants)) {
          const v = prod.variants.find((v) => Number(v.id ?? (v as any)._id) === Number(item.productVariantId));
          if (v && v.price !== undefined && v.price !== null) {
            const vp = Number(v.price);
            if (!Number.isNaN(vp)) return vp;
          }
        }
      }
      return null;
    },
    [products]
  );

  const handleStartEditPrice = (item: QuotationItem) => {
    const itemId = Number(item.id ?? (item as any)._id);
    setEditingItemId(itemId);
    setEditPriceInput(Number(item.unitPrice || 0).toString());
    setEditPriceError(null);
  };

  const handleCancelEditPrice = () => {
    setEditingItemId(null);
    setEditPriceInput("");
    setEditPriceError(null);
  };

  const handleSaveCustomPrice = async (item: QuotationItem) => {
    const itemId = Number(item.id ?? (item as any)._id);
    const trimmed = editPriceInput.trim();
    if (trimmed === "") {
      setEditPriceError("Price is required.");
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      setEditPriceError("Please enter a valid number.");
      return;
    }
    if (parsed < 0) {
      setEditPriceError("Price cannot be negative.");
      return;
    }
    const parts = trimmed.split(".");
    if (parts.length > 1 && parts[1].length > 2) {
      setEditPriceError("Maximum 2 decimal places allowed.");
      return;
    }

    const rounded = Math.round(parsed * 100) / 100;

    setIsSavingPrice(itemId);
    setEditPriceError(null);
    try {
      const success = await onUpdateItem(itemId, { unitPrice: rounded });
      if (success !== false) {
        setEditingItemId(null);
        setEditPriceInput("");
      }
    } finally {
      setIsSavingPrice(null);
    }
  };

  const handleResetToDefault = async (itemId: number) => {
    setIsSavingPrice(itemId);
    try {
      const success = await onUpdateItem(itemId, { resetToDefaultPrice: true });
      if (success !== false && editingItemId === itemId) {
        setEditingItemId(null);
        setEditPriceInput("");
        setEditPriceError(null);
      }
    } finally {
      setIsSavingPrice(null);
    }
  };


  const rooms = quotation.rooms || [];
  const isMultiFloor = isMultiFloorHouseType(quotation.houseType);

  const allocatedPercent = Number(quotation.allocatedDiscountPercent || 0);
  const isLocked = quotation.status === "approved" || quotation.status === "delivered";

  // Calculations (unitPrice multiplied by quantity). An Approved/Delivered
  // quotation keeps its historical total regardless of any catalog deletion
  // since; every other status excludes a room/item whose catalog reference
  // has been soft-deleted — the exact same rule the server applies in
  // `normalizeQuotation` (`@/lib/quotationNormalization`) and
  // `aggregateQuotationRoomTotals` (`@/lib/quotationTotals`), so this number
  // never disagrees with a fresh GET of the same quotation.
  const subtotal = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return (
        sum +
        eligibleItemsOfRoom(r, r.items, isLocked).reduce(
          (acc, i) => acc + (i.quantity || 1) * Number(i.unitPrice || 0),
          0
        )
      );
    }, 0);
  }, [rooms, isLocked]);

  const totalDevices = useMemo(() => {
    return rooms.reduce((sum, r) => {
      return (
        sum +
        eligibleItemsOfRoom(r, r.items, isLocked).reduce((acc, i) => acc + (i.quantity || 1), 0)
      );
    }, 0);
  }, [rooms, isLocked]);

  const discountAmount =
    discountType === "percentage"
      ? (subtotal * discountVal) / 100
      : discountType === "fixed"
        ? discountVal
        : 0;

  const gstCalculations = useMemo(() => {
    return calculateQuotationGst(subtotal, discountAmount);
  }, [subtotal, discountAmount]);

  const {
    grossSubtotal,
    discountAmount: clampedDiscount,
    netSubtotal,
    cgstAmount,
    sgstAmount,
    grandTotal,
  } = gstCalculations;

  // Category breakdown for device categorization clarity — same eligibility
  // rule as the subtotal above, so its rows never sum to more than it.
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; subtotal: number }>();
    rooms.forEach((r) => {
      (r.items || []).forEach((item) => {
        if (!isLocked && (r.isUnavailable || item.isUnavailable)) return;
        const catName =
          item.product?.category?.name ||
          (categories.find((c) => Number(c.id ?? (c as any)._id) === Number(item.product?.categoryId))?.name) ||
          "Automation";
        const current = map.get(catName) || { count: 0, subtotal: 0 };
        current.count += item.quantity || 1;
        current.subtotal += (item.quantity || 1) * Number(item.unitPrice || 0);
        map.set(catName, current);
      });
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, ...data }));
  }, [rooms, categories, isLocked]);

  // A quotation that belongs to a dealer is capped at its allocation snapshot (even 0%).
  const hasDealer = quotation.dealerId !== null && quotation.dealerId !== undefined;
  const actorRole = (session?.user as { role?: string } | undefined)?.role;
  const isSalesExecutive = actorRole === "sales_executive";
  const actorIsDealer = actorRole === "dealer";

  // Earning uses the same shared formula as the server (allocated% - customer%).
  const { earningPercent, earningAmount: estimatedEarning } = calculateDealerEarning({
    subtotal,
    allocatedPercent,
    customerPercent: discountType === "percentage" ? discountVal : 0,
  });

  const discountLimitMessage =
    discountType === "percentage"
      ? customerDiscountError({
        hasDealer,
        allocatedPercent,
        customerPercent: discountVal,
        actorIsDealer,
      })
      : null;
  const discountExceedsAllocation = discountLimitMessage !== null;

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
      roomId: Number(roomId),
      roomName,
    });
  };

  // Open Change Product Modal
  const handleOpenChangeModal = (item: QuotationItem, roomId: number, roomName: string) => {
    setSelectorState({
      isOpen: true,
      mode: "change",
      roomId: Number(roomId),
      roomName,
      targetItem: item,
    });
  };

  // Handle Mass Edit Save
  const handleMassEditSave = async (
    updates: Array<{
      itemId: number;
      productId: number;
      productVariantId?: number | null;
      variantConfig?: Record<string, string> | null;
      variantLabel?: string | null;
      quantity?: number;
    }>
  ) => {
    if (!massEditRoom) return;
    const rId = Number(massEditRoom.id ?? (massEditRoom as any)._id);
    if (onMassUpdateRoomItems) {
      await onMassUpdateRoomItems(rId, updates);
    } else if (onReplaceItem) {
      for (const update of updates) {
        await onReplaceItem(
          update.itemId,
          update.productId,
          update.productVariantId ?? undefined,
          update.variantConfig ?? undefined,
          undefined,
          update.variantLabel ?? undefined
        );
      }
    }
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
              <p className="text-[10px] text-gray-400 uppercase font-semibold mb-2">Automated Spaces ({rooms.length})</p>
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
                      <span>{getRoomFullTitle(r, rooms, isMultiFloor)}</span>
                      <span className="text-[11px] font-mono text-gray-400">({count})</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Device Categorization Pills */}
            {categoryBreakdown.length > 0 && (
              <div className="pt-3 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 uppercase font-semibold mb-2">
                  Device Categories ({categoryBreakdown.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {categoryBreakdown.map((cat) => (
                    <div
                      key={cat.name}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-800"
                    >
                      <Package size={13} className="text-accent shrink-0" />
                      <span>{cat.name}</span>
                      <span className="text-[11px] font-mono text-gray-500">({cat.count})</span>
                      <span className="text-[11px] font-mono font-bold text-gray-900 ml-0.5">
                        • {formatCurrency(cat.subtotal)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Products Grouped by Floor / Space */}
          <div className="space-y-6">
            <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold px-1">
              {isMultiFloor ? "Configured Products Grouped Floorwise" : "Configured Products by Space"}
            </h3>

            {groupRoomsByFloor(rooms, isMultiFloor).map((group) => (
              <div key={group.floor} className="space-y-4 pt-1">
                {isMultiFloor && (
                  <div className="flex items-center gap-2 bg-gray-950 text-white px-4 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-wider shadow-xs">
                    <Building size={15} className="text-accent" />
                    <span>Floor / Location: {group.floor}</span>
                    <span className="text-[10px] font-bold text-accent-light bg-accent/20 border border-accent/30 px-2 py-0.5 rounded-full ml-auto">
                      {group.rooms.length} {group.rooms.length === 1 ? "space" : "spaces"}
                    </span>
                  </div>
                )}

                {group.rooms.map((room) => {
                  // Approved/Delivered quotations keep their historical total
                  // regardless of any catalog deletion since; every other
                  // status excludes an unavailable room/item, exactly like
                  // the server-computed grand total — so this header number
                  // never disagrees with the total at the bottom of the page.
                  const eligibleItems = eligibleItemsOfRoom(room, room.items, isLocked);
                  const roomSubtotal = eligibleItems.reduce(
                    (acc, i) => acc + (i.quantity || 1) * Number(i.unitPrice || 0),
                    0
                  );
                  const roomProductCount = eligibleItems.reduce(
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
                              <RoomNameEditor
                                key={`review-room-${room.id}`}
                                roomId={Number(room.id)}
                                name={getRoomDisplayName(room, rooms)}
                                floorLabel={getRoomFloorLabel(room, rooms, isMultiFloor)}
                                onRename={
                                  onUpdateRoom
                                    ? async (roomId, customName) => {
                                      await onUpdateRoom(roomId, { customName });
                                    }
                                    : undefined
                                }
                                disabled={isLocked}
                                prominent
                              />
                            </h4>
                            <p className="text-[11px] text-gray-400">
                              {roomProductCount} {roomProductCount === 1 ? "product" : "products"} configured
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-2.5">
                          <span className="font-mono font-bold text-gray-950 text-sm mr-1">
                            {formatCurrency(roomSubtotal)}
                          </span>

                          {/* Mass Edit Button */}
                          <button
                            type="button"
                            disabled={isLocked || !room.items || room.items.length === 0}
                            onClick={() => setMassEditRoom(room)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-800 text-xs font-semibold hover:bg-gray-100 transition active:scale-95 shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Replace multiple products, variants, and finishes in this space at once"
                          >
                            <SlidersHorizontal size={13} strokeWidth={2} />
                            <span>Mass Edit</span>
                          </button>

                          {/* Add Product Button */}
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() =>
                              handleOpenAddModal(
                                room.id,
                                getRoomDisplayName(room, rooms)
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-950 text-white text-xs font-semibold hover:bg-gray-800 transition active:scale-95 shadow-xs disabled:opacity-40"
                          >
                            <Plus size={13} strokeWidth={2.5} />
                            <span>Add Product</span>
                          </button>
                        </div>
                      </div>

                      {/* Unavailable room type (never shown once Approved/Delivered) */}
                      {!isLocked && room.isUnavailable && (
                        <div className="px-5 py-2.5 border-b border-amber-100">
                          <UnavailabilityWarning
                            reason={room.unavailableReason}
                            label={getRoomDisplayName(room, rooms)}
                          />
                        </div>
                      )}

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
                                getRoomDisplayName(room, rooms)
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
                            const itemId = Number(item.id ?? (item as any)._id);
                            const qty = Number(item.quantity) || 1;
                            const unitPrice = Number(item.unitPrice || 0);
                            const linePrice = qty * unitPrice;
                            const roomId = Number(room.id ?? (room as any)._id);
                            const imgUrl = getItemImageUrl(item);
                            const formattedName = formatProposalProductName(item.product?.name);
                            const rawNotes = item.notes?.trim() || "";
                            const hasValidLocation =
                              Boolean(rawNotes) &&
                              !rawNotes.startsWith("/") &&
                              !rawNotes.includes("whyte_catalog_images") &&
                              !["unspecified", "not specified", "n/a", "unknown", "installation location not specified"].includes(rawNotes.toLowerCase());

                            return (
                              <div
                                key={itemId}
                                className="p-4 sm:p-5 hover:bg-gray-50/60 transition-colors"
                              >
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                                  {/* COLUMN 1 — PRODUCT INFORMATION */}
                                  <div className={`${hasValidLocation ? "md:col-span-6" : "md:col-span-9"} flex items-start gap-3.5 min-w-0`}>
                                    {/* Product Image / Icon */}
                                    <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden mt-0.5">
                                      {imgUrl ? (
                                        <img
                                          src={imgUrl}
                                          alt={formattedName}
                                          className="w-full h-full object-contain p-1"
                                          crossOrigin="anonymous"
                                          onError={(e) => {
                                            (e.target as HTMLElement).style.display = "none";
                                          }}
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
                                          {formattedName}
                                        </h5>
                                      </div>

                                      {/* Unavailable product/variant (never shown once Approved/Delivered, or when the whole room is already flagged above) */}
                                      {!isLocked && !room.isUnavailable && item.isUnavailable && (
                                        <UnavailabilityWarning reason={item.unavailableReason} />
                                      )}

                                      {/* Product Category, Code & Configuration / Tier / Finish */}
                                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                        {(item.product?.category?.name || categories.find((c) => Number(c.id ?? (c as any)._id) === Number(item.product?.categoryId))?.name) && (
                                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-700 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                                            {item.product?.category?.name || categories.find((c) => Number(c.id ?? (c as any)._id) === Number(item.product?.categoryId))?.name}
                                          </span>
                                        )}
                                        {item.product?.code && (
                                          <span className="font-mono text-xs text-gray-400 font-medium">
                                            {item.product.code}
                                          </span>
                                        )}
                                        {((item.product?.category?.name || categories.find((c) => Number(c.id ?? (c as any)._id) === Number(item.product?.categoryId))?.name) || item.product?.code) && item.variantLabel && (
                                          <span className="text-gray-300">•</span>
                                        )}
                                        {item.variantLabel && (
                                          <span className="font-semibold text-accent-foreground bg-accent-light px-2 py-0.5 rounded text-[11px] border border-accent-border/60">
                                            {item.variantLabel}
                                          </span>
                                        )}
                                      </div>

                                      {/* Unit Price & Custom Price Controls */}
                                      {editingItemId === itemId ? (
                                        <div className="mt-2 p-2.5 rounded-xl bg-amber-50/80 border border-amber-200 space-y-2 max-w-sm">
                                          <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                                              Custom Unit Price
                                            </span>
                                            <span className="text-[10px] text-amber-700 font-medium">
                                              This quotation only
                                            </span>
                                          </div>

                                          {(() => {
                                            const catalogPrice = getCatalogDefaultPrice(item);
                                            return catalogPrice != null ? (
                                              <div className="text-[11px] text-gray-500 font-mono">
                                                Catalog price: <span className="font-semibold text-gray-800">{formatCurrency(catalogPrice)}</span>
                                              </div>
                                            ) : null;
                                          })()}

                                          <div className="flex items-center gap-1.5">
                                            <div className="relative flex-1">
                                              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-semibold text-gray-500 font-mono">
                                                ₹
                                              </span>
                                              <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={editPriceInput}
                                                onChange={(e) => {
                                                  setEditPriceInput(e.target.value);
                                                  if (editPriceError) setEditPriceError(null);
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleSaveCustomPrice(item);
                                                  } else if (e.key === "Escape") {
                                                    handleCancelEditPrice();
                                                  }
                                                }}
                                                autoFocus
                                                disabled={isSavingPrice === itemId}
                                                className="w-full pl-6 pr-2 py-1 text-xs font-mono font-bold bg-white text-gray-950 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                placeholder="0.00"
                                              />
                                            </div>

                                            <button
                                              type="button"
                                              disabled={isSavingPrice === itemId}
                                              onClick={() => handleSaveCustomPrice(item)}
                                              className="px-2.5 py-1 bg-gray-950 text-white rounded-lg text-xs font-semibold hover:bg-black transition disabled:opacity-50 active:scale-95 shadow-2xs"
                                            >
                                              {isSavingPrice === itemId ? "Saving..." : "Save"}
                                            </button>

                                            <button
                                              type="button"
                                              disabled={isSavingPrice === itemId}
                                              onClick={handleCancelEditPrice}
                                              className="px-2 py-1 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition active:scale-95"
                                            >
                                              Cancel
                                            </button>
                                          </div>

                                          {editPriceError && (
                                            <p className="text-[11px] font-semibold text-red-600">
                                              {editPriceError}
                                            </p>
                                          )}

                                          {item.isCustomPrice && (
                                            <div className="pt-1 border-t border-amber-200/50 flex justify-end">
                                              <button
                                                type="button"
                                                disabled={isSavingPrice === itemId}
                                                onClick={() => handleResetToDefault(itemId)}
                                                className="text-[11px] font-semibold text-amber-800 hover:text-amber-950 underline flex items-center gap-1"
                                              >
                                                <RotateCcw size={10} />
                                                <span>Reset to catalog price</span>
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                                          <p className="text-xs font-medium text-gray-500 font-mono">
                                            {qty > 1 ? `Qty: ${qty} · ` : ""}{formatCurrency(unitPrice)} each
                                          </p>

                                          {item.isCustomPrice && (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-amber-50 text-amber-800 border border-amber-200/80 shadow-2xs">
                                              Custom Price
                                            </span>
                                          )}

                                          {item.isCustomPrice && (() => {
                                            const catPrice = getCatalogDefaultPrice(item);
                                            return catPrice != null ? (
                                              <span className="text-[11px] text-gray-400 font-mono line-through" title="Catalog price reference">
                                                Catalog: {formatCurrency(catPrice)}
                                              </span>
                                            ) : null;
                                          })()}

                                          {!isLocked && (
                                            <button
                                              type="button"
                                              onClick={() => handleStartEditPrice(item)}
                                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:text-accent-foreground underline hover:no-underline transition"
                                              title="Set custom unit price for this quotation"
                                            >
                                              <Edit3 size={11} />
                                              <span>{item.isCustomPrice ? "Change Price" : "Edit Price"}</span>
                                            </button>
                                          )}

                                          {!isLocked && item.isCustomPrice && (
                                            <button
                                              type="button"
                                              disabled={isSavingPrice === itemId}
                                              onClick={() => handleResetToDefault(itemId)}
                                              className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-900 transition underline"
                                              title="Reset to default catalog price"
                                            >
                                              <RotateCcw size={10} />
                                              <span>Reset to Default</span>
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* COLUMN 2 — INSTALLATION / DETAILS (rendered ONLY if location exists) */}
                                  {hasValidLocation ? (
                                    <div className="md:col-span-3 min-w-0 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100">
                                      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">
                                        <MapPin size={13} className="text-accent shrink-0" />
                                        <span>Installation</span>
                                      </div>
                                      <p className="text-xs sm:text-sm font-semibold text-gray-900 break-words leading-snug">
                                        {item.notes}
                                      </p>
                                    </div>
                                  ) : null}

                                  {/* COLUMN 3 — PRICE / ACTIONS (20–25% -> md:col-span-3) */}
                                  <div className="md:col-span-3 flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-2.5 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100 text-left md:text-right">
                                    <div>
                                      <span className="md:hidden text-[10px] uppercase font-bold text-gray-400 block">Price</span>
                                      <p className="font-mono font-black text-gray-950 text-base sm:text-lg">
                                        {formatCurrency(linePrice)}
                                      </p>
                                    </div>

                                    <div className="flex items-center gap-2">
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
                                        <span className="w-5 text-center text-xs font-mono font-bold text-gray-900">
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

                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleOpenChangeModal(
                                            item,
                                            roomId,
                                            getRoomDisplayName(room, rooms)
                                          )
                                        }
                                        className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-accent-light hover:text-accent-foreground hover:border-accent-border transition active:scale-95 shadow-2xs"
                                      >
                                        Change
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => onDeleteItem(itemId)}
                                        className="p-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition active:scale-95 shadow-2xs"
                                        title="Remove product"
                                      >
                                        <Trash2 size={13} />
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
            ))}
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
            <div className="grid grid-cols-3 gap-2 py-2.5 px-3 bg-gray-50/70 rounded-xl border border-gray-100 text-xs text-center">
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Spaces</p>
                <p className="text-base font-bold font-mono text-gray-950">{rooms.length}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Categories</p>
                <p className="text-base font-bold font-mono text-gray-950">{categoryBreakdown.length}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">Devices</p>
                <p className="text-base font-bold font-mono text-gray-950">{totalDevices}</p>
              </div>
            </div>

            {/* Category Breakdown (Multi-category Overview) */}
            {categoryBreakdown.length > 1 && (
              <div className="space-y-1.5 p-3 rounded-xl bg-gray-50/50 border border-gray-200/70 text-xs">
                <div className="flex items-center justify-between pb-1 border-b border-gray-200/50">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
                    Category Breakdown
                  </span>
                  <span className="text-[10px] font-mono text-gray-400">
                    {categoryBreakdown.length} Categories
                  </span>
                </div>
                <div className="space-y-1 pt-0.5">
                  {categoryBreakdown.map((cat) => (
                    <div key={cat.name} className="flex justify-between items-center text-[11px] text-gray-600">
                      <span className="truncate pr-2">{cat.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-gray-400">×{cat.count}</span>
                        <span className="font-mono font-semibold text-gray-900">{formatCurrency(cat.subtotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  {hasDealer ? "Customer Discount" : "Apply Project Discount"}
                </label>
                {hasDealer && !isSalesExecutive && (
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
                        ...(!hasDealer ? [{ value: "fixed" as const, label: "Fixed Amount (₹)" }] : []),
                      ]}
                    />
                  </div>

                  {discountType !== "none" && (
                    <input
                      type="number"
                      min="0"
                      max={hasDealer ? allocatedPercent : 100}
                      value={discountVal == 0 ? "" : discountVal}
                      onChange={(e) => setDiscountVal(Number(e.target.value))}
                      placeholder={discountType === "percentage" ? "10%" : "₹5000"}
                      className={`w-24 h-9 px-2.5 border rounded-lg text-xs font-mono font-bold bg-white focus:outline-none ${discountExceedsAllocation ? "border-red-400 text-red-600" : "border-gray-200 focus:border-gray-950"
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

              {hasDealer && !isSalesExecutive && !isLocked && discountType === "percentage" && (
                <p className="text-[11px] text-gray-500 font-medium">
                  Maximum allowed: {allocatedPercent}%
                </p>
              )}

              {discountLimitMessage && (
                <p role="alert" className="text-[11px] text-red-600 font-medium">
                  {discountLimitMessage}
                </p>
              )}

              {/* Earning Display for Dealer-owned quotations: confirmed only once approved/delivered */}
              {hasDealer && !isSalesExecutive && (
                <div className="mt-2 pt-2 border-t border-gray-200/60 flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">
                    {isLocked ? "Confirmed Earnings" : "Estimated Earning"} ({earningPercent}%):
                  </span>
                  <span className="font-mono font-bold text-emerald-600">
                    {formatCurrency(estimatedEarning)}
                  </span>
                </div>
              )}

              <p className="text-[11px] text-gray-400">
                Discount reflects in customer proposal calculations
              </p>
            </div>

            {/* Price Summary */}
            <div className="space-y-3.5 pt-1">
              <div className="border-b border-gray-100 pb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Price Summary
                </span>
              </div>

              {/* Subtotal and Discount Rows */}
              <div className="space-y-2 text-xs sm:text-sm">
                <div className="flex justify-between items-center text-gray-600">
                  <span className="font-medium text-gray-600">Subtotal</span>
                  <span className="font-mono font-medium text-gray-900">
                    {formatCurrency(grossSubtotal, { decimals: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span className="flex items-center gap-1.5 font-medium text-gray-600">
                    <span>Discount</span>
                    {clampedDiscount > 0 && discountType === "percentage" && (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        {discountVal}%
                      </span>
                    )}
                  </span>
                  <span className={`font-mono font-medium ${clampedDiscount > 0 ? "text-emerald-600" : "text-gray-900"}`}>
                    {clampedDiscount > 0
                      ? `-${formatCurrency(clampedDiscount, { decimals: 2 })}`
                      : formatCurrency(0, { decimals: 2 })}
                  </span>
                </div>
              </div>

              {/* Net Subtotal - visually more important than Subtotal */}
              <div className="pt-2 border-t border-gray-100">
                <div className="flex justify-between items-baseline py-1">
                  <div>
                    <span className="text-xs sm:text-sm font-bold text-gray-950 block">Net Subtotal</span>
                    <span className="text-[10px] text-gray-400 font-medium">Untaxed Amount</span>
                  </div>
                  <span className="font-mono font-bold text-gray-950 text-sm sm:text-base">
                    {formatCurrency(netSubtotal, { decimals: 2 })}
                  </span>
                </div>
              </div>

              {/* Tax Summary */}
              <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-200/60 space-y-2.5">
                <div className="flex items-center justify-between pb-1.5 border-b border-gray-200/50">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
                    Tax Summary
                  </span>
                  <span className="text-[10px] font-mono font-bold text-accent px-1.5 py-0.5 rounded bg-accent/5 border border-accent/20">
                    GST
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center text-gray-600">
                    {/* <span className="font-medium text-gray-700">CGST @ 9%</span> */}
                    <span className="font-medium text-gray-700">CGST</span>
                    <span className="font-mono font-semibold text-gray-900">
                      {formatCurrency(cgstAmount, { decimals: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-gray-600">
                    {/* <span className="font-medium text-gray-700">SGST/UTGST @ 9%</span> */}
                    <span className="font-medium text-gray-700">SGST/UTGST </span>
                    <span className="font-mono font-semibold text-gray-900">
                      {formatCurrency(sgstAmount, { decimals: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Grand Total */}
              <div className="pt-3 border-t-2 border-gray-950/15">
                <div className="flex justify-between items-baseline gap-2">
                  <div>
                    <span className="text-xs uppercase tracking-wider font-extrabold text-gray-950 block">
                      Grand Total
                    </span>
                    <span className="text-[10px] text-gray-400">
                      Estimated Project Investment
                    </span>
                  </div>
                  <span className="text-2xl font-black font-mono text-gray-950 tracking-tight">
                    {formatCurrency(grandTotal, { decimals: 2 })}
                  </span>
                </div>
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

      {/* Enhanced Product Modal for Add / Change with Variant & Finish Selectors */}
      <ChangeProductModal
        isOpen={Boolean(selectorState?.isOpen)}
        mode={selectorState?.mode ?? "change"}
        roomId={selectorState?.roomId ?? 0}
        roomName={selectorState?.roomName ?? ""}
        targetItem={selectorState?.targetItem}
        products={products}
        categories={categories}
        quotationDefaults={{
          defaultTier: quotation.defaultTier ?? null,
          defaultFinish: quotation.defaultFinish ?? null,
        }}
        onClose={() => setSelectorState(null)}
        onConfirmChange={async ({ itemId, productId, productVariantId, variantConfig, unitPrice, variantLabel }) => {
          if (onReplaceItem) {
            await onReplaceItem(
              itemId,
              productId,
              productVariantId ?? undefined,
              variantConfig ?? undefined,
              unitPrice,
              variantLabel ?? undefined
            );
          }
        }}
        onConfirmAdd={async ({ roomId, productId, productVariantId, variantConfig, unitPrice, variantLabel }) => {
          if (onAddItem) {
            await onAddItem(
              roomId,
              productId,
              productVariantId ?? undefined,
              variantConfig ?? undefined
            );
          }
        }}
      />

      {/* Room-wise Mass Edit Modal */}
      {massEditRoom && (
        <RoomMassEditModal
          isOpen={Boolean(massEditRoom)}
          room={massEditRoom}
          allRooms={rooms}
          isMultiFloor={isMultiFloor}
          products={products}
          categories={categories}
          quotationDefaults={{
            defaultTier: quotation.defaultTier ?? null,
            defaultFinish: quotation.defaultFinish ?? null,
          }}
          onClose={() => setMassEditRoom(null)}
          onSave={handleMassEditSave}
        />
      )}
    </div>
  );
}
