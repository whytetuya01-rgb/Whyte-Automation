"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Product, Category, ProductVariant } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Package,
  Layers,
  Calendar,
  Tag,
  AlertCircle,
  Cpu,
  Hash,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Modal from "@/components/shared/Modal";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import ProductForm from "@/components/admin/ProductForm";
import ProductVariantsEditModal from "@/components/admin/ProductVariantsEditModal";
import { Button, Switch } from "@/components/ui";

const TYPE_CONFIG: Record<string, { label: string; badge: string }> = {
  switch_board: { label: "Switch Board", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  accessory: { label: "Accessory", badge: "bg-neutral-100 text-neutral-700 border-neutral-200" },
  retrofit: { label: "Retrofit", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  curtain: { label: "Curtain", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  smart_lock: { label: "Smart Lock", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  vdp: { label: "VDP", badge: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  other: { label: "Other", badge: "bg-neutral-100 text-neutral-600 border-neutral-200" },
};

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const productId = params?.id;

  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showEditProductModal, setShowEditProductModal] = useState(false);
  const [showEditVariantsModal, setShowEditVariantsModal] = useState(false);
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
          ? `"${product.name}" is now active in the catalog.`
          : `"${product.name}" has been deactivated.`
      );
    } catch (err: unknown) {
      notifyApiError(err, "Status update failed", "Unable to update product status.");
    }
  };

  const handleDeleteProduct = async () => {
    if (!product) return;
    const current = product;
    const count = variantCount;

    await confirm({
      title: "Delete Product",
      message: `Are you sure you want to delete "${current.name}"?`,
      detail: `This product has ${count} associated ${count === 1 ? "variant" : "variants"}. If it or any of its variants are used in existing quotations, deletion will be blocked.`,
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

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm font-medium text-neutral-500">Loading product details...</p>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400">
          <Package className="h-8 w-8" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-neutral-900">Product Not Found</h2>
        <p className="mt-2 text-sm text-neutral-500">
          The requested product ID #{productId} does not exist or has been removed.
        </p>
        <Link
          href="/admin/products"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Products Catalog
        </Link>
      </div>
    );
  }

  const typeConfig = TYPE_CONFIG[product.type] || TYPE_CONFIG.other;
  const variants = product.variants || [];
  const variantCount = variants.length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Back Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/admin/products">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-neutral-600 hover:text-neutral-900 font-medium"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Products
          </Button>
        </Link>
      </div>

      {/* Header Banner */}
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            {/* Thumbnail */}
            <div className="h-16 w-16 shrink-0 rounded-xl border border-neutral-200 bg-neutral-50 overflow-hidden flex items-center justify-center shadow-xs">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-contain p-1"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <Package className="h-8 w-8 text-neutral-300" />
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-neutral-900">{product.name}</h1>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${typeConfig.badge}`}
                >
                  {typeConfig.label}
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                    product.isActive
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-neutral-100 text-neutral-600 border-neutral-200"
                  }`}
                >
                  {product.isActive ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-neutral-500">
                <span className="font-mono">
                  Code:{" "}
                  <strong className="text-neutral-700">
                    {product.code ? product.code : "Not assigned"}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Module:{" "}
                  <strong className="text-neutral-700">
                    {product.moduleSize ? product.moduleSize : "No size"}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Category:{" "}
                  <strong className="text-neutral-700">
                    {product.category?.name || "Uncategorized"}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  ID: <strong className="text-neutral-700">#{product.id}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2 self-start md:self-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEditProductModal(true)}
              className="gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Product
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEditVariantsModal(true)}
              className="gap-1.5"
            >
              <Layers className="h-3.5 w-3.5" />
              Edit Variants
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDeleteProduct()}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Main Grid: Left = Product Information, Right = Specifications */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Product Information (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-xs space-y-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-100 pb-3">
              Product Information
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <span className="text-xs font-medium text-neutral-400 block">Product Name</span>
                <span className="text-sm font-semibold text-neutral-900 mt-0.5 block">
                  {product.name}
                </span>
              </div>

              <div>
                <span className="text-xs font-medium text-neutral-400 block">Product Code</span>
                <span className="text-sm font-mono text-neutral-900 mt-0.5 block">
                  {product.code || (
                    <span className="text-neutral-400 italic">Not assigned</span>
                  )}
                </span>
              </div>

              <div>
                <span className="text-xs font-medium text-neutral-400 block">Category</span>
                <span className="text-sm font-medium text-neutral-900 mt-0.5 block">
                  {product.category?.name || "Uncategorized"}
                </span>
              </div>

              <div>
                <span className="text-xs font-medium text-neutral-400 block">Module Size</span>
                <span className="text-sm font-medium text-neutral-900 mt-0.5 block">
                  {product.moduleSize ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-neutral-100 text-neutral-800 border border-neutral-200">
                      {product.moduleSize}
                    </span>
                  ) : (
                    <span className="text-neutral-400 italic">No size</span>
                  )}
                </span>
              </div>

              <div>
                <span className="text-xs font-medium text-neutral-400 block">Product Type</span>
                <span className="text-sm font-medium text-neutral-900 mt-0.5 block capitalize">
                  {typeConfig.label}
                </span>
              </div>

              <div>
                <span className="text-xs font-medium text-neutral-400 block">Unit of Measure</span>
                <span className="text-sm font-medium text-neutral-900 mt-0.5 block">
                  {product.unit || "pcs"}
                </span>
              </div>

              {product.notes && (
                <div className="md:col-span-2">
                  <span className="text-xs font-medium text-neutral-400 block">Catalog / Family Reference</span>
                  <div className="text-xs font-medium text-neutral-800 bg-neutral-50 px-3 py-2 rounded-lg border border-neutral-200/60 mt-1">
                    {product.notes}
                  </div>
                </div>
              )}

              {product.description && (
                <div className="md:col-span-2">
                  <span className="text-xs font-medium text-neutral-400 block">Description</span>
                  <p className="text-sm text-neutral-700 mt-1 leading-relaxed">
                    {product.description}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Image Preview & Metadata (1 col) */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Catalog Image
            </h3>

            <div className="aspect-square w-full rounded-xl border border-neutral-200 bg-neutral-50 flex items-center justify-center overflow-hidden p-3">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="text-center p-4">
                  <Package className="h-10 w-10 text-neutral-300 mx-auto" />
                  <p className="text-xs text-neutral-400 mt-1">No image assigned</p>
                </div>
              )}
            </div>

            {product.imageUrl && (
              <p className="text-[11px] font-mono text-neutral-500 truncate" title={product.imageUrl}>
                {product.imageUrl}
              </p>
            )}
          </div>

          {/* Status Switch Card */}
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-900">Active in Catalog</p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {product.isActive ? "Visible in quotes" : "Archived"}
              </p>
            </div>
            <Switch checked={product.isActive} onChange={handleToggleProductStatus} />
          </div>
        </div>
      </div>

      {/* ProductVariants Section */}
      <div className="rounded-2xl border border-neutral-200/80 bg-white shadow-xs overflow-hidden">
        <div className="p-5 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-neutral-900">Sellable Variants</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-800 border border-neutral-200">
              {variantCount} {variantCount === 1 ? "Variant" : "Variants"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-neutral-500 hidden sm:block">
              Prices and configuration options are maintained at variant level.
            </p>
            {variantCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEditVariantsModal(true)}
                className="gap-1.5 text-xs h-8"
              >
                <Layers className="h-3.5 w-3.5" />
                Edit Variants
              </Button>
            )}
          </div>
        </div>

        {variants.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="h-10 w-10 text-neutral-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-neutral-700">No variants assigned</h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
              This product currently has no sellable configurations.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/70 text-neutral-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Automation</th>
                  <th className="py-3 px-4">Finish</th>
                  <th className="py-3 px-4">Variant Code / SKU</th>
                  <th className="py-3 px-4 text-right">Price</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-700">
                {variants.map((v) => {
                  const autoTier = v.automationTier || (v.config as any)?.series || "standard";
                  const finish = v.surfaceFinish || (v.config as any)?.finish || "standard";
                  const vCode = v.variantCode || v.code || (v.config as any)?.variantCode || (v.config as any)?.code;

                  return (
                    <tr key={v.id} className="hover:bg-neutral-50/60 transition-colors">
                      {/* Automation Tier */}
                      <td className="py-3.5 px-4 font-medium">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/80 capitalize">
                          <Cpu className="h-3 w-3 text-blue-500" />
                          {autoTier}
                        </span>
                      </td>

                      {/* Surface Finish */}
                      <td className="py-3.5 px-4 font-medium">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-neutral-100 text-neutral-800 border border-neutral-200 capitalize">
                          <Layers className="h-3 w-3 text-neutral-500" />
                          {finish}
                        </span>
                      </td>

                      {/* Variant Code */}
                      <td className="py-3.5 px-4 font-mono font-medium text-neutral-900">
                        {vCode ? (
                          <span className="bg-neutral-100 px-2 py-0.5 rounded text-neutral-800 border border-neutral-200">
                            {vCode}
                          </span>
                        ) : (
                          <span className="text-neutral-400 italic">Not assigned</span>
                        )}
                      </td>

                      {/* Price */}
                      <td className="py-3.5 px-4 text-right font-semibold text-sm text-neutral-900">
                        {formatCurrency(v.price)}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
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

      {/* Edit Product Modal */}
      <Modal
        isOpen={showEditProductModal}
        onClose={() => setShowEditProductModal(false)}
        title="Edit Base Product"
        size="lg"
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

      {/* Edit Variants Modal */}
      <ProductVariantsEditModal
        isOpen={showEditVariantsModal}
        product={product}
        onClose={() => setShowEditVariantsModal(false)}
        onVariantsChange={(updatedVariants) => {
          // Update local product state so the variant count refreshes without
          // closing the Edit Variants modal.
          setProduct((prev) => (prev ? { ...prev, variants: updatedVariants } : null));
          // Do NOT call setShowEditVariantsModal(false) here — the modal
          // stays open so the user can see the updated list / continue editing.
        }}
      />

      {/* Delete Product confirmation is raised through the global
          ConfirmProvider portal — no nested dialog inside this page. */}
    </div>
  );
}
