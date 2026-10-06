import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronRight, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import {
  getProductMetaPairs,
  getProductTypeMeta,
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

/**
 * A single catalog item.
 *
 * The product is the primary visual unit: image, name and metadata form one
 * reading block on the left, and type / variants / status / actions sit on a
 * right-hand rail. The nested variant panel attaches directly underneath with
 * no gap, so a product and its configurations read as one object.
 */
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

  // A URL that fails to load should fall back to the same icon as a product with
  // no image at all, rather than leaving an empty frame. Tracking the failing URL
  // instead of a boolean means editing the image clears the state automatically.
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageFailed = failedImageUrl === product.imageUrl;

  const typeMeta = getProductTypeMeta(product.type);
  const metaPairs = getProductMetaPairs(product);
  const variants = product.variants ?? [];
  const variantRows = getVariantRows(variants);
  const variantCount = variants.length;
  const showImage = Boolean(product.imageUrl) && !imageFailed;

  const toggleLabel = isExpanded ? "Collapse variants" : "Expand variants";

  return (
    <article
      data-expanded={isExpanded}
      className={cn(
        "group overflow-hidden rounded-xl border bg-white shadow-2xs transition-[border-color,box-shadow] duration-200",
        isExpanded
          ? "border-neutral-300 shadow-sm"
          : "border-neutral-200/80 hover:border-neutral-300 hover:shadow-sm"
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2.5 px-3 py-3 transition-colors duration-200 sm:px-4">
        {/* Expand / collapse */}
        <button
          type="button"
          onClick={() => onToggleExpand(product.id)}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-expanded={isExpanded}
          className={cn(
            "mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
            isExpanded
              ? "bg-neutral-100 text-admin-primary-foreground"
              : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          )}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        {/* Product image — the visual anchor, 68px square on desktop */}
        <div className="relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1.5 shadow-2xs ring-1 ring-inset ring-black/[0.02] sm:h-[68px] sm:w-[68px]">
          {showImage ? (
            <img
              src={product.imageUrl as string}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-contain"
              onError={() => setFailedImageUrl(product.imageUrl ?? null)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-lg bg-neutral-50">
              <Package className="h-5 w-5 text-neutral-300" aria-hidden="true" />
              <span className="sr-only">No image available for {product.name}</span>
            </div>
          )}
        </div>

        {/* Identity block */}
        <div className="min-w-[220px] flex-1">
          <Link
            href={`/admin/products/${product.id}`}
            onClick={(event) => event.stopPropagation()}
            title={product.name}
            className="block truncate text-[15px] font-semibold leading-tight text-admin-primary-foreground transition-colors duration-150 hover:text-admin-primary-hover hover:underline hover:decoration-admin-primary-border hover:decoration-2 hover:underline-offset-[3px]"
          >
            {product.name}
          </Link>

          {metaPairs.length > 0 && (
            <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {metaPairs.map((pair: MetaPair) => (
                <div key={pair.label} className="flex min-w-0 items-baseline gap-1.5">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-neutral-400">
                    {pair.label}
                  </dt>
                  <dd
                    className={cn(
                      "max-w-[220px] truncate text-xs text-neutral-600",
                      pair.mono && "font-mono text-[11px]"
                    )}
                    title={pair.value}
                  >
                    {pair.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Right rail — wraps to its own full-width line on narrow screens. */}
        <div className="ml-auto flex w-full items-center justify-between gap-2 border-t border-neutral-100 pt-2.5 sm:w-auto sm:border-0 sm:pt-0">
          {/* Type */}
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
              typeMeta.badgeClass
            )}
          >
            {typeMeta.label}
          </span>

          {/* Variant count chip */}
          <button
            type="button"
            onClick={() => onToggleExpand(product.id)}
            aria-expanded={isExpanded}
            title={toggleLabel}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium tabular-nums transition-colors duration-150",
              isExpanded
                ? "bg-neutral-100 text-neutral-800 ring-1 ring-inset ring-neutral-300"
                : "bg-neutral-100/70 text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-100 hover:text-neutral-800"
            )}
          >
            {variantCount} {variantCount === 1 ? "variant" : "variants"}
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            )}
          </button>

          {/* Status */}
          <button
            type="button"
            onClick={() => onToggleStatus(product)}
            title="Toggle product status"
            aria-label={`${product.name} is ${product.isActive ? "active" : "inactive"}. Activate to change.`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-150",
              product.isActive
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
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

          {/* Actions */}
          <div className="shrink-0">
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
      </div>

      {isExpanded && (
        <ProductVariantPanel rows={variantRows} total={variantCount} />
      )}
    </article>
  );
}