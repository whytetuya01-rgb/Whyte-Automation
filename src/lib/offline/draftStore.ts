/**
 * Whyte Automations — Offline Quotation Draft Store & Autosave Manager
 *
 * Implements client-side draft authoring, autosave debouncing, calculation
 * parity with online rules, and cloning price-reset behavior.
 *
 * All drafts use temporary IDs: `draft_<uuid>`.
 * Official quotation numbers (e.g. QT-2026-XXX) are strictly forbidden offline.
 */

import {
  saveDraftToStores,
  getDraftFromStores,
  listDraftsFromStores,
  deleteDraftFromStores,
  buildTenantKey,
  type OfflineQuotationDraft,
  type OfflineQuotationDraftRoom,
  type OfflineQuotationDraftItem,
  type OfflineCalculationSnapshot,
  type OfflineDraftStatus,
} from "./db";
import { calculateQuotationGst, round2, parseFinancialNumber } from "@/lib/pricing";
import { calculateDealerEarning, toPlainNumber } from "@/lib/dealerEarnings";
import type { EditorCatalogProduct } from "@/types";

/**
 * Generate a safe client-side UUID for offline drafts and child items
 */
export function generateClientDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draft_${crypto.randomUUID()}`;
  }
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateClientEntityId(prefix: "room" | "item"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Pure calculation parity function for offline drafts.
 * Reuses existing `calculateQuotationGst` and `calculateDealerEarning`.
 */
export function calculateDraftTotals(params: {
  rooms: OfflineQuotationDraftRoom[];
  discountType?: "percentage" | "fixed";
  discountValue?: number;
  dealerDiscountAllocationPercent?: number;
}): OfflineCalculationSnapshot {
  const {
    rooms,
    discountType = "percentage",
    discountValue = 0,
    dealerDiscountAllocationPercent = 0,
  } = params;

  let grossSubtotal = 0;

  for (const room of rooms || []) {
    for (const item of room.items || []) {
      const qty = Math.max(1, Number(item.quantity || 1));
      const unitPrice = parseFinancialNumber(item.unitPrice, 0);
      const lineTotal = round2(qty * unitPrice);
      item.lineTotal = lineTotal.toFixed(2);
      grossSubtotal += lineTotal;
    }
  }

  grossSubtotal = round2(grossSubtotal);

  // Discount calculation
  let discountAmount = 0;
  let customerDiscountPercent = 0;

  if (discountType === "percentage") {
    customerDiscountPercent = Math.max(0, Math.min(100, Number(discountValue || 0)));
    discountAmount = round2(grossSubtotal * (customerDiscountPercent / 100));
  } else {
    discountAmount = Math.max(0, Math.min(grossSubtotal, Number(discountValue || 0)));
    customerDiscountPercent = grossSubtotal > 0 ? round2((discountAmount / grossSubtotal) * 100) : 0;
  }

  // GST calculation (authoritative pure function)
  const gst = calculateQuotationGst(grossSubtotal, discountAmount);

  // Dealer earnings calculation (authoritative pure function)
  const dealerEarning = calculateDealerEarning({
    subtotal: grossSubtotal,
    allocatedPercent: dealerDiscountAllocationPercent,
    customerPercent: customerDiscountPercent,
  });

  return {
    grossSubtotal: gst.grossSubtotal,
    discountType,
    discountValue: Number(discountValue || 0),
    discountAmount: gst.discountAmount,
    netSubtotal: gst.netSubtotal,
    cgstPercent: gst.cgstPercent,
    cgstAmount: gst.cgstAmount,
    sgstPercent: gst.sgstPercent,
    sgstAmount: gst.sgstAmount,
    totalGstAmount: gst.totalGstAmount,
    grandTotal: gst.grandTotal,
    dealerDiscountAllocationPercent,
    customerDiscountPercent,
    estimatedDealerEarning: dealerEarning.earningAmount,
  };
}

/**
 * Creates a brand new offline quotation draft initialized with default values
 */
export function createEmptyOfflineDraft(params: {
  companyId: number;
  companyName: string;
  userId: number;
  userName: string;
  userRole: string;
  catalogVersion: string;
  allocatedDiscountPercent?: number;
}): OfflineQuotationDraft {
  const tenantKey = buildTenantKey(params.companyId, params.userId);
  const now = new Date().toISOString();
  const id = generateClientDraftId();

  const emptyCalculation = calculateDraftTotals({
    rooms: [],
    discountType: "percentage",
    discountValue: 0,
    dealerDiscountAllocationPercent: params.allocatedDiscountPercent || 0,
  });

  return {
    id,
    tenantKey,
    companyId: params.companyId,
    companyName: params.companyName,
    userId: params.userId,
    userName: params.userName,
    userRole: params.userRole,
    clientName: "",
    houseTypeId: 0,
    catalogVersion: params.catalogVersion || "v0",
    revision: 1,
    status: "LOCAL_DRAFT",
    createdAt: now,
    updatedAt: now,
    rooms: [],
    calculation: emptyCalculation,
    roomCount: 0,
    deviceCount: 0,
  };
}

/**
 * Save an offline draft directly to IndexedDB.
 */
export async function saveOfflineDraft(
  draft: OfflineQuotationDraft
): Promise<{ success: boolean; revision: number; error?: string }> {
  try {
    // Recalculate totals before saving to ensure calculation integrity
    const calculation = calculateDraftTotals({
      rooms: draft.rooms || [],
      discountType: draft.calculation?.discountType,
      discountValue: draft.calculation?.discountValue,
      dealerDiscountAllocationPercent: draft.calculation?.dealerDiscountAllocationPercent,
    });

    const draftToSave: OfflineQuotationDraft = {
      ...draft,
      calculation,
      status: "LOCAL_SAVED",
    };

    const nextRevision = await saveDraftToStores(draftToSave);
    draft.revision = nextRevision;
    return { success: true, revision: nextRevision };
  } catch (error: any) {
    console.error("Failed to save offline draft:", error);
    return { success: false, revision: draft.revision, error: error?.message || "Storage error" };
  }
}

/**
 * Retrieve an offline draft by ID for an authorized tenant
 */
export async function loadOfflineDraft(
  companyId: number | string,
  userId: number | string,
  draftId: string
): Promise<OfflineQuotationDraft | null> {
  const tenantKey = buildTenantKey(companyId, userId);
  return getDraftFromStores(tenantKey, draftId);
}

/**
 * List all offline drafts for an authorized tenant
 */
export async function listOfflineDrafts(
  companyId: number | string,
  userId: number | string
): Promise<OfflineQuotationDraft[]> {
  const tenantKey = buildTenantKey(companyId, userId);
  return listDraftsFromStores(tenantKey);
}

/**
 * Delete an offline draft
 */
export async function deleteOfflineDraft(
  companyId: number | string,
  userId: number | string,
  draftId: string
): Promise<boolean> {
  try {
    const tenantKey = buildTenantKey(companyId, userId);
    await deleteDraftFromStores(tenantKey, draftId);
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.removeItem(`whyte_draft_backup_${tenantKey}_${draftId}`);
      } catch {}
    }
    return true;
  } catch (error) {
    console.error("Failed to delete offline draft:", error);
    return false;
  }
}

/**
 * Duplicate an existing offline draft.
 * STRICT REQUIREMENT (Rule #9):
 * When duplicated, selected product prices MUST reset to the current default
 * Product Master prices from the downloaded catalog, not carry forward custom overrides.
 */
export async function duplicateOfflineDraft(params: {
  sourceDraft: OfflineQuotationDraft;
  currentCatalog: EditorCatalogProduct[];
  catalogVersion: string;
}): Promise<{
  newDraft: OfflineQuotationDraft;
  skippedUnavailableItems: string[];
}> {
  const { sourceDraft, currentCatalog, catalogVersion } = params;
  const now = new Date().toISOString();
  const newDraftId = generateClientDraftId();
  const skippedUnavailableItems: string[] = [];

  // Index current catalog variants for default price resolution
  const variantPriceMap = new Map<number, string>();
  for (const prod of currentCatalog) {
    for (const v of prod.variants || []) {
      variantPriceMap.set(v.id, String(v.price));
    }
  }

  const newRooms: OfflineQuotationDraftRoom[] = [];

  for (const srcRoom of sourceDraft.rooms || []) {
    const newRoomId = generateClientEntityId("room");
    const newItems: OfflineQuotationDraftItem[] = [];

    for (const srcItem of srcRoom.items || []) {
      const defaultCatalogPrice = variantPriceMap.get(srcItem.variantId);

      if (!defaultCatalogPrice) {
        // Item is no longer available in the downloaded catalog
        skippedUnavailableItems.push(srcItem.productName || `Item #${srcItem.productId}`);
        continue;
      }

      // RESET price to current Product Master default price!
      newItems.push({
        ...srcItem,
        id: generateClientEntityId("item"),
        draftId: newDraftId,
        roomId: newRoomId,
        defaultUnitPrice: defaultCatalogPrice,
        unitPrice: defaultCatalogPrice, // RESET: Do not carry custom overrides forward
        isCustomPrice: false,
        lineTotal: (Number(defaultCatalogPrice) * Math.max(1, srcItem.quantity)).toFixed(2),
      });
    }

    newRooms.push({
      ...srcRoom,
      id: newRoomId,
      draftId: newDraftId,
      items: newItems,
    });
  }

  const calculation = calculateDraftTotals({
    rooms: newRooms,
    discountType: sourceDraft.calculation?.discountType,
    discountValue: sourceDraft.calculation?.discountValue,
    dealerDiscountAllocationPercent: sourceDraft.calculation?.dealerDiscountAllocationPercent,
  });

  const duplicatedDraft: OfflineQuotationDraft = {
    ...sourceDraft,
    id: newDraftId,
    clientName: `${sourceDraft.clientName} (Copy)`.trim(),
    catalogVersion,
    revision: 1,
    status: "LOCAL_SAVED",
    createdAt: now,
    updatedAt: now,
    rooms: newRooms,
    calculation,
    roomCount: newRooms.length,
    deviceCount: newRooms.reduce((acc, r) => acc + r.items.reduce((sum, i) => sum + (i.quantity || 1), 0), 0),
  };

  await saveDraftToStores(duplicatedDraft);
  return { newDraft: duplicatedDraft, skippedUnavailableItems };
}

