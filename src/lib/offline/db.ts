/**
 * Whyte Automations — Tenant-Partitioned IndexedDB Storage Layer
 * Database: whyte_offline_store_v1
 *
 * Implements strict tenant isolation using compound keys [tenantKey, id],
 * where tenantKey = `${companyId}_${userId}`.
 */

import type { EditorCatalogProduct, Category, HouseType, RoomType } from "@/types";

export const DB_NAME = "whyte_offline_store_v1";
export const DB_VERSION = 2;

export type OfflineDownloadStatus =
  | "Not Downloaded"
  | "Downloading"
  | "Ready for Offline Use"
  | "Update Available"
  | "Download Failed";

export type OfflineDraftStatus =
  | "LOCAL_DRAFT"
  | "LOCAL_SAVED"
  | "SYNC_PENDING"
  | "SYNCED"
  | "SYNC_FAILED"
  | "CONFLICT";

export interface OfflineQuotationDraftItem {
  id: string; // "item_" + uuid
  draftId: string;
  roomId: string;
  productId: number;
  variantId: number;
  productName: string;
  variantName?: string;
  code?: string;
  variantCode?: string;
  automationTier?: string | null;
  surfaceFinish?: string | null;
  quantity: number;
  defaultUnitPrice: string;
  unitPrice: string; // custom quotation price
  isCustomPrice: boolean;
  taxPercent: number;
  lineTotal: string;
  notes?: string;
  sortOrder: number;
}

export interface OfflineQuotationDraftRoom {
  id: string; // "room_" + uuid
  draftId: string;
  roomTypeId: number;
  name: string;
  floor?: string;
  sortOrder: number;
  items: OfflineQuotationDraftItem[];
}

export interface OfflineCalculationSnapshot {
  grossSubtotal: number;
  discountType: "percentage" | "fixed";
  discountValue: number;
  discountAmount: number;
  netSubtotal: number;
  cgstPercent: number;
  cgstAmount: number;
  sgstPercent: number;
  sgstAmount: number;
  totalGstAmount: number;
  grandTotal: number;
  dealerDiscountAllocationPercent: number;
  customerDiscountPercent: number;
  estimatedDealerEarning: number;
}

export interface OfflineQuotationDraft {
  id: string; // "draft_" + uuid
  tenantKey: string;
  companyId: number;
  companyName: string;
  userId: number;
  userName: string;
  userRole: string;
  title?: string;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  clientAddress?: string;
  clientGstNumber?: string;
  houseTypeId: number;
  houseTypeName?: string;
  projectName?: string;
  notes?: string;
  catalogVersion: string;
  revision: number;
  status: OfflineDraftStatus;
  createdAt: string;
  updatedAt: string;
  rooms: OfflineQuotationDraftRoom[];
  calculation: OfflineCalculationSnapshot;
  roomCount: number;
  deviceCount: number;
}

export interface CatalogMetadata {
  tenantKey: string;
  companyId: number;
  companyName: string;
  userId: number;
  role: string;
  allocatedDiscountPercent: number;
  catalogVersion: string;
  lastSyncedAt: string | null;
  status: OfflineDownloadStatus;
  counts: {
    products: number;
    variants: number;
    categories: number;
    houseTypes: number;
    roomTypes: number;
    cachedImages: number;
  };
  totalStorageBytes?: number;
  lastError?: string | null;
}

export interface CachedImageRecord {
  tenantKey: string;
  url: string;
  blob?: Blob;
  contentType: string;
  downloadedAt: string;
  sizeBytes: number;
}

export function buildTenantKey(companyId: number | string, userId: number | string): string {
  return `${companyId}_${userId}`;
}

let dbInstance: IDBDatabase | null = null;

