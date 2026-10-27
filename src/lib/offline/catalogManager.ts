/**
 * Whyte Automations — Offline Catalog Manager
 * Orchestrates downloading, validation, atomic committing, image caching,
 * and version checking for the offline product catalog.
 */

import {
  buildTenantKey,
  commitOfflineCatalogPackage,
  getCatalogMeta,
  saveCatalogMeta,
  getTenantProducts,
  getTenantCategories,
  getTenantHouseTypes,
  getTenantRoomTypes,
  saveTenantImage,
  getTenantImageBlob,
  countTenantCachedImages,
  clearTenantCatalog,
  getTenantStorageUsage,
  type CatalogMetadata,
  type OfflineDownloadStatus,
} from "./db";
import type { EditorCatalogProduct, Category, HouseType, RoomType } from "@/types";

export interface CatalogDownloadProgress {
  stage: "idle" | "fetching_data" | "storing_catalog" | "caching_images" | "complete" | "failed";
  percent: number;
  message: string;
  itemsProcessed?: number;
  itemsTotal?: number;
}

export interface TenantContext {
  companyId: number;
  companyName: string;
  userId: number;
  role: string;
  allocatedDiscountPercent: number;
}

/**
 * Downloads and commits the complete offline catalog package atomically.
 */
export async function downloadOfflineCatalog(
  tenant: TenantContext,
  options: {
    downloadImages?: boolean;
    maxImages?: number;
    onProgress?: (p: CatalogDownloadProgress) => void;
  } = {}
): Promise<CatalogMetadata> {
  const { downloadImages = true, maxImages = 60, onProgress = () => {} } = options;
  const tenantKey = buildTenantKey(tenant.companyId, tenant.userId);

  // 1. Initial State
  onProgress({
    stage: "fetching_data",
    percent: 10,
    message: "Connecting to server for catalog package...",
  });

  const existingMeta = await getCatalogMeta(tenantKey);

  // Mark status as downloading
  await saveCatalogMeta({
    tenantKey,
    companyId: tenant.companyId,
    companyName: tenant.companyName,
    userId: tenant.userId,
    role: tenant.role,
    allocatedDiscountPercent: tenant.allocatedDiscountPercent,
    catalogVersion: existingMeta?.catalogVersion || "v0",
    lastSyncedAt: existingMeta?.lastSyncedAt || null,
    status: "Downloading",
    counts: existingMeta?.counts || {
      products: 0,
      variants: 0,
      categories: 0,
      houseTypes: 0,
      roomTypes: 0,
      cachedImages: 0,
    },
  });

  try {
    // 2. Fetch from Secure Endpoint
    const res = await fetch("/api/catalog/offline-package", {
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || `Server returned HTTP ${res.status}`;
      throw new Error(msg);
    }

    const data = await res.json();

    if (!data.success || !Array.isArray(data.products)) {
      throw new Error("Invalid catalog package received from server");
    }

    // Security validation: verify tenant match
    if (Number(data.tenant?.companyId) !== Number(tenant.companyId)) {
      throw new Error("Tenant mismatch in catalog package. Download aborted for safety.");
    }

    onProgress({
      stage: "storing_catalog",
      percent: 45,
      message: `Storing ${data.products.length} products and spaces locally...`,
    });

    const products: EditorCatalogProduct[] = data.products;
    const categories: Category[] = data.categories || [];
    const houseTypes: HouseType[] = data.houseTypes || [];
    const roomTypes: RoomType[] = data.roomTypes || [];

    // 3. Atomically Commit Data to IndexedDB
    const newMeta: CatalogMetadata = {
      tenantKey,
      companyId: tenant.companyId,
      companyName: data.tenant.companyName,
      userId: tenant.userId,
      role: tenant.role,
      allocatedDiscountPercent: data.tenant.allocatedDiscountPercent,
      catalogVersion: data.catalogVersion,
      lastSyncedAt: new Date().toISOString(),
      status: "Ready for Offline Use",
      counts: {
        products: products.length,
        variants: data.counts?.variants || 0,
        categories: categories.length,
        houseTypes: houseTypes.length,
        roomTypes: roomTypes.length,
        cachedImages: existingMeta?.counts?.cachedImages || 0,
      },
    };

    await commitOfflineCatalogPackage(
      tenantKey,
      newMeta,
      products,
      categories,
      houseTypes,
      roomTypes
    );

    // 4. Optional Image Caching
    let cachedImagesCount = existingMeta?.counts?.cachedImages || 0;
    if (downloadImages) {
      onProgress({
        stage: "caching_images",
        percent: 65,
        message: "Caching product images for offline display...",
      });

      const imageUrlsToCache = Array.from(
        new Set(
          products
            .map((p) => p.imageUrl)
            .filter((url): url is string => Boolean(url && url.startsWith("http")))
        )
      ).slice(0, maxImages);

      let processed = 0;
      for (const imgUrl of imageUrlsToCache) {
        try {
          // Check if already in IndexedDB
          const existingBlob = await getTenantImageBlob(tenantKey, imgUrl);
          if (!existingBlob) {
            const imgRes = await fetch(imgUrl, { mode: "cors" });
            if (imgRes.ok) {
              const blob = await imgRes.blob();
              const contentType = imgRes.headers.get("content-type") || "image/jpeg";
              await saveTenantImage(tenantKey, imgUrl, blob, contentType);
              cachedImagesCount++;
            }
          }
        } catch {
          // Individual image failure does not block catalog availability
        }
        processed++;
        const pct = Math.min(95, 65 + Math.round((processed / imageUrlsToCache.length) * 30));
        onProgress({
          stage: "caching_images",
          percent: pct,
          message: `Cached image ${processed} of ${imageUrlsToCache.length}...`,
          itemsProcessed: processed,
          itemsTotal: imageUrlsToCache.length,
        });
      }
    }

    // 5. Finalize Metadata
    const finalCounts = await countTenantCachedImages(tenantKey);
    const storageUsage = await getTenantStorageUsage(tenantKey);

    newMeta.counts.cachedImages = finalCounts;
    newMeta.totalStorageBytes = storageUsage.totalBytes;
    await saveCatalogMeta(newMeta);

    onProgress({
      stage: "complete",
      percent: 100,
      message: "Offline catalog is ready for use!",
    });

    return newMeta;
  } catch (error: any) {
    const errorMsg = error?.message || "Failed to download offline catalog";
    console.error("[OfflineCatalogManager] Download error:", error);

    // Revert/Update metadata with error status while preserving existing catalog data
    const failedMeta: CatalogMetadata = {
      tenantKey,
      companyId: tenant.companyId,
      companyName: tenant.companyName,
      userId: tenant.userId,
      role: tenant.role,
      allocatedDiscountPercent: tenant.allocatedDiscountPercent,
      catalogVersion: existingMeta?.catalogVersion || "v0",
      lastSyncedAt: existingMeta?.lastSyncedAt || null,
      status: existingMeta?.lastSyncedAt ? "Ready for Offline Use" : "Download Failed",
      counts: existingMeta?.counts || {
        products: 0,
        variants: 0,
        categories: 0,
        houseTypes: 0,
        roomTypes: 0,
        cachedImages: 0,
      },
      lastError: errorMsg,
    };
    await saveCatalogMeta(failedMeta);

    onProgress({
      stage: "failed",
      percent: 0,
      message: errorMsg,
    });

    throw error;
  }
}

/**
 * Reads offline catalog for a tenant
 */
export async function loadOfflineCatalogData(tenantKey: string): Promise<{
  meta: CatalogMetadata | null;
  products: EditorCatalogProduct[];
  categories: Category[];
  houseTypes: HouseType[];
  roomTypes: RoomType[];
}> {
  const [meta, products, categories, houseTypes, roomTypes] = await Promise.all([
    getCatalogMeta(tenantKey),
    getTenantProducts(tenantKey),
    getTenantCategories(tenantKey),
    getTenantHouseTypes(tenantKey),
    getTenantRoomTypes(tenantKey),
  ]);

  return { meta, products, categories, houseTypes, roomTypes };
}

/**
 * Creates an object URL for a cached offline image
 */
export async function getOfflineImageUrl(tenantKey: string, url: string): Promise<string | null> {
  const blob = await getTenantImageBlob(tenantKey, url);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

/**
 * Check if a new catalog version is available on the server without doing a full download
 */
export async function checkForCatalogUpdate(tenantKey: string): Promise<{
  updateAvailable: boolean;
  currentVersion: string | null;
  serverVersion?: string;
}> {
  const meta = await getCatalogMeta(tenantKey);
  if (!meta || !meta.lastSyncedAt) {
    return { updateAvailable: false, currentVersion: null };
  }

  try {
    const res = await fetch("/api/catalog/offline-package?checkVersionOnly=true", {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return { updateAvailable: false, currentVersion: meta.catalogVersion };

    const data = await res.json();
    const serverVersion = data.catalogVersion;
    const updateAvailable = serverVersion !== meta.catalogVersion;

    if (updateAvailable) {
      await saveCatalogMeta({
        ...meta,
        status: "Update Available",
      });
    }

    return {
      updateAvailable,
      currentVersion: meta.catalogVersion,
      serverVersion,
    };
  } catch {
    return { updateAvailable: false, currentVersion: meta.catalogVersion };
  }
}

export { clearTenantCatalog, getTenantStorageUsage };