/**
 * The editor addresses quotation items by a numeric id, while a stored draft keeps string ids (`item_<digits>` for items
 * added in the editor, `item_<uuid>` for items created by cloning a draft). Every item must keep its OWN id when a draft
 * is restored, otherwise two entries of the same product would answer to one id and update / delete each other.
 *
 *  - `item_<digits>` keeps exactly that number (a timestamp-based id is far longer than 8 digits, so truncating it made
 *    items added within the same ~100 seconds collide);
 *  - any other id gets a deterministic hash of the whole string;
 *  - a collision (including two stored items that already share an id) moves the later item to the next free number.
 *
 * Numbers are assigned in draft order: exact `item_<digits>` ids first, so a hash can never take one of them.
 */
export function assignDraftItemNumericIds(rooms: Array<{ items?: Array<{ id: string }> }>): number[][] {
  const used = new Set<number>();
  const result: number[][] = rooms.map((room) => (room.items || []).map(() => 0));

  const claim = (wanted: number): number => {
    let candidate = wanted;
    while (used.has(candidate)) candidate += 1;
    used.add(candidate);
    return candidate;
  };
  const hash = (text: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h % 2_000_000_000) + 1;
  };

  rooms.forEach((room, roomIndex) => {
    (room.items || []).forEach((item, itemIndex) => {
      const exact = /^item_(\d{1,15})$/.exec(String(item.id));
      if (exact && Number(exact[1]) > 0) result[roomIndex][itemIndex] = claim(Number(exact[1]));
    });
  });
  rooms.forEach((room, roomIndex) => {
    (room.items || []).forEach((item, itemIndex) => {
      if (result[roomIndex][itemIndex] === 0) result[roomIndex][itemIndex] = claim(hash(String(item.id)));
    });
  });
  return result;
}

