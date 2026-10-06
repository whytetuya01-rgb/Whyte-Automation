"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Product, Category, ProductVariant } from "@/types";
import { formatCurrency } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Package,
  Layers,
  Tag,
  AlertCircle,
  Cpu,
  RefreshCw,
  ExternalLink,
  Info,
  DollarSign,
  Receipt,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import Modal from "@/components/shared/Modal";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import ProductForm from "@/components/admin/ProductForm";
import ProductVariantsEditModal from "@/components/admin/ProductVariantsEditModal";
import { Button, Switch, Badge } from "@/components/ui";

const TYPE_CONFIG: Record<string, { label: string; badgeVariant: "info" | "secondary" | "default" | "warning" | "success" | "outline" }> = {
  switch_board: { label: "Switch Board", badgeVariant: "info" },
  accessory: { label: "Accessory", badgeVariant: "secondary" },
  curtain: { label: "Curtain", badgeVariant: "outline" },
  smart_lock: { label: "Smart Lock", badgeVariant: "success" },
  vdp: { label: "VDP", badgeVariant: "warning" },
  other: { label: "Other", badgeVariant: "default" },
};

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const productId = params?.id;

  const { data: session } = useSession();
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showEditProductModal, setShowEditProductModal] = useState(false);
  const [showEditVariantsModal, setShowEditVariantsModal] = useState(false);
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null);
  const confirm = useConfirm();

  const fetchProduct = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const [productRes, catRes] = await Promise.all([
        fetch(`/api/products/${productId}`),
        fetch("/api/categories"),
      ]);

      if (productRes.status === 401) {
        router.replace("/admin/login");
        return;
      }

      if (productRes.status === 404) {
        setNotFound(true);
        return;
      }

      if (!productRes.ok) {
        const errorData = await productRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to load product details");
      }

      const prodData = await productRes.json();
      setProduct(prodData);

      if (catRes.ok) {
        const catData = await catRes.json();
        if (Array.isArray(catData)) {
          setCategories(catData);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load product";
      setError(msg);
      notify.error("Error", msg);
    } finally {
      setLoading(false);
    }
  }, [productId, router]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  const handleToggleProductStatus = async () => {
    if (!product) return;
    try {
      const updated = await apiJson.patch<Product>(`/api/products/${product.id}`, {
        isActive: !product.isActive,
      });

      setProduct((prev) => (prev ? { ...prev, isActive: updated.isActive } : null));
      notify.success(
        updated.isActive ? "Product activated" : "Product deactivated",
        updated.isActive
          ? `"${product.name}" is now active.`
          : `"${product.name}" has been deactivated.`
      );
    } catch (err: unknown) {
      notifyApiError(err, "Status update failed", "Unable to update product status.");
    }
  };

  const handleDeleteProduct = async () => {
    if (!product) return;
    const current = product;
    const count = variants.length;

    await confirm({
      title: "Delete Product",
      message: `Are you sure you want to delete "${current.name}"?`,
      detail: `This product has ${count} associated ${count === 1 ? "variant" : "variants"}. If used in active quotations, deletion will be prevented.`,
      confirmText: "Delete Product",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: async () => {
        try {
          await apiJson.delete(`/api/products/${current.id}`);
          notify.success("Product deleted", `Product "${current.name}" has been removed.`);
          router.push("/admin/products");
        } catch (err: unknown) {
          notifyApiError(err, "Cannot delete product", "Failed to delete this product.");
        }
      },
    });
  };

  // Pricing calculations across variants
  const variants = product?.variants || [];
  const primaryVariant = useMemo(() => {
    if (variants.length === 0) return null;
    return variants.find((v) => v.isActive) || variants[0];
  }, [variants]);

  const priceStats = useMemo(() => {
    if (variants.length === 0) return null;
    const pricesInc = variants.map((v) => Number(v.price) || 0);
    const minPrice = Math.min(...pricesInc);
    const maxPrice = Math.max(...pricesInc);

    return {
      minPrice,
      maxPrice,
      hasRange: minPrice !== maxPrice,
    };
  }, [variants]);

  // Clean note filter (ignore internal migration paths like /whyte_catalog_images/...)
  const displayNotes = useMemo(() => {
    if (!product?.notes) return null;
    if (product.notes.startsWith("/") || product.notes.includes("whyte_catalog_images")) {
      return null;
    }
    return product.notes;
  }, [product?.notes]);

  // Loading Skeleton State
  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-16 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="h-4 w-28 bg-neutral-200 rounded"></div>
          <div className="h-4 w-4 bg-neutral-200 rounded"></div>
          <div className="h-4 w-36 bg-neutral-200 rounded"></div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-xs flex flex-col md:flex-row justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 bg-neutral-200 rounded-2xl"></div>
            <div className="space-y-2">
              <div className="h-6 w-48 bg-neutral-200 rounded"></div>
              <div className="h-4 w-64 bg-neutral-200 rounded"></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-28 bg-neutral-200 rounded-xl"></div>
            <div className="h-9 w-28 bg-neutral-200 rounded-xl"></div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-neutral-200 p-4"></div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="h-64 bg-white rounded-2xl border border-neutral-200 p-6"></div>
          </div>
          <div className="h-64 bg-white rounded-2xl border border-neutral-200 p-6"></div>
        </div>
      </div>
    );
  }

  // Error State
  if (error && !product) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 border border-red-200">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-base font-bold text-neutral-900">Unable to Display Product</h2>
        <p className="mt-2 text-xs text-neutral-600 leading-relaxed">{error}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchProduct} className="gap-2 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Reload Page
          </Button>
          <Link href="/admin/products">
            <Button variant="primary" size="sm" className="gap-2 text-xs bg-neutral-900 text-white">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Catalog
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Not Found State
  if (notFound || !product) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400 border border-neutral-200">
          <Package className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-base font-bold text-neutral-900">Product Not Found</h2>
        <p className="mt-2 text-xs text-neutral-500">
          The requested product is unavailable or has been removed.
        </p>
        <Link
          href="/admin/products"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-neutral-800 transition-all"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Return to Products Catalog
        </Link>
      </div>
    );
  }

  const typeConfig = TYPE_CONFIG[product.type] || TYPE_CONFIG.other;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* BREADCRUMB & TOP ACTIONS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <nav className="flex items-center gap-2 text-xs font-medium text-neutral-500">
          <Link href="/admin/products" className="hover:text-neutral-900 transition-colors flex items-center gap-1">
            <Package className="h-3.5 w-3.5" />
            Products Catalog
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
          <span className="text-neutral-900 font-semibold truncate max-w-[240px]">
            {product.name}
          </span>
        </nav>

        <Link href="/admin/products">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-neutral-600 hover:text-neutral-900 font-medium text-xs h-8"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Products Catalog
          </Button>
        </Link>
      </div>

      {/* HEADER BANNER CARD */}
      <div className="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-xs relative overflow-hidden">
        <div
          className={`absolute left-0 top-0 bottom-0 w-1.5 ${
            product.isActive ? "bg-emerald-500" : "bg-neutral-300"
          }`}
        />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pl-2">
          {/* Thumbnail & Core Title */}
          <div className="flex items-center gap-4">
            <div
              className="h-18 w-18 shrink-0 rounded-2xl border border-neutral-200 bg-neutral-50/80 overflow-hidden flex items-center justify-center shadow-xs cursor-pointer group relative"
              onClick={() => product.imageUrl && setSelectedImageModal(product.imageUrl)}
            >
              {product.imageUrl ? (
                <>
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-full w-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                  <div className="absolute inset-0 bg-neutral-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                    <ExternalLink className="h-4 w-4" />
                  </div>
                </>
              ) : (
                <Package className="h-9 w-9 text-neutral-300" />
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">
                  {product.name}
                </h1>

                <Badge variant={product.isActive ? "success" : "secondary"} size="md" className="gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${product.isActive ? "bg-emerald-500" : "bg-neutral-400"}`} />
                  {product.isActive ? "Active" : "Inactive"}
                </Badge>

                <Badge variant={typeConfig.badgeVariant} size="md">
                  {typeConfig.label}
                </Badge>
              </div>

              {/* Clean Business Metadata */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                {product.code && (
                  <>
                    <span className="font-mono">
                      SKU: <strong className="text-neutral-800 font-semibold">{product.code}</strong>
                    </span>
                    <span className="text-neutral-300">•</span>
                  </>
                )}
                <span>
                  Category: <strong className="text-neutral-800 font-semibold">{product.category?.name || "Uncategorized"}</strong>
                </span>
                {product.moduleSize && (
                  <>
                    <span className="text-neutral-300">•</span>
                    <span>
                      Module Size: <strong className="text-neutral-800 font-semibold">{product.moduleSize}</strong>
                    </span>
                  </>
                )}
                <span className="text-neutral-300">•</span>
                <span>
                  Unit: <strong className="text-neutral-800 font-semibold uppercase">{product.unit || "pcs"}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEditProductModal(true)}
              className="gap-2 text-xs font-semibold h-9"
            >
              <Pencil className="h-3.5 w-3.5 text-neutral-600" />
              Edit Product
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowEditVariantsModal(true)}
              className="gap-2 text-xs font-semibold h-9 bg-neutral-900 hover:bg-neutral-800 text-white shadow-xs"
            >
              <Layers className="h-3.5 w-3.5 text-neutral-300" />
              Edit Variants ({variants.length})
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteProduct}
              className="gap-1.5 text-xs font-semibold h-9 text-red-600 hover:text-red-700 hover:bg-red-50/80 border-red-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* EXECUTIVE SUMMARY METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Variants */}
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4.5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Configurations
            </span>
            <Layers className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <span className="text-2xl font-black font-mono text-neutral-900 tracking-tight">
              {variants.length}
            </span>
            <span className="text-[11px] font-medium text-neutral-500">
              {variants.filter((v) => v.isActive).length} Active
            </span>
          </div>
        </div>

        {/* Metric 2: Selling Price (MRP) */}
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4.5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Selling Price (MRP)
            </span>
            <Receipt className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="pt-1">
            {primaryVariant ? (
              <span className="text-xl font-black font-mono text-neutral-950 tracking-tight">
                {priceStats?.hasRange
                  ? `${formatCurrency(priceStats.minPrice)} – ${formatCurrency(priceStats.maxPrice)}`
                  : formatCurrency(Number(primaryVariant.price))}
              </span>
            ) : (
              <span className="text-sm font-medium text-neutral-400 italic">No price set</span>
            )}
          </div>
        </div>

        {/* Metric 3: Base Price (Excl. Tax) */}
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4.5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Base Price (Excl. Tax)
            </span>
            <DollarSign className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="pt-1">
            {primaryVariant ? (
              <span className="text-xl font-bold font-mono text-neutral-800 tracking-tight">
                {priceStats?.hasRange
                  ? `${formatCurrency(priceStats.minPrice / 1.18)} – ${formatCurrency(priceStats.maxPrice / 1.18)}`
                  : formatCurrency(Number(primaryVariant.priceWithoutTax || (Number(primaryVariant.price) / 1.18)))}
              </span>
            ) : (
              <span className="text-sm font-medium text-neutral-400 italic">No price set</span>
            )}
          </div>
        </div>

        {/* Metric 4: Tax Structure */}
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4.5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              GST Tax Rate
            </span>
            <Tag className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <span className="text-xl font-bold font-mono text-neutral-900 tracking-tight">
              {primaryVariant?.taxPercent ? `${primaryVariant.taxPercent}%` : "18% GST"}
            </span>
            <span className="text-[10px] font-semibold text-accent bg-accent/5 px-2 py-0.5 rounded border border-accent/20">
              Tax Inclusive
            </span>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN: OVERVIEW & PRICING */}
        <div className="lg:col-span-2 space-y-6">
          {/* PRODUCT OVERVIEW CARD */}
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-2">
                <Info className="h-4 w-4 text-neutral-400" />
                Product Details
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-xs">
              <div>
                <span className="text-neutral-400 font-medium block">Product Name</span>
                <span className="text-neutral-900 font-bold text-sm block mt-0.5">
                  {product.name}
                </span>
              </div>

              <div>
                <span className="text-neutral-400 font-medium block">Product Code / SKU</span>
                <span className="font-mono text-neutral-900 font-semibold text-sm block mt-0.5">
                  {product.code ? (
                    <span className="bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200">
                      {product.code}
                    </span>
                  ) : (
                    <span className="text-neutral-400 italic">Not assigned</span>
                  )}
                </span>
              </div>

              <div>
                <span className="text-neutral-400 font-medium block">Category</span>
                <span className="text-neutral-900 font-semibold block mt-0.5">
                  {product.category?.name || "Uncategorized"}
                </span>
              </div>

              <div>
                <span className="text-neutral-400 font-medium block">Module Size</span>
                <span className="text-neutral-900 font-semibold block mt-0.5">
                  {product.moduleSize ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-neutral-100 text-neutral-800 border border-neutral-200">
                      {product.moduleSize}
                    </span>
                  ) : (
                    <span className="text-neutral-400 italic font-normal">Not specified</span>
                  )}
                </span>
              </div>

              <div>
                <span className="text-neutral-400 font-medium block">Product Type</span>
                <span className="text-neutral-900 font-semibold block mt-0.5 capitalize">
                  {typeConfig.label}
                </span>
              </div>

              <div>
                <span className="text-neutral-400 font-medium block">Unit of Measure</span>
                <span className="text-neutral-900 font-semibold block mt-0.5 uppercase">
                  {product.unit || "pcs"}
                </span>
              </div>

              {displayNotes && (
                <div className="sm:col-span-2 pt-2 border-t border-neutral-100">
                  <span className="text-neutral-400 font-medium block">Product Reference / Family</span>
                  <p className="text-neutral-800 text-xs bg-neutral-50 p-2.5 rounded-xl border border-neutral-200/70 mt-1">
                    {displayNotes}
                  </p>
                </div>
              )}

              {product.description && (
                <div className="sm:col-span-2 pt-2 border-t border-neutral-100">
                  <span className="text-neutral-400 font-medium block">Description</span>
                  <p className="text-neutral-700 leading-relaxed mt-1">
                    {product.description}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* PRICING BREAKDOWN CARD */}
          {primaryVariant && (
            <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                    Product Pricing Structure
                  </h3>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Calculations for primary configuration ({formatTierLabel(primaryVariant.automationTier) || "Standard"}{primaryVariant.surfaceFinish ? ` / ${formatFinishLabel(primaryVariant.surfaceFinish)}` : ""})
                  </p>
                </div>
                <Badge variant="outline" size="sm">
                  18% Tax Inclusive
                </Badge>
              </div>

              <div className={`grid grid-cols-2 ${isAdmin ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-4 p-4 rounded-xl bg-neutral-50/70 border border-neutral-200/60 text-xs`}>
                <div>
                  <span className="text-neutral-400 block font-medium">Selling Price (MRP)</span>
                  <span className="text-base font-black font-mono text-neutral-900 block mt-0.5">
                    {formatCurrency(Number(primaryVariant.price))}
                  </span>
                </div>

                <div>
                  <span className="text-neutral-400 block font-medium">Price (Excl. Tax)</span>
                  <span className="text-sm font-bold font-mono text-neutral-800 block mt-0.5">
                    {formatCurrency(Number(primaryVariant.priceWithoutTax || (Number(primaryVariant.price) / 1.18)))}
                  </span>
                </div>

                <div>
                  <span className="text-neutral-400 block font-medium">Tax Amount (18%)</span>
                  <span className="text-sm font-semibold font-mono text-neutral-700 block mt-0.5">
                    {formatCurrency(Number(primaryVariant.taxAmount || (Number(primaryVariant.price) - (Number(primaryVariant.price) / 1.18))))}
                  </span>
                </div>

                {/* Show Purchase Cost ONLY to Admin / Super-Admin */}
                {isAdmin && (
                  <div>
                    <span className="text-neutral-400 block font-medium">Cost Price</span>
                    <span className="text-sm font-semibold font-mono text-neutral-700 block mt-0.5">
                      {primaryVariant.cost ? formatCurrency(Number(primaryVariant.cost)) : "₹0.00"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: IMAGE & STATUS PANEL */}
        <div className="space-y-6">
          {/* PRODUCT IMAGE CARD */}
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              Product Image
            </h3>

            <div className="aspect-square w-full rounded-2xl border border-neutral-200 bg-neutral-50/60 flex items-center justify-center overflow-hidden p-4 relative group">
              {product.imageUrl ? (
                <>
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                  <div
                    className="absolute inset-0 bg-neutral-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer text-white"
                    onClick={() => product.imageUrl && setSelectedImageModal(product.imageUrl)}
                  >
                    <span className="text-xs font-bold bg-neutral-900/90 px-3 py-1.5 rounded-xl border border-white/20 shadow-xs flex items-center gap-1.5">
                      <ExternalLink className="h-3.5 w-3.5" /> View Image
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-center p-6 space-y-2">
                  <Package className="h-12 w-12 text-neutral-300 mx-auto" />
                  <p className="text-xs font-semibold text-neutral-500">No image assigned</p>
                </div>
              )}
            </div>
          </div>

          {/* ACTIVE STATUS TOGGLE CARD */}
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-neutral-900">Active Status</p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {product.isActive ? "Available for quotes" : "Disabled in quotes"}
              </p>
            </div>
            <Switch checked={product.isActive} onChange={handleToggleProductStatus} />
          </div>
        </div>
      </div>

      {/* SELLABLE VARIANTS TABLE SECTION */}
      <div className="rounded-2xl border border-neutral-200/90 bg-white shadow-xs overflow-hidden">
        <div className="p-5 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-neutral-900 text-white flex items-center justify-center">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                Sellable Configurations
                <Badge variant="default" size="sm" className="font-mono">
                  {variants.length} Variants
                </Badge>
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Available automation tier & surface finish options.
              </p>
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowEditVariantsModal(true)}
            className="gap-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white self-start sm:self-center shadow-xs"
          >
            <Layers className="h-3.5 w-3.5" />
            Edit Variants Matrix
          </Button>
        </div>

        {variants.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-neutral-100 text-neutral-400 mx-auto flex items-center justify-center border border-neutral-200">
              <Package className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-neutral-800">No variants assigned</h3>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto">
              This product currently has no active variants. Click "Edit Variants Matrix" to configure combinations.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEditVariantsModal(true)}
              className="gap-2 text-xs font-semibold mt-2"
            >
              <Layers className="h-3.5 w-3.5" />
              Configure Variant Matrix
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/80 text-neutral-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Automation</th>
                  <th className="py-3 px-4">Finish</th>
                  <th className="py-3 px-4">Variant Code / SKU</th>
                  <th className="py-3 px-4 text-right">Price Excl. Tax</th>
                  <th className="py-3 px-3 text-right">Tax %</th>
                  <th className="py-3 px-3 text-right">Tax Amount</th>
                  <th className="py-3 px-4 text-right font-black text-neutral-900">Selling Price (MRP)</th>
                  {isAdmin && <th className="py-3 px-3 text-right">Cost</th>}
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-800 font-medium">
                {variants.map((v) => {
                  const autoTier = v.automationTier || "";
                  const finish = v.surfaceFinish || "";
                  const tierLabel = formatTierLabel(autoTier);
                  const finishLabel = formatFinishLabel(finish);
                  const vCode = v.variantCode || v.code || (v.config as any)?.variantCode || (v.config as any)?.code;

                  const numPrice = Number(v.price) || 0;
                  const taxPct = v.taxPercent !== undefined && v.taxPercent !== null ? Number(v.taxPercent) : 18;
                  const priceWithoutTax = v.priceWithoutTax !== undefined && v.priceWithoutTax !== null
                    ? Number(v.priceWithoutTax)
                    : Math.round((numPrice / (1 + taxPct / 100)) * 100) / 100;
                  const taxAmount = v.taxAmount !== undefined && v.taxAmount !== null
                    ? Number(v.taxAmount)
                    : Math.round((numPrice - priceWithoutTax) * 100) / 100;

                  return (
                    <tr key={v.id} className="hover:bg-neutral-50/70 transition-colors">
                      {/* Automation Tier */}
                      <td className="py-3.5 px-4">
                        {tierLabel ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/80">
                            <Cpu className="h-3 w-3 text-blue-500" />
                            {tierLabel}
                          </span>
                        ) : (
                          <span className="text-neutral-400 italic text-[11px]">Standard / NA</span>
                        )}
                      </td>

                      {/* Surface Finish */}
                      <td className="py-3.5 px-4">
                        {finishLabel ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-neutral-100 text-neutral-800 border border-neutral-200">
                            <Layers className="h-3 w-3 text-neutral-500" />
                            {finishLabel}
                          </span>
                        ) : (
                          <span className="text-neutral-400 italic text-[11px]">Standard / NA</span>
                        )}
                      </td>

                      {/* Variant Code */}
                      <td className="py-3.5 px-4 font-mono">
                        {vCode ? (
                          <span className="bg-neutral-100 px-2 py-1 rounded text-neutral-900 border border-neutral-200 font-bold">
                            {vCode}
                          </span>
                        ) : (
                          <span className="text-neutral-400 italic text-[11px]">Not assigned</span>
                        )}
                      </td>

                      {/* Price Without Tax */}
                      <td className="py-3.5 px-4 text-right font-mono text-neutral-600">
                        {formatCurrency(priceWithoutTax)}
                      </td>

                      {/* Tax % */}
                      <td className="py-3.5 px-3 text-right font-mono text-neutral-500">
                        {taxPct}%
                      </td>

                      {/* Tax Amount */}
                      <td className="py-3.5 px-3 text-right font-mono text-neutral-600">
                        {formatCurrency(taxAmount)}
                      </td>

                      {/* Price With Tax */}
                      <td className="py-3.5 px-4 text-right font-black font-mono text-sm text-neutral-950">
                        {formatCurrency(numPrice)}
                      </td>

                      {/* Cost Column (Admin only) */}
                      {isAdmin && (
                        <td className="py-3.5 px-3 text-right font-mono text-neutral-500">
                          {v.cost ? formatCurrency(Number(v.cost)) : "₹0.00"}
                        </td>
                      )}

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        <Badge variant={v.isActive ? "success" : "secondary"} size="sm">
                          {v.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* EDIT BASE PRODUCT MODAL */}
      <Modal
        isOpen={showEditProductModal}
        onClose={() => setShowEditProductModal(false)}
        title="Edit Base Product Information"
        size="4xl"
      >
        <ProductForm
          product={product}
          categories={categories}
          onSuccess={() => {
            setShowEditProductModal(false);
            fetchProduct();
          }}
          onCancel={() => setShowEditProductModal(false)}
        />
      </Modal>

      {/* EDIT VARIANTS MODAL */}
      <ProductVariantsEditModal
        isOpen={showEditVariantsModal}
        product={product}
        onClose={() => setShowEditVariantsModal(false)}
        onVariantsChange={(updatedVariants) => {
          setProduct((prev) => (prev ? { ...prev, variants: updatedVariants } : null));
        }}
      />

      {/* IMAGE PREVIEW MODAL */}
      {selectedImageModal && (
        <Modal
          isOpen={!!selectedImageModal}
          onClose={() => setSelectedImageModal(null)}
          title={product.name}
          size="lg"
        >
          <div className="p-4 flex flex-col items-center justify-center space-y-4">
            <div className="max-h-[70vh] w-full flex items-center justify-center overflow-hidden rounded-xl bg-neutral-50 p-2">
              <img
                src={selectedImageModal}
                alt={product.name}
                className="max-h-[65vh] w-auto object-contain"
              />
            </div>
            <div className="flex items-center justify-end w-full border-t border-neutral-100 pt-3">
              <Button variant="outline" size="sm" onClick={() => setSelectedImageModal(null)}>
                Close Preview
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