export async function getDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" && typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is only accessible in browser runtime.");
  }

  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Metadata store: keyed by tenantKey
      if (!db.objectStoreNames.contains("catalog_meta")) {
        db.createObjectStore("catalog_meta", { keyPath: "tenantKey" });
      }

      // 2. Products store: compound key [tenantKey, id]
      if (!db.objectStoreNames.contains("products")) {
        const prodStore = db.createObjectStore("products", { keyPath: ["tenantKey", "id"] });
        prodStore.createIndex("tenantKey", "tenantKey", { unique: false });
        prodStore.createIndex("tenant_categoryId", ["tenantKey", "categoryId"], { unique: false });
        prodStore.createIndex("tenant_type", ["tenantKey", "type"], { unique: false });
      }

      // 3. Categories store: compound key [tenantKey, id]
      if (!db.objectStoreNames.contains("categories")) {
        const catStore = db.createObjectStore("categories", { keyPath: ["tenantKey", "id"] });
        catStore.createIndex("tenantKey", "tenantKey", { unique: false });
      }

      // 4. House types store: compound key [tenantKey, id]
      if (!db.objectStoreNames.contains("house_types")) {
        const htStore = db.createObjectStore("house_types", { keyPath: ["tenantKey", "id"] });
        htStore.createIndex("tenantKey", "tenantKey", { unique: false });
      }

      // 5. Room types store: compound key [tenantKey, id]
      if (!db.objectStoreNames.contains("room_types")) {
        const rtStore = db.createObjectStore("room_types", { keyPath: ["tenantKey", "id"] });
        rtStore.createIndex("tenantKey", "tenantKey", { unique: false });
      }

      // 6. Product images store: compound key [tenantKey, url]
      if (!db.objectStoreNames.contains("product_images")) {
        const imgStore = db.createObjectStore("product_images", { keyPath: ["tenantKey", "url"] });
        imgStore.createIndex("tenantKey", "tenantKey", { unique: false });
      }

      // 7. Offline Quotation Drafts: compound key [tenantKey, id]
      if (!db.objectStoreNames.contains("offline_drafts")) {
        const draftStore = db.createObjectStore("offline_drafts", { keyPath: ["tenantKey", "id"] });
        draftStore.createIndex("tenantKey", "tenantKey", { unique: false });
        draftStore.createIndex("tenant_status", ["tenantKey", "status"], { unique: false });
        draftStore.createIndex("tenant_updatedAt", ["tenantKey", "updatedAt"], { unique: false });
      }

      // 8. Offline Quotation Draft Rooms: compound key [tenantKey, id]
      if (!db.objectStoreNames.contains("offline_draft_rooms")) {
        const roomStore = db.createObjectStore("offline_draft_rooms", { keyPath: ["tenantKey", "id"] });
        roomStore.createIndex("tenantKey", "tenantKey", { unique: false });
        roomStore.createIndex("tenant_draftId", ["tenantKey", "draftId"], { unique: false });
      }

      // 9. Offline Quotation Draft Items: compound key [tenantKey, id]
      if (!db.objectStoreNames.contains("offline_draft_items")) {
        const itemStore = db.createObjectStore("offline_draft_items", { keyPath: ["tenantKey", "id"] });
        itemStore.createIndex("tenantKey", "tenantKey", { unique: false });
        itemStore.createIndex("tenant_draftId", ["tenantKey", "draftId"], { unique: false });
        itemStore.createIndex("tenant_roomId", ["tenantKey", "roomId"], { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error || new Error("Failed to open IndexedDB"));
    };
  });
}

/**
 * Get Catalog Metadata for an authenticated tenant
 */
export async function getCatalogMeta(tenantKey: string): Promise<CatalogMetadata | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("catalog_meta", "readonly");
    const store = tx.objectStore("catalog_meta");
    const req = store.get(tenantKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update Catalog Metadata
 */
export async function saveCatalogMeta(meta: CatalogMetadata): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("catalog_meta", "readwrite");
    const store = tx.objectStore("catalog_meta");
    const req = store.put(meta);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Atomically commit a complete offline catalog package for a tenant.
 * Uses a single readwrite transaction across all catalog stores to guarantee
 * that if any write fails, the entire transaction rolls back and preserves the
 * previous valid catalog.
 */
export async function commitOfflineCatalogPackage(
  tenantKey: string,
  meta: CatalogMetadata,
  products: EditorCatalogProduct[],
  categories: Category[],
  houseTypes: HouseType[],
  roomTypes: RoomType[]
): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["catalog_meta", "products", "categories", "house_types", "room_types"],
      "readwrite"
    );

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));

    // 1. Clear existing records for this tenantKey across stores
    const prodStore = tx.objectStore("products");
    const catStore = tx.objectStore("categories");
    const htStore = tx.objectStore("house_types");
    const rtStore = tx.objectStore("room_types");

    const clearByTenant = (store: IDBObjectStore) => {
      const index = store.index("tenantKey");
      const keyRange = IDBKeyRange.only(tenantKey);
      const req = index.openCursor(keyRange);
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    };

    clearByTenant(prodStore);
    clearByTenant(catStore);
    clearByTenant(htStore);
    clearByTenant(rtStore);

    // 2. Put fresh staged records
    for (const p of products) {
      prodStore.put({ ...p, tenantKey });
    }
    for (const c of categories) {
      catStore.put({ ...c, tenantKey });
    }
    for (const h of houseTypes) {
      htStore.put({ ...h, tenantKey });
    }
    for (const r of roomTypes) {
      rtStore.put({ ...r, tenantKey });
    }

    // 3. Put updated metadata
    const metaStore = tx.objectStore("catalog_meta");
    metaStore.put({ ...meta, tenantKey });
  });
}

