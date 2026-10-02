"use client";

import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { Product, Category, ProductVariant } from "@/types";
import { formatCurrency } from "@/lib/utils";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  RefreshCw,
  Package,
  Layers,
  Cpu,
  Eye,
  X,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import Modal from "@/components/shared/Modal";
import ProductForm from "@/components/admin/ProductForm";
import ProductVariantsEditModal from "@/components/admin/ProductVariantsEditModal";
import Pagination from "@/components/shared/Pagination";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Button, Input, Select } from "@/components/ui";

const TYPE_CONFIG: Record<string, { label: string; badge: string }> = {
  switch_board: { label: "Switch Board", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  accessory: { label: "Accessory", badge: "bg-neutral-100 text-neutral-700 border-neutral-200" },
  retrofit: { label: "Retrofit", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  curtain: { label: "Curtain", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  smart_lock: { label: "Smart Lock", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  vdp: { label: "VDP", badge: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  other: { label: "Other", badge: "bg-neutral-100 text-neutral-600 border-neutral-200" },
};

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

      if (!res.ok) {
        throw new Error("Failed to load products");
      }

      const data = await res.json();
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

  return (
    <div className="space-y-5 pb-12">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Products</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            TreeTable catalog view: Products (parent rows) and sellable configurations (child rows).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchProducts}
            disabled={loading}
            className="gap-1.5 text-neutral-700 bg-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setEditingProduct(null);
              setShowProductModal(true);
            }}
            className="gap-1.5 shadow-xs"
          >
            <Plus className="h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Summary Stat Cards (Catalog-Wide Totals) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-neutral-200/80 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Total Products
            </span>
            <Package className="h-4 w-4 text-neutral-400" />
          </div>
          <span className="text-2xl font-bold text-neutral-900 mt-1 block tracking-tight">
            {displayTotalProducts}
          </span>
        </div>

        <div className="rounded-xl border border-neutral-200/80 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Active Products
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <span className="text-2xl font-bold text-emerald-600 mt-1 block tracking-tight">
            {displayTotalActive}
          </span>
        </div>

        <div className="rounded-xl border border-neutral-200/80 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Total Variants
            </span>
            <Layers className="h-4 w-4 text-blue-500" />
          </div>
          <span className="text-2xl font-bold text-blue-600 mt-1 block tracking-tight">
            {displayTotalVariants}
          </span>
        </div>

        <div className="rounded-xl border border-neutral-200/80 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Categories
            </span>
            <Cpu className="h-4 w-4 text-neutral-400" />
          </div>
          <span className="text-2xl font-bold text-neutral-900 mt-1 block tracking-tight">
            {displayTotalCategories}
          </span>
        </div>
      </div>

      {/* Unified Search and Filter Toolbar */}
      <div className="rounded-xl border border-neutral-200/80 bg-white p-3.5 shadow-2xs space-y-3">
        {/* Controls Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          {/* Search Input */}
          <div className="lg:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  updateQuery({ search: searchInput, page: 1 });
                }
              }}
              placeholder="Search products, codes or variant SKU..."
              className="pl-9 pr-8 text-xs h-9 bg-neutral-50/50 focus:bg-white"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  updateQuery({ search: null, page: 1 });
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-0.5"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter */}
          <div>
            <Select
              value={category}
              onChange={(e) => updateQuery({ category: e.target.value, page: 1 })}
              className="text-xs h-9 bg-neutral-50/50"
            >
              <option value="all">Category: All</option>
              {flatCategories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Type Filter */}
          <div>
            <Select
              value={type}
              onChange={(e) => updateQuery({ type: e.target.value, page: 1 })}
              className="text-xs h-9 bg-neutral-50/50"
            >
              <option value="all">Type: All</option>
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>
                  {cfg.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Status Filter */}
          <div>
            <Select
              value={status}
              onChange={(e) => updateQuery({ status: e.target.value, page: 1 })}
              className="text-xs h-9 bg-neutral-50/50"
            >
              <option value="all">Status: All</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </Select>
          </div>

          {/* Sort Filter */}
          <div>
            <Select
              value={sort}
              onChange={(e) => updateQuery({ sort: e.target.value, page: 1 })}
              className="text-xs h-9 bg-neutral-50/50"
            >
              <option value="sortOrder_asc">Sort: Catalog Order</option>
              <option value="name_asc">Name: A to Z</option>
              <option value="name_desc">Name: Z to A</option>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </Select>
          </div>
        </div>

        {/* Secondary Filter Line */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-neutral-100 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 font-medium">Configurations:</span>
            <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50/60 p-0.5">
              {[
                { label: "All Products", value: "all" },
                { label: "With Variants", value: "yes" },
                { label: "No Variants", value: "no" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => updateQuery({ hasVariants: item.value, page: 1 })}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    hasVariants === item.value
                      ? "bg-white text-neutral-900 shadow-2xs font-semibold"
                      : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
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
              }}
              className="h-7 text-xs text-neutral-500 hover:text-neutral-900 gap-1"
            >
              <X className="h-3 w-3" />
              Clear all filters
            </Button>
          )}
        </div>
      </div>

      {/* Main TreeTable Container */}
      <div className="rounded-xl border border-neutral-200/80 bg-white shadow-2xs overflow-hidden">
        {loading ? (
          <div className="flex h-72 flex-col items-center justify-center gap-3">
            <LoadingSpinner size="md" />
            <p className="text-xs font-medium text-neutral-500">Loading catalog products...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="py-16 text-center">
            <Package className="h-10 w-10 text-neutral-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-neutral-800">No products found</h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
              No products match your current search and filter criteria.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              {/* Approved Black Table Header */}
              <thead className="bg-neutral-900 text-white font-semibold text-xs tracking-wider uppercase">
                <tr className="border-b border-neutral-800">
                  <th className="py-3.5 px-4 w-[110px]">IMAGE</th>
                  <th className="py-3.5 px-4 w-[380px]">PRODUCT FAMILY</th>
                  <th className="py-3.5 px-4 w-[150px]">TYPE</th>
                  <th className="py-3.5 px-4 w-[150px]">VARIANTS</th>
                  <th className="py-3.5 px-4 text-center w-[110px]">STATUS</th>
                  <th className="py-3.5 px-4 text-right w-[150px]">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-700">
                {products.map((p) => {
                  const typeCfg = TYPE_CONFIG[p.type] || TYPE_CONFIG.other;
                  const variants = p.variants || [];
                  const variantCount = variants.length;
                  const isExpanded = expandedProductIds.has(p.id);

                  return (
                    <React.Fragment key={p.id}>
                      {/* PARENT PRODUCT ROW (WHITE) */}
                      <tr
                        className={`transition-colors bg-white hover:bg-neutral-50/60 ${
                          isExpanded ? "bg-neutral-50/40" : ""
                        }`}
                      >
                        {/* 1. IMAGE: [expand/collapse] [image] */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            {/* Expand/Collapse Chevron Button */}
                            <button
                              type="button"
                              onClick={() => toggleExpand(p.id)}
                              className="h-6 w-6 shrink-0 rounded flex items-center justify-center text-neutral-400 hover:text-neutral-900 hover:bg-neutral-200/60 transition-colors"
                              title={isExpanded ? "Collapse variants" : "Expand variants"}
                              aria-label={isExpanded ? "Collapse variants" : "Expand variants"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-neutral-900" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-neutral-500" />
                              )}
                            </button>

                            {/* Product Image Thumbnail */}
                            <div className="h-12 w-12 shrink-0 rounded-lg border border-neutral-200/80 bg-neutral-50 overflow-hidden flex items-center justify-center shadow-2xs p-0.5">
                              {p.imageUrl ? (
                                <img
                                  src={p.imageUrl}
                                  alt={p.name}
                                  className="h-full w-full object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <Package className="h-5 w-5 text-neutral-300" />
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 2. PRODUCT FAMILY: Product Name, Catalog/family, Product description/sub-information */}
                        <td className="py-3 px-4">
                          <div className="min-w-0">
                            {/* Product Name (Primary Clickable Element) */}
                            <Link
                              href={`/admin/products/${p.id}`}
                              className="font-bold text-sm text-neutral-900 hover:text-blue-600 transition-colors truncate block"
                              title={p.name}
                            >
                              {p.name}
                            </Link>

                            {/* Catalog / Family Information */}
                            {p.notes && (
                              <p className="text-xs font-semibold text-neutral-600 mt-0.5">
                                {p.notes}
                              </p>
                            )}

                            {/* Sub-information / Description */}
                            <p className="text-[11px] text-neutral-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                              <span>
                                Code:{" "}
                                <strong className="text-neutral-600 font-mono">
                                  {p.code ? p.code : "Not assigned"}
                                </strong>
                              </span>
                              <span>•</span>
                              <span>
                                Module:{" "}
                                <strong className="text-neutral-600">
                                  {p.moduleSize ? p.moduleSize : "No size"}
                                </strong>
                              </span>
                              <span>•</span>
                              <span>{p.category?.name || "Uncategorized"}</span>
                            </p>
                          </div>
                        </td>

                        {/* 3. TYPE: [Type] Badge */}
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
                            {typeCfg.label}
                          </span>
                        </td>

                        {/* 4. VARIANTS: [X variants ▼] neutral chip */}
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => toggleExpand(p.id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
                              isExpanded
                                ? "bg-neutral-100 text-neutral-900 border-neutral-300"
                                : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300"
                            }`}
                            title={isExpanded ? "Click to collapse" : "Click to expand"}
                          >
                            <span>{variantCount} {variantCount === 1 ? "variant" : "variants"}</span>
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>

                        {/* 5. STATUS: [Active] / [Inactive] Badge */}
                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleProductStatus(p)}
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                              p.isActive
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                : "bg-neutral-100 text-neutral-500 border-neutral-200 hover:bg-neutral-200"
                            }`}
                            title="Click to toggle status"
                          >
                            {p.isActive ? "Active" : "Inactive"}
                          </button>
                        </td>

                        {/* 6. ACTIONS: [View] [Edit] [Edit Variants] [Delete] */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap sm:flex-nowrap">
                            <Link href={`/admin/products/${p.id}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-neutral-600 hover:text-neutral-900"
                                title="View Product Details"
                              >
                                View
                              </Button>
                            </Link>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingProduct(p);
                                setShowProductModal(true);
                              }}
                              className="h-7 px-2 text-xs text-neutral-600 hover:text-neutral-900"
                              title="Edit Product"
                            >
                              Edit
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingVariantsProduct(p)}
                              className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 font-medium"
                              title="Edit Variants"
                            >
                              Edit Variants
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteProduct(p)}
                              className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Delete Product"
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* WHEN EXPANDED: VARIANTS (X) SUB-TABLE */}
                      {isExpanded && (
                        <tr className="bg-neutral-50/50">
                          <td colSpan={6} className="p-3.5 pl-8 md:pl-16 pr-4">
                            {/* Nested Container with subtle left accent/border */}
                            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-xs border-l-4 border-l-blue-600">
                              {/* Variant Section Header */}
                              <div className="px-4 py-2.5 bg-neutral-900 text-white flex items-center justify-between border-b border-neutral-800">
                                <span className="text-xs font-bold uppercase tracking-wider text-white">
                                  VARIANTS ({variantCount})
                                </span>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  {variants.filter((v) => v.isActive).length} Active
                                </span>
                              </div>

                              {variantCount === 0 ? (
                                <div className="p-6 text-center text-xs text-neutral-400 italic">
                                  No variants assigned to this product.
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs border-collapse table-fixed">
                                    {/* Dedicated dark table header without individual actions */}
                                    <thead className="bg-neutral-800 text-neutral-200 uppercase text-[10px] font-semibold tracking-wider">
                                      <tr className="border-b border-neutral-700">
                                        <th className="py-2.5 px-3.5 w-12 text-center">#</th>
                                        <th className="py-2.5 px-3.5 w-[240px]">VARIANT DISPLAY NAME</th>
                                        <th className="py-2.5 px-3.5 w-[220px]">TIER &amp; FINISH</th>
                                        <th className="py-2.5 px-3.5 w-[200px]">VARIANT CODE / SKU</th>
                                        <th className="py-2.5 px-3.5 w-[140px] text-right">PRICE</th>
                                        <th className="py-2.5 px-3.5 w-[120px] text-center">STATUS</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-100 text-neutral-700 bg-white">
                                      {variants.map((v, vIndex) => {
                                        const autoTier = v.automationTier || (v.config as any)?.series || "";
                                        const finish = v.surfaceFinish || (v.config as any)?.finish || "";
                                        const parts: string[] = [];
                                        if (autoTier) parts.push(autoTier.charAt(0).toUpperCase() + autoTier.slice(1));
                                        if (finish) parts.push(finish.charAt(0).toUpperCase() + finish.slice(1));
                                        const vDisplayName = parts.length > 0 ? parts.join(" · ") : "Standard";
                                        const vCode = v.variantCode || v.code || (v.config as any)?.variantCode || (v.config as any)?.code;

                                        return (
                                          <tr
                                            key={v.id}
                                            className="hover:bg-neutral-50/80 transition-colors"
                                          >
                                            {/* 1. # */}
                                            <td className="py-2.5 px-3.5 text-center text-neutral-400 font-mono text-[11px]">
                                              {vIndex + 1}
                                            </td>

                                            {/* 2. VARIANT DISPLAY NAME */}
                                            <td className="py-2.5 px-3.5 font-semibold text-neutral-900">
                                              {vDisplayName}
                                            </td>

                                            {/* 3. TIER & FINISH */}
                                            <td className="py-2.5 px-3.5">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                {autoTier ? (
                                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 capitalize">
                                                    {autoTier}
                                                  </span>
                                                ) : (
                                                  <span className="text-[11px] text-neutral-400 italic">No tier</span>
                                                )}
                                                {finish ? (
                                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-100 text-neutral-700 border border-neutral-200 capitalize">
                                                    {finish}
                                                  </span>
                                                ) : (
                                                  <span className="text-[11px] text-neutral-400 italic">No finish</span>
                                                )}
                                              </div>
                                            </td>

                                            {/* 4. VARIANT CODE / SKU */}
                                            <td className="py-2.5 px-3.5 font-mono text-neutral-800">
                                              {vCode ? (
                                                <span className="bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200 text-[11px] font-medium inline-block">
                                                  {vCode}
                                                </span>
                                              ) : (
                                                <span className="text-neutral-400 italic">Not assigned</span>
                                              )}
                                            </td>

                                            {/* 5. PRICE */}
                                            <td className="py-2.5 px-3.5 text-right font-semibold text-neutral-900">
                                              {Number.isFinite(Number(v.price)) ? formatCurrency(v.price) : "—"}
                                            </td>

                                            {/* 6. STATUS */}
                                            <td className="py-2.5 px-3.5 text-center">
                                              <span
                                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                                  v.isActive
                                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                                    : "bg-neutral-100 text-neutral-500 border-neutral-200"
                                                }`}
                                              >
                                                {v.isActive ? "Active" : "Inactive"}
                                              </span>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Server-Side Pagination Component (Zero NaN, Full Numeric Safety) */}
        {!loading && total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={(p) => updateQuery({ page: p })}
            onPageSizeChange={(s) => updateQuery({ pageSize: s, page: 1 })}
            entityName="products"
          />
        )}
      </div>

      {/* Product Create / Edit Modal */}
      <Modal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        title={editingProduct ? "Edit Product" : "Create New Product"}
        size="lg"
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
            // Update the product's variant list in the TreeTable without
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

      {/* Delete Product Confirmation — uses the global ConfirmProvider portal,
          so it can never be trapped inside another modal's stacking context. */}
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
