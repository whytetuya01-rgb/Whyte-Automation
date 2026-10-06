import { Package, SearchX } from "lucide-react";
import type { Product } from "@/types";
import ProductCatalogCard from "./ProductCatalogCard";

interface ProductCatalogListProps {
  products: Product[];
  expandedProductIds: Set<number>;
  onToggleExpand: (productId: number) => void;
  onEdit: (product: Product) => void;
  onEditVariants: (product: Product) => void;
  onDelete: (product: Product) => void;
  onToggleStatus: (product: Product) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

/**
 * Stacks catalog items with a controlled 12px rhythm. There is no wrapper table:
 * each product is its own surface, which is what keeps the list from reading as
 * one large HTML grid.
 */
export default function ProductCatalogList({
  products,
  expandedProductIds,
  onToggleExpand,
  onEdit,
  onEditVariants,
  onDelete,
  onToggleStatus,
  onClearFilters,
  hasActiveFilters,
}: ProductCatalogListProps) {
  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 bg-white py-14 text-center">
        {hasActiveFilters ? (
          <>
            <SearchX className="mx-auto h-8 w-8 text-neutral-300" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-neutral-800">No products match these filters</h3>
            <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-400">
              Try a different search term, or widen the category, type and status filters.
            </p>
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-3 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors duration-150 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900"
            >
              Clear filters
            </button>
          </>
        ) : (
          <>
            <Package className="mx-auto h-8 w-8 text-neutral-300" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-neutral-800">No products yet</h3>
            <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-400">
              Add your first product to start building the catalog.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {products.map((product) => (
        <ProductCatalogCard
          key={product.id}
          product={product}
          isExpanded={expandedProductIds.has(product.id)}
          onToggleExpand={onToggleExpand}
          onEdit={onEdit}
          onEditVariants={onEditVariants}
          onDelete={onDelete}
          onToggleStatus={onToggleStatus}
        />
      ))}
    </div>
  );
}