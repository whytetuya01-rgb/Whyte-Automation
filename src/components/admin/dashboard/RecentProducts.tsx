import Image from "next/image";
import Link from "next/link";
import { Package, Plus, ArrowUpRight } from "lucide-react";
import ProductCategoryConfigCell from "@/components/admin/ProductCategoryConfigCell";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Category, Product } from "@/types";
import { TYPE_LABELS } from "./CatalogSnapshot";

function displayPrice(product: Product): number {
  const active = product.variants?.filter((v) => v.isActive) ?? [];
  const prices = active.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length > 0) return Math.min(...prices);
  if (product.variants && product.variants.length > 0 && product.variants[0].price) return Number(product.variants[0].price);
  return Number(product.price || 0);
}

function Thumb({ product, size }: { product: Product; size: number }) {
  return product.imageUrl ? (
    <Image
      src={product.imageUrl}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="rounded-lg border border-[#E5E5E7] bg-white object-contain p-0.5 shrink-0 shadow-2xs"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="rounded-lg border border-[#E5E5E7] bg-[#F6F6F7] text-[#8A8A93] inline-flex items-center justify-center shrink-0 shadow-2xs"
      style={{ width: size, height: size }}
    >
      <Package size={size * 0.45} aria-hidden="true" />
    </span>
  );
}

function ActiveDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-medium border ${
        active
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-[#F6F6F7] text-[#8A8A93] border-[#E5E5E7]"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-[#C9C9D0]"}`}
        aria-hidden="true"
      />
      {active ? "Active" : "Archived"}
    </span>
  );
}

interface RecentProductsProps {
  products: Product[];
  categories: Category[];
  /** ISO creation date per product id. */
  addedAtById: Record<number, string>;
}

export default function RecentProducts({ products, categories, addedAtById }: RecentProductsProps) {
  if (products.length === 0) {
    return (
      <div className="py-12 text-center">
        <span className="w-10 h-10 rounded-xl bg-[#F6F6F7] text-[#8A8A93] inline-flex items-center justify-center mb-2.5 border border-[#E5E5E7]">
          <Package size={18} aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold text-[#111111]">No products cataloged yet</p>
        <p className="text-xs text-[#8A8A93] mt-1 max-w-xs mx-auto">
          Add smart automation switches, dimmers, sensors, and controllers to start quoting.
        </p>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1.5 mt-4 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#111111] text-white hover:bg-[#1E1E22] transition-colors shadow-2xs"
        >
          <Plus size={13} aria-hidden="true" />
          Add First Product
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] font-semibold text-[#8A8A93] tracking-wider uppercase border-y border-[#F0F0F2] bg-[#FAFAFA]/75">
              <th scope="col" className="pl-5 pr-3 py-2.5 font-semibold">Hardware Item</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Classification / Series</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Type</th>
              <th scope="col" className="px-3 py-2.5 font-semibold text-right">Base Price (INR)</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
              <th scope="col" className="pr-5 pl-3 py-2.5 font-semibold text-right">Added On</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F0F2] text-xs">
            {products.map((product) => (
              <tr
                key={product.id}
                className="group hover:bg-[#F6F6F7]/70 transition-colors"
              >
                <td className="pl-5 pr-3 py-3 max-w-[280px]">
                  <Link href={`/admin/products/${product.id}`} className="flex items-center gap-3 min-w-0 group">
                    <Thumb product={product} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[#111111] group-hover:text-[var(--color-admin-primary-foreground,#B83E68)] transition-colors">
                        {product.name}
                      </span>
                      {product.code && (
                        <span className="block font-mono text-[10.5px] text-[#8A8A93]">{product.code}</span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3 max-w-[240px]">
                  <ProductCategoryConfigCell product={product} categories={categories} />
                </td>
                <td className="px-3 py-3 text-xs text-[#5F5F68] whitespace-nowrap">
                  <span className="inline-block px-2 py-0.5 rounded bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7] text-[10.5px] font-medium">
                    {TYPE_LABELS[product.type] ?? product.type}
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums font-semibold text-[#111111] whitespace-nowrap">
                  {product.isMatrix && product.variants && product.variants.length > 1 && (
                    <span className="text-[10px] text-[#8A8A93] font-sans mr-1">from</span>
                  )}
                  {formatCurrency(displayPrice(product))}
                </td>
                <td className="px-3 py-3">
                  <ActiveDot active={product.isActive} />
                </td>
                <td className="pr-5 pl-3 py-3 text-right text-xs text-[#8A8A93] whitespace-nowrap">
                  {formatDate(addedAtById[product.id])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List */}
      <ul className="md:hidden divide-y divide-[#F0F0F2] border-t border-[#F0F0F2]">
        {products.map((product) => (
          <li key={product.id}>
            <Link
              href={`/admin/products/${product.id}`}
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-[#F6F6F7]/80 transition-colors"
            >
              <Thumb product={product} size={42} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[#111111] truncate">{product.name}</p>
                <p className="text-[11px] text-[#8A8A93] truncate mt-0.5">
                  {[product.code, TYPE_LABELS[product.type] ?? product.type].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="text-right shrink-0 space-y-1">
                <p className="font-mono text-xs font-semibold tabular-nums text-[#111111]">
                  {formatCurrency(displayPrice(product))}
                </p>
                <ActiveDot active={product.isActive} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
