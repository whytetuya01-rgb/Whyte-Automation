import useSWR, { SWRConfiguration } from "swr";
import type {
  Category,
  Product,
  RoomType,
  HouseType,
  Quotation,
  Company,
} from "@/types";

/**
 * Global SWR fetcher — simple wrapper around fetch that throws on error.
 */
export const swrFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error("Failed to fetch");
    throw error;
  }
  return res.json();
};

/**
 * Default SWR options for admin pages.
 * - dedupingInterval: 10s — prevents duplicate requests to the same endpoint
 *   within 10 seconds (e.g., navigating between pages quickly).
 * - revalidateOnFocus: false — prevents refetch when user switches tabs/windows
 *   (admin panels rarely need this; explicit refresh buttons exist).
 * - keepPreviousData: true — avoids flash of empty state when revalidating.
 */
export const SWR_ADMIN_OPTIONS: SWRConfiguration = {
  dedupingInterval: 10_000,
  revalidateOnFocus: false,
  keepPreviousData: true,
  fetcher: swrFetcher,
};

// ─── Reusable SWR hooks for common endpoints ────────────────────────────────

/**
 * Hook: categories (hierarchical tree)
 * Used by: Products page, Categories page, Estimator
 */
export function useCategories(options?: SWRConfiguration) {
  return useSWR<Category[]>("/api/categories", swrFetcher, {
    ...SWR_ADMIN_OPTIONS,
    ...options,
  });
}

/**
 * Hook: all products (admin, includes inactive)
 * Used by: Products page
 */
export function useAdminProducts(options?: SWRConfiguration) {
  return useSWR<Product[]>("/api/products?all=true", swrFetcher, {
    ...SWR_ADMIN_OPTIONS,
    ...options,
  });
}

/**
 * Hook: active products only (estimator/public)
 * Used by: Estimator
 */
export function useProducts(options?: SWRConfiguration) {
  return useSWR<Product[]>("/api/products", swrFetcher, {
    ...SWR_ADMIN_OPTIONS,
    ...options,
  });
}

/**
 * Hook: room types
 * Used by: Room Types page, House Types page, Estimator
 */
export function useRoomTypes(options?: SWRConfiguration) {
  return useSWR<RoomType[]>("/api/room-types", swrFetcher, {
    ...SWR_ADMIN_OPTIONS,
    ...options,
  });
}

/**
 * Hook: house types (with room templates)
 * Used by: House Types page
 */
export function useHouseTypes(options?: SWRConfiguration) {
  return useSWR<HouseType[]>("/api/house-types", swrFetcher, {
    ...SWR_ADMIN_OPTIONS,
    ...options,
  });
}

/**
 * Hook: quotations list
 * Used by: Quotations admin page
 */
export function useQuotations(options?: SWRConfiguration) {
  return useSWR<Quotation[]>("/api/quotations", swrFetcher, {
    ...SWR_ADMIN_OPTIONS,
    ...options,
  });
}

/**
 * Hook: single quotation by ID
 * Used by: Estimator
 */
export function useQuotation(id: string | undefined, options?: SWRConfiguration) {
  return useSWR<Quotation>(id ? `/api/quotations/${id}` : null, swrFetcher, {
    ...SWR_ADMIN_OPTIONS,
    revalidateOnFocus: false,
    ...options,
  });
}

/**
 * Hook: company settings
 * Used by: Company page, PDF preview
 */
export function useCompany(options?: SWRConfiguration) {
  return useSWR<Company>("/api/company", swrFetcher, {
    ...SWR_ADMIN_OPTIONS,
    ...options,
  });
}
