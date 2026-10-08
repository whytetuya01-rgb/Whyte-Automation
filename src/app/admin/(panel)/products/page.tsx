"use client";

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { Product, Category } from "@/types";
import notify from "@/lib/notify";
import { apiJson, notifyApiError, safeMessage } from "@/lib/apiClient";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import Modal from "@/components/shared/Modal";
import ProductForm from "@/components/admin/ProductForm";
import ProductVariantsEditModal from "@/components/admin/ProductVariantsEditModal";
import Pagination from "@/components/shared/Pagination";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Button } from "@/components/ui";
import ProductCatalogStats from "@/components/admin/products/ProductCatalogStats";
import ProductCatalogToolbar, {
  type CatalogFilterKey,
} from "@/components/admin/products/ProductCatalogToolbar";
import ProductCatalogList from "@/components/admin/products/ProductCatalogList";
import {
  PRODUCT_TYPE_FILTERS,
  type CatalogStatCard,
} from "@/components/admin/products/catalogPresentation";

function flattenCategories(cats: Category[], prefix = ""): { id: number; name: string }[] {
  let result: { id: number; name: string }[] = [];
  for (const c of cats) {
    const displayName = prefix ? `${prefix} › ${c.name}` : c.name;
    result.push({ id: c.id, name: displayName });
    if (c.children && c.children.length > 0) {
      result = result.concat(flattenCategories(c.children, displayName));
    }
  }
  return result;
}

interface StatsData {
  totalProducts: number;
  totalActive: number;
  totalVariants: number;
  totalCategories?: number;
}

function ProductsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirm = useConfirm();

  // URL state with safe numeric parsing
  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawPageSize = parseInt(searchParams.get("pageSize") || "10", 10);
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : 10;

  const search = searchParams.get("search") || "";
  const type = searchParams.get("type") || "all";
  const status = searchParams.get("status") || "all";
  const category = searchParams.get("category") || "all";
  const hasVariants = searchParams.get("hasVariants") || "all";
  const sort = searchParams.get("sort") || "sortOrder_asc";

  // Data states
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);

  // Search input local state
  const [searchInput, setSearchInput] = useState<string>(search);

  // TreeTable expand/collapse state: stores Product IDs that are expanded
  const [expandedProductIds, setExpandedProductIds] = useState<Set<number>>(new Set());

  // Modals state
  const [showProductModal, setShowProductModal] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingVariantsProduct, setEditingVariantsProduct] = useState<Product | null>(null);

  // Sync search input when URL changes
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Update URL helper
  const updateQuery = useCallback(
    (updates: Record<string, string | number | null | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "" || value === "all") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  // Fetch categories once
  useEffect(() => {
    async function loadCategories() {
      try {
        const res = await fetch("/api/categories");
        if (res.ok) {
          const data = await res.json();
          setCategories(Array.isArray(data) ? data : []);
        }
      } catch {
        // silent fallback
      }
    }
    loadCategories();
  }, []);

  // Fetch products
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("all", "true"); // admin shows all

      if (search) params.set("search", search);
      if (type !== "all") params.set("type", type);
      if (status !== "all") params.set("status", status);
      if (category !== "all") params.set("category", category);
      if (hasVariants !== "all") params.set("hasVariants", hasVariants);
      if (sort) params.set("sort", sort);

      const res = await fetch(`/api/products?${params.toString()}`);
      if (res.status === 401) {
        router.replace("/admin/login");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(safeMessage(data?.error?.message, "Failed to load products"));
      }

      if (data && Array.isArray(data.data) && data.pagination) {
        setProducts(data.data);
        const safeTotal = Number(data.pagination.total) || 0;
        const safeTotalPages = Number(data.pagination.totalPages) || Math.max(1, Math.ceil(safeTotal / pageSize));
        setTotal(safeTotal);
        setTotalPages(safeTotalPages);
        if (data.stats) {
          setStats(data.stats);
        }
      } else if (data && Array.isArray(data.items)) {
        setProducts(data.items);
        const safeTotal = Number(data.total) || 0;
        const safeTotalPages = Number(data.totalPages) || Math.max(1, Math.ceil(safeTotal / pageSize));
        setTotal(safeTotal);
        setTotalPages(safeTotalPages);
      } else if (Array.isArray(data)) {
        setProducts(data);
        setTotal(data.length);
        setTotalPages(1);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error fetching products";
      notify.error("Error", msg);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, type, status, category, hasVariants, sort, router]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Toggle tree expansion for a specific product
  const toggleExpand = (productId: number) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // Toggle active status for Product
  const handleToggleProductStatus = async (p: Product) => {
    try {
      await apiJson.patch(`/api/products/${p.id}`, { isActive: !p.isActive });

      setProducts((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, isActive: !item.isActive } : item))
      );
      notify.success(
        !p.isActive ? "Product activated" : "Product deactivated",
        `"${p.name}" status updated.`
      );
    } catch (err: unknown) {
      notifyApiError(err, "Status update failed", "Unable to toggle product status.");
    }
  };

  // Handle Delete Product — confirmation is raised through the global provider,
  // which keeps the dialog open (and its button disabled) until the API replies.
  const handleDeleteProduct = async (product: Product) => {
    const variantCount = product.variants?.length || 0;

    await confirm({
      title: "Delete Product",
      message: `Are you sure you want to delete "${product.name}"?`,
      detail: `This product currently has ${variantCount} associated ${
        variantCount === 1 ? "variant" : "variants"
      }. If it is used in any quotation, deletion will be blocked.`,
      confirmText: "Delete Product",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: async () => {
        try {
          await apiJson.delete(`/api/products/${product.id}`);
          notify.success("Product deleted", `Product "${product.name}" has been removed.`);
          fetchProducts();
        } catch (err: unknown) {
          notifyApiError(err, "Cannot delete", "Failed to delete this product.");
        }
      },
    });
  };

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

  // Safe Catalog Statistics (Guaranteed non-NaN numbers)
  const displayTotalProducts = Number.isFinite(Number(stats?.totalProducts))
    ? stats!.totalProducts
    : total;

  const displayTotalActive = Number.isFinite(Number(stats?.totalActive))
    ? stats!.totalActive
    : products.filter((p) => p.isActive).length;

  const displayTotalVariants = Number.isFinite(Number(stats?.totalVariants))
    ? stats!.totalVariants
    : products.reduce((acc, p) => acc + (p.variants?.length || 0), 0);

  const displayTotalCategories = Number.isFinite(Number(stats?.totalCategories))
    ? stats!.totalCategories!
    : categories.length;

  const hasActiveFilters = Boolean(
    search || type !== "all" || status !== "all" || category !== "all" || hasVariants !== "all"
  );

  // One definition drives the summary strip; the component owns the icon and
  // colour treatment so both stay consistent across metrics.
  const statCards: CatalogStatCard[] = [
    { id: "products", label: "Total Products", value: displayTotalProducts, tone: "neutral" },
    { id: "active", label: "Active Products", value: displayTotalActive, tone: "success" },
    { id: "variants", label: "Total Variants", value: displayTotalVariants, tone: "accent" },
    { id: "categories", label: "Categories", value: displayTotalCategories, tone: "info" },
  ];

  const handleFilterChange = useCallback(
    (key: CatalogFilterKey, value: string) => {
      updateQuery({ [key]: value, page: 1 });
    },
    [updateQuery]
  );

  const handleClearAllFilters = useCallback(() => {
    setSearchInput("");
    updateQuery({
      search: null,
      type: null,
      status: null,
      category: null,
      hasVariants: null,
      sort: null,
      page: 1,
    });
  }, [updateQuery]);

  const handleSearchInputChange = useCallback((val: string) => {
    setSearchInput(val);
    updateQuery({ search: val.trim() || null, page: 1 });
  }, [updateQuery]);

  const handleClearSearch = useCallback(() => {
    setSearchInput("");
    updateQuery({ search: null, page: 1 });
  }, [updateQuery]);

  const resultSummary = loading
    ? "Loading…"
    : `${total} ${total === 1 ? "product" : "products"}`;

  return (
    <div className="w-full space-y-5 pb-16">
      {/* ─── 1. PAGE HEADER ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-neutral-900 tracking-tight">Products</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700 border border-neutral-200/80 font-mono">
              {total} {total === 1 ? "Product" : "Products"}
            </span>
          </div>
          <p className="text-[13px] text-neutral-500 mt-1">
            Manage catalog products, variants, surface finishes, and pricing.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchProducts}
            disabled={loading}
            className="h-9 gap-1.5 text-xs font-semibold rounded-xl"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <button
            onClick={() => {
              setEditingProduct(null);
              setShowProductModal(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-xs shrink-0"
          >
            <Plus size={14} /> Add Product
          </button>
        </div>
      </div>

      {/* Catalog summary */}
      <ProductCatalogStats items={statCards} />


      {/* Search, filters and configuration tabs */}
      <ProductCatalogToolbar
        searchInput={searchInput}
        onSearchInputChange={handleSearchInputChange}
        onSearchSubmit={() => {}}
        onClearSearch={handleClearSearch}
        category={category}
        type={type}
        status={status}
        sort={sort}
        hasVariants={hasVariants}
        onFilterChange={handleFilterChange}
        categoryOptions={flatCategories}
        typeOptions={PRODUCT_TYPE_FILTERS}
        onClearAll={handleClearAllFilters}
        hasActiveFilters={hasActiveFilters}
        resultSummary={resultSummary}
      />

      {/* Catalog items */}
      {loading ? (
        <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-xl border border-neutral-200/80 bg-white">
          <LoadingSpinner size="md" />
          <p className="text-xs font-medium text-neutral-500">Loading catalog products...</p>
        </div>
      ) : (
        <ProductCatalogList
          products={products}
          expandedProductIds={expandedProductIds}
          onToggleExpand={toggleExpand}
          onEdit={(product) => {
            setEditingProduct(product);
            setShowProductModal(true);
          }}
          onEditVariants={setEditingVariantsProduct}
          onDelete={handleDeleteProduct}
          onToggleStatus={handleToggleProductStatus}
          onClearFilters={handleClearAllFilters}
          hasActiveFilters={hasActiveFilters}
        />
      )}

      {/* Server-Side Pagination (Zero NaN, Full Numeric Safety) */}
      {!loading && total > 0 && (
        <div className="rounded-xl border border-neutral-200/80 bg-white px-2 py-1 shadow-2xs">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={(p) => updateQuery({ page: p })}
            onPageSizeChange={(s) => updateQuery({ pageSize: s, page: 1 })}
            entityName="products"
          />
        </div>
      )}

      {/* Product Create / Edit Modal */}
      <Modal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        title={editingProduct ? "Edit Product" : "Create New Product"}
        size="4xl"
      >
        <ProductForm
          product={editingProduct}
          categories={categories}
          onSuccess={() => {
            setShowProductModal(false);
            fetchProducts();
          }}
          onCancel={() => setShowProductModal(false)}
        />
      </Modal>

      {/* Product-level Bulk Variant Edit Modal */}
      {editingVariantsProduct && (
        <ProductVariantsEditModal
          isOpen={Boolean(editingVariantsProduct)}
          product={editingVariantsProduct}
          onClose={() => setEditingVariantsProduct(null)}
          onVariantsChange={(updatedVariants) => {
            // Update the product's variant list in the catalog without
            // closing the Edit Variants modal.
            setProducts((prev) =>
              prev.map((item) =>
                item.id === editingVariantsProduct.id
                  ? { ...item, variants: updatedVariants }
                  : item
              )
            );
            // Also keep editingVariantsProduct in sync so its variant count
            // displayed in the banner updates live.
            setEditingVariantsProduct((prev) =>
              prev ? { ...prev, variants: updatedVariants } : prev
            );
          }}
        />
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-96 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <ProductsPageContent />
    </Suspense>
  );
}
