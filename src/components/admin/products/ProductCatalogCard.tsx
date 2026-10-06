import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronRight, Package, ArrowRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import {
  getProductMetaPairs,
  getVariantRows,
  type MetaPair,
} from "./catalogPresentation";
import ProductRowActions from "./ProductRowActions";
import ProductVariantPanel from "./ProductVariantPanel";

interface ProductCatalogCardProps {
  product: Product;
  isExpanded: boolean;
  onToggleExpand: (productId: number) => void;
  onEdit: (product: Product) => void;
  onEditVariants: (product: Product) => void;
  onDelete: (product: Product) => void;
  onToggleStatus: (product: Product) => void;
}

export default function ProductCatalogCard({
  product,
  isExpanded,
  onToggleExpand,
  onEdit,
  onEditVariants,
  onDelete,
  onToggleStatus,
}: ProductCatalogCardProps) {
  const router = useRouter();

  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageFailed = failedImageUrl === product.imageUrl;

  const metaPairs = getProductMetaPairs(product);
  const variants = product.variants ?? [];
  const variantRows = getVariantRows(variants);
  const variantCount = variants.length;
  const showImage = Boolean(product.imageUrl) && !imageFailed;

  // Determine row price display
  const firstVariantPrice = variants.length > 0 && variants[0].price ? Number(variants[0].price) : null;
  const productPrice = Number.isFinite(firstVariantPrice)
    ? formatCurrency(firstVariantPrice!)
    : Number.isFinite(Number(product.price))
    ? formatCurrency(product.price!)
    : null;

  const toggleLabel = isExpanded ? "Collapse variants" : "Expand variants";

  return (
    <article
      data-expanded={isExpanded}
      className={cn(
        "group overflow-hidden rounded-2xl border bg-white shadow-2xs transition-all duration-200",
        isExpanded
          ? "border-neutral-300 shadow-md ring-1 ring-neutral-900/5"
          : "border-neutral-200/90 hover:border-neutral-300 hover:shadow-xs"
      )}
    >
      {/* Product Row Area */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 p-3.5 sm:px-4 sm:py-3.5 transition-colors duration-200">
        {/* Expand / collapse control */}
        <button
          type="button"
          onClick={() => onToggleExpand(product.id)}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={isExpanded}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-150 cursor-pointer",
            isExpanded
              ? "bg-neutral-900 text-white shadow-2xs"
              : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          )}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        {/* Product image */}
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-white p-1 shadow-2xs sm:h-[60px] sm:w-[60px]">
          {showImage ? (
            <img
              src={product.imageUrl as string}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-contain"
              onError={() => setFailedImageUrl(product.imageUrl ?? null)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-lg bg-neutral-50 text-neutral-300">
              <Package className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">No image available for {product.name}</span>
            </div>
          )}
        </div>

        {/* Identity block */}
        <div className="min-w-[220px] flex-1 space-y-0.5">
          <Link
            href={`/admin/products/${product.id}`}
            title={product.name}
            className="group/title inline-flex items-center gap-1.5 text-[15px] font-medium leading-tight text-pink-600 hover:text-pink-700 max-w-full"
          >
            <span className="truncate hover:underline">{product.name}</span>
            <ArrowRight className="h-3.5 w-3.5 text-pink-600 opacity-0 -translate-x-1 transition-all duration-200 group-hover/title:opacity-100 group-hover/title:translate-x-0 shrink-0" />
          </Link>

          {/* Labeled Metadata Line */}
          {metaPairs.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {metaPairs.map((pair: MetaPair, idx: number) => (
                <span key={pair.label} className="inline-flex items-center gap-1">
                  {idx > 0 && <span className="text-neutral-300 font-normal mr-1">·</span>}
                  <span className="text-neutral-400 font-normal">{pair.label}:</span>
                  <span className={cn("text-neutral-700 font-normal", pair.mono && "font-mono text-neutral-800")}>
                    {pair.value}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right rail: Variant count, Status, Price & Actions */}
        <div className="ml-auto flex flex-wrap items-center gap-3.5 shrink-0 pt-2 border-t border-neutral-100 sm:border-0 sm:pt-0">
          {/* Variant count chip */}
          <button
            type="button"
            onClick={() => onToggleExpand(product.id)}
            aria-expanded={isExpanded}
            title={toggleLabel}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold font-mono transition-colors duration-150 cursor-pointer",
              isExpanded
                ? "bg-neutral-900 text-white shadow-2xs"
                : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
            )}
          >
            {variantCount} {variantCount === 1 ? "Variant" : "Variants"}
          </button>

          {/* Status */}
          <button
            type="button"
            onClick={() => onToggleStatus(product)}
            title="Toggle product status"
            aria-label={`${product.name} is ${product.isActive ? "active" : "inactive"}.`}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors duration-150 cursor-pointer",
              product.isActive
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                : "bg-neutral-100 text-neutral-500 border border-neutral-200/60"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                product.isActive ? "bg-emerald-500" : "bg-neutral-400"
              )}
              aria-hidden="true"
            />
            {product.isActive ? "Active" : "Inactive"}
          </button>

          {/* Price */}
          {productPrice && (
            <span className="text-sm font-bold text-neutral-900 font-mono tabular-nums">
              {productPrice}
            </span>
          )}

          {/* Actions */}
          <ProductRowActions
            productId={product.id}
            productName={product.name}
            isExpanded={isExpanded}
            onView={() => router.push(`/admin/products/${product.id}`)}
            onEdit={() => onEdit(product)}
            onEditVariants={() => onEditVariants(product)}
            onDelete={() => onDelete(product)}
          />
        </div>
      </div>

      {/* Expanded Variant Section */}
      {isExpanded && (
        <ProductVariantPanel rows={variantRows} total={variantCount} />
      )}
    </article>
  );
}