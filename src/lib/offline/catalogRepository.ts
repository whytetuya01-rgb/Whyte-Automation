/**
 * Whyte Automations — Offline Catalog Repository
 * Reusable repository interface for reading cached catalog data from IndexedDB.
 * Prepared for clean, non-intrusive integration into ProposalBuilder in Phase 4.
 */

import {
  getCatalogMeta,
  getTenantProducts,
  getTenantCategories,
  getTenantHouseTypes,
  getTenantRoomTypes,
  getTenantImageBlob,
  buildTenantKey,
  type CatalogMetadata,
} from "./db";
import type { EditorCatalogProduct, Category, HouseType, RoomType } from "@/types";

export interface OfflineCatalogSnapshot {
  isAvailable: boolean;
  meta: CatalogMetadata | null;
  products: EditorCatalogProduct[];
  categories: Category[];
  houseTypes: HouseType[];
  roomTypes: RoomType[];
}

export class OfflineCatalogRepository {
  /**
   * Check if an authorized offline catalog is downloaded and ready for this tenant
   */
  static async isCatalogReady(companyId: number | string, userId: number | string): Promise<boolean> {
    const tenantKey = buildTenantKey(companyId, userId);
    const meta = await getCatalogMeta(tenantKey);
    return Boolean(meta && (meta.status === "Ready for Offline Use" || meta.status === "Update Available"));
  }

  /**
   * Retrieve complete offline catalog for authorized tenant
   */
  static async getCatalogSnapshot(
    companyId: number | string,
    userId: number | string
  ): Promise<OfflineCatalogSnapshot> {
    const tenantKey = buildTenantKey(companyId, userId);
    const meta = await getCatalogMeta(tenantKey);

    if (!meta || !meta.lastSyncedAt) {
      return {
        isAvailable: false,
        meta: null,
        products: [],
        categories: [],
        houseTypes: [],
        roomTypes: [],
      };
    }

    const [products, categories, houseTypes, roomTypes] = await Promise.all([
      getTenantProducts(tenantKey),
      getTenantCategories(tenantKey),
      getTenantHouseTypes(tenantKey),
      getTenantRoomTypes(tenantKey),
    ]);

    return {
      isAvailable: true,
      meta,
      products,
      categories,
      houseTypes,
      roomTypes,
    };
  }

  /**
   * Find product by ID from offline store
   */
  static async getProductById(
    companyId: number | string,
    userId: number | string,
    productId: number
  ): Promise<EditorCatalogProduct | null> {
    const tenantKey = buildTenantKey(companyId, userId);
    const products = await getTenantProducts(tenantKey);
    return products.find((p) => p.id === productId) || null;
  }

  /**
   * Find house type by ID from offline store
   */
  static async getHouseTypeById(
    companyId: number | string,
    userId: number | string,
    houseTypeId: number
  ): Promise<HouseType | null> {
    const tenantKey = buildTenantKey(companyId, userId);
    const houseTypes = await getTenantHouseTypes(tenantKey);
    return houseTypes.find((ht) => ht.id === houseTypeId) || null;
  }

  /**
   * Retrieve cached image object URL if present in local IndexedDB
   */
  static async getImageSrc(
    companyId: number | string,
    userId: number | string,
    remoteUrl: string
  ): Promise<string> {
    if (!remoteUrl) return "";
    const tenantKey = buildTenantKey(companyId, userId);
    try {
      const blob = await getTenantImageBlob(tenantKey, remoteUrl);
      if (blob) {
        return URL.createObjectURL(blob);
      }
    } catch {
      // Fallback directly to original URL
    }
    return remoteUrl;
  }
}