/**
 * Read all catalog records for a tenant
 */
export async function getTenantProducts(tenantKey: string): Promise<EditorCatalogProduct[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("products", "readonly");
    const store = tx.objectStore("products");
    const index = store.index("tenantKey");
    const req = index.getAll(IDBKeyRange.only(tenantKey));
    req.onsuccess = () => resolve((req.result || []) as EditorCatalogProduct[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getTenantCategories(tenantKey: string): Promise<Category[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("categories", "readonly");
    const store = tx.objectStore("categories");
    const index = store.index("tenantKey");
    const req = index.getAll(IDBKeyRange.only(tenantKey));
    req.onsuccess = () => resolve((req.result || []) as Category[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getTenantHouseTypes(tenantKey: string): Promise<HouseType[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("house_types", "readonly");
    const store = tx.objectStore("house_types");
    const index = store.index("tenantKey");
    const req = index.getAll(IDBKeyRange.only(tenantKey));
    req.onsuccess = () => resolve((req.result || []) as HouseType[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getTenantRoomTypes(tenantKey: string): Promise<RoomType[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("room_types", "readonly");
    const store = tx.objectStore("room_types");
    const index = store.index("tenantKey");
    const req = index.getAll(IDBKeyRange.only(tenantKey));
    req.onsuccess = () => resolve((req.result || []) as RoomType[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Image Caching in IndexedDB (Tenant Partitioned)
 */
export async function saveTenantImage(
  tenantKey: string,
  url: string,
  blob: Blob,
  contentType: string
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("product_images", "readwrite");
    const store = tx.objectStore("product_images");
    const record: CachedImageRecord = {
      tenantKey,
      url,
      blob,
      contentType,
      downloadedAt: new Date().toISOString(),
      sizeBytes: blob.size,
    };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getTenantImageBlob(tenantKey: string, url: string): Promise<Blob | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("product_images", "readonly");
    const store = tx.objectStore("product_images");
    const req = store.get([tenantKey, url]);
    req.onsuccess = () => {
      const rec = req.result as CachedImageRecord | undefined;
      resolve(rec?.blob || null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function countTenantCachedImages(tenantKey: string): Promise<number> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("product_images", "readonly");
    const store = tx.objectStore("product_images");
    const index = store.index("tenantKey");
    const req = index.count(IDBKeyRange.only(tenantKey));
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clear all data for a specific tenant (used on logout, tenant switch, or user action)
 */
export async function clearTenantCatalog(tenantKey: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["catalog_meta", "products", "categories", "house_types", "room_types", "product_images"],
      "readwrite"
    );

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    // Remove metadata
    tx.objectStore("catalog_meta").delete(tenantKey);

    const clearStore = (storeName: string) => {
      const store = tx.objectStore(storeName);
      const index = store.index("tenantKey");
      const req = index.openCursor(IDBKeyRange.only(tenantKey));
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    };

    clearStore("products");
    clearStore("categories");
    clearStore("house_types");
    clearStore("room_types");
    clearStore("product_images");
  });
}

/**
 * Measure approximate storage usage for a tenant
 */
export async function getTenantStorageUsage(
  tenantKey: string
): Promise<{ totalBytes: number; imageBytes: number; recordCount: number }> {
  const db = await getDb();
  let totalBytes = 0;
  let imageBytes = 0;
  let recordCount = 0;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["products", "categories", "house_types", "room_types", "product_images"],
      "readonly"
    );

    tx.oncomplete = () => resolve({ totalBytes, imageBytes, recordCount });
    tx.onerror = () => reject(tx.error);

    // Sum product image bytes
    const imgStore = tx.objectStore("product_images");
    const imgReq = imgStore.index("tenantKey").openCursor(IDBKeyRange.only(tenantKey));
    imgReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const val = cursor.value as CachedImageRecord;
        const size = val.sizeBytes || val.blob?.size || 0;
        imageBytes += size;
        totalBytes += size;
        recordCount++;
        cursor.continue();
      }
    };

    // Count other items
    const countStore = (storeName: string, approxBytesPerItem: number) => {
      const store = tx.objectStore(storeName);
      const req = store.index("tenantKey").openCursor(IDBKeyRange.only(tenantKey));
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          totalBytes += approxBytesPerItem;
          recordCount++;
          cursor.continue();
        }
      };
    };

    countStore("products", 1024);
    countStore("categories", 256);
    countStore("house_types", 512);
    countStore("room_types", 256);
  });
}

/**
 * Save or update an offline quotation draft atomically across all draft stores.
 * Enforces revision checks to prevent concurrent autosaves from overwriting newer drafts.
 */
export async function saveDraftToStores(draft: OfflineQuotationDraft): Promise<number> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["offline_drafts", "offline_draft_rooms", "offline_draft_items"],
      "readwrite"
    );

    const draftStore = tx.objectStore("offline_drafts");
    const roomStore = tx.objectStore("offline_draft_rooms");
    const itemStore = tx.objectStore("offline_draft_items");

    const existingReq = draftStore.get([draft.tenantKey, draft.id]);
    existingReq.onsuccess = () => {
      const existing = existingReq.result as OfflineQuotationDraft | undefined;
      if (existing && existing.revision > draft.revision) {
        reject(new Error(`Conflict: draft revision ${existing.revision} is newer than current ${draft.revision}`));
        return;
      }

      const nextRevision = (draft.revision || 0) + 1;
      const updatedDraft: OfflineQuotationDraft = {
        ...draft,
        revision: nextRevision,
        updatedAt: new Date().toISOString(),
        roomCount: draft.rooms?.length || 0,
        deviceCount: (draft.rooms || []).reduce(
          (acc, r) => acc + (r.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0),
          0
        ),
      };

      draftStore.put(updatedDraft);

      // Clean up previous rooms and items for this draft
      const roomIndex = roomStore.index("tenant_draftId");
      const roomCursorReq = roomIndex.openCursor(IDBKeyRange.only([draft.tenantKey, draft.id]));
      roomCursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      const itemIndex = itemStore.index("tenant_draftId");
      const itemCursorReq = itemIndex.openCursor(IDBKeyRange.only([draft.tenantKey, draft.id]));
      itemCursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      // Insert current rooms and items
      for (const room of updatedDraft.rooms || []) {
        roomStore.put({
          tenantKey: draft.tenantKey,
          id: room.id,
          draftId: draft.id,
          roomTypeId: room.roomTypeId,
          name: room.name,
          floor: room.floor,
          sortOrder: room.sortOrder,
        });

        for (const item of room.items || []) {
          itemStore.put({
            tenantKey: draft.tenantKey,
            id: item.id,
            draftId: draft.id,
            roomId: room.id,
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productName,
            variantName: item.variantName,
            code: item.code,
            variantCode: item.variantCode,
            automationTier: item.automationTier,
            surfaceFinish: item.surfaceFinish,
            quantity: item.quantity,
            defaultUnitPrice: item.defaultUnitPrice,
            unitPrice: item.unitPrice,
            isCustomPrice: item.isCustomPrice,
            taxPercent: item.taxPercent,
            lineTotal: item.lineTotal,
            notes: item.notes,
            sortOrder: item.sortOrder,
          });
        }
      }

      tx.oncomplete = () => resolve(nextRevision);
      tx.onerror = () => reject(tx.error);
    };

    existingReq.onerror = () => reject(existingReq.error);
  });
}

/**
 * Get an offline draft by ID for an authorized tenant
 */
export async function getDraftFromStores(
  tenantKey: string,
  draftId: string
): Promise<OfflineQuotationDraft | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("offline_drafts", "readonly");
    const store = tx.objectStore("offline_drafts");
    const req = store.get([tenantKey, draftId]);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * List all offline drafts for an authorized tenant (sorted newest first)
 */
export async function listDraftsFromStores(tenantKey: string): Promise<OfflineQuotationDraft[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("offline_drafts", "readonly");
    const store = tx.objectStore("offline_drafts");
    const index = store.index("tenantKey");
    const req = index.getAll(IDBKeyRange.only(tenantKey));
    req.onsuccess = () => {
      const list = (req.result || []) as OfflineQuotationDraft[];
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete an offline draft and all its associated rooms and items
 */
export async function deleteDraftFromStores(tenantKey: string, draftId: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["offline_drafts", "offline_draft_rooms", "offline_draft_items"],
      "readwrite"
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    tx.objectStore("offline_drafts").delete([tenantKey, draftId]);

    const roomIndex = tx.objectStore("offline_draft_rooms").index("tenant_draftId");
    const roomReq = roomIndex.openCursor(IDBKeyRange.only([tenantKey, draftId]));
    roomReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    const itemIndex = tx.objectStore("offline_draft_items").index("tenant_draftId");
    const itemReq = itemIndex.openCursor(IDBKeyRange.only([tenantKey, draftId]));
    itemReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  });
}