/**
 * Convert an OfflineQuotationDraft to a standard Quotation object so existing
 * proposal builder components render with 100% UI fidelity.
 */
export function offlineDraftToQuotation(
  draft: OfflineQuotationDraft,
  catalogProducts: EditorCatalogProduct[] = [],
  roomTypes: any[] = []
): any {
  const productMap = new Map<number, EditorCatalogProduct>();
  for (const p of catalogProducts) productMap.set(p.id, p);

  const roomTypeMap = new Map<number, any>();
  for (const rt of roomTypes) roomTypeMap.set(rt.id, rt);

  const itemNumericIds = assignDraftItemNumericIds(draft.rooms || []);

  const rooms = (draft.rooms || []).map((r, rIdx) => {
    const roomId = Number(r.id.replace(/\D/g, "").slice(0, 8)) || rIdx + 1;
    const roomType = roomTypeMap.get(r.roomTypeId);

    const items = (r.items || []).map((item, iIdx) => {
      const itemId = itemNumericIds[rIdx][iIdx];
      const product = productMap.get(item.productId);
      const variant = product?.variants?.find((v) => v.id === item.variantId);

      return {
        id: itemId,
        _id: itemId,
        quotationRoomId: roomId,
        productId: item.productId,
        productVariantId: item.variantId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxPercent: item.taxPercent || 18,
        product: product as any,
        productVariant: variant as any,
        variantLabel: item.variantName || item.automationTier || "Standard",
        isCustomPrice: item.isCustomPrice,
        notes: item.notes,
        sortOrder: item.sortOrder || 0,
      };
    });

    return {
      id: roomId,
      _id: roomId,
      quotationId: draft.id as any,
      roomTypeId: r.roomTypeId,
      customName: r.name,
      floor: r.floor,
      sortOrder: r.sortOrder || 0,
      roomType: roomType as any,
      items: items as any,
    };
  });

  return {
    id: draft.id as any,
    _id: draft.id as any,
    quotationNumber: draft.id, // Offline draft temporary ID: draft_<uuid>
    companyId: draft.companyId,
    clientName: draft.clientName,
    clientPhone: draft.clientPhone,
    clientEmail: draft.clientEmail,
    clientAddress: draft.clientAddress,
    clientGstNumber: draft.clientGstNumber,
    houseTypeId: draft.houseTypeId,
    notes: draft.notes,
    status: "draft",
    subtotal: draft.calculation?.grossSubtotal || 0,
    totalAmount: draft.calculation?.grandTotal || 0,
    discountType: draft.calculation?.discountType || "percentage",
    discountValue: draft.calculation?.discountValue || 0,
    customerDiscountPercent: draft.calculation?.customerDiscountPercent || 0,
    cgstAmount: draft.calculation?.cgstAmount || 0,
    sgstAmount: draft.calculation?.sgstAmount || 0,
    totalGstAmount: draft.calculation?.totalGstAmount || 0,
    rooms: rooms as any,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

/**
 * Convert updated Quotation state back to OfflineQuotationDraft for IndexedDB persistence
 */
export function quotationToOfflineDraft(
  quotation: any,
  baseDraft: OfflineQuotationDraft
): OfflineQuotationDraft {
  const rooms: OfflineQuotationDraftRoom[] = (quotation.rooms || []).map((r: any, rIdx: number) => {
    const roomId = typeof r.id === "string" && r.id.startsWith("room_") ? r.id : `room_${r.id ?? rIdx + 1}`;
    const items: OfflineQuotationDraftItem[] = (r.items || []).map((item: any, iIdx: number) => {
      const itemId = typeof item.id === "string" && item.id.startsWith("item_") ? item.id : `item_${item.id ?? iIdx + 1}`;
      const unitPrice = typeof item.unitPrice === "string" ? item.unitPrice : Number(item.unitPrice || 0).toFixed(2);
      const defaultPrice = (item.productVariant as any)?.price ? String((item.productVariant as any).price) : unitPrice;
      const qty = Math.max(1, Number(item.quantity || 1));
      const lineTotal = (Number(unitPrice) * qty).toFixed(2);

      return {
        id: itemId,
        draftId: baseDraft.id,
        roomId,
        productId: Number(item.productId),
        variantId: Number(item.productVariantId ?? item.variantId),
        productName: item.product?.name || item.productName || "Product",
        variantName: item.variantLabel || (item.productVariant as any)?.name || "Default",
        code: item.product?.code || (item.productVariant as any)?.code,
        variantCode: (item.productVariant as any)?.variantCode,
        automationTier: (item.productVariant as any)?.automationTier || item.product?.automationTier,
        surfaceFinish: (item.productVariant as any)?.surfaceFinish || item.product?.surfaceFinish,
        quantity: qty,
        defaultUnitPrice: defaultPrice,
        unitPrice,
        isCustomPrice: Boolean(item.isCustomPrice || unitPrice !== defaultPrice),
        taxPercent: Number(item.taxPercent || 18),
        lineTotal,
        notes: item.notes,
        sortOrder: item.sortOrder || 0,
      };
    });

    return {
      id: roomId,
      draftId: baseDraft.id,
      roomTypeId: Number(r.roomTypeId),
      name: r.customName || r.roomType?.name || `Room ${rIdx + 1}`,
      floor: r.floor,
      sortOrder: r.sortOrder || 0,
      items,
    };
  });

  const calculation = calculateDraftTotals({
    rooms,
    discountType: quotation.discountType,
    discountValue: Number(quotation.discountValue || 0),
    dealerDiscountAllocationPercent: baseDraft.calculation?.dealerDiscountAllocationPercent || 0,
  });

  return {
    ...baseDraft,
    clientName: quotation.clientName || baseDraft.clientName,
    clientPhone: quotation.clientPhone || baseDraft.clientPhone,
    clientEmail: quotation.clientEmail || baseDraft.clientEmail,
    clientAddress: quotation.clientAddress || baseDraft.clientAddress,
    clientGstNumber: quotation.clientGstNumber || baseDraft.clientGstNumber,
    houseTypeId: quotation.houseTypeId || baseDraft.houseTypeId,
    notes: quotation.notes || baseDraft.notes,
    rooms,
    calculation,
    roomCount: rooms.length,
    deviceCount: rooms.reduce((acc, r) => acc + r.items.reduce((sum, i) => sum + (i.quantity || 1), 0), 0),
    updatedAt: new Date().toISOString(),
  };
}

