import Image from "next/image";
import Link from "next/link";
import { Package, Plus } from "lucide-react";
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
      className="rounded-lg border border-[#E5E5E7] bg-white object-contain p-0.5 shrink-0"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="rounded-lg border border-[#E5E5E7] bg-[#F6F6F7] text-[#8A8A93] inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <Package size={size * 0.45} aria-hidden="true" />
    </span>
  );
}

function ActiveDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${active ? "text-emerald-700" : "text-[#8A8A93]"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-[#C9C9D0]"}`} aria-hidden="true" />
      {active ? "Active" : "Inactive"}
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
      <div className="py-10 text-center">
        <p className="text-sm font-medium text-[#111111]">No products added yet</p>
        <p className="text-xs text-[#8A8A93] mt-0.5">Add your first hardware item to start populating the catalog.</p>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#111111] text-white hover:bg-[#1E1E22] transition-colors"
        >
          <Plus size={13} aria-hidden="true" />
          Add Product
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[11px] font-medium text-[#8A8A93] border-y border-[#F0F0F2]">
              <th scope="col" className="pl-5 pr-3 py-2 font-medium">Product</th>
              <th scope="col" className="px-3 py-2 font-medium">Configuration</th>
              <th scope="col" className="px-3 py-2 font-medium">Type</th>
              <th scope="col" className="px-3 py-2 font-medium text-right">Price</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="pr-5 pl-3 py-2 font-medium text-right">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F0F2] text-sm">
            {products.map((product) => (
              <tr key={product.id} className="hover:bg-[#FFF6F8]/70 transition-colors">
                <td className="pl-5 pr-3 py-2.5 max-w-[260px]">
                  <Link href={`/admin/products/${product.id}`} className="flex items-center gap-3 min-w-0 group">
                    <Thumb product={product} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[#111111] group-hover:text-[#B83E68] transition-colors">{product.name}</span>
                      {product.code && <span className="block font-mono text-[11px] text-[#8A8A93]">{product.code}</span>}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 max-w-[240px]">
                  <ProductCategoryConfigCell product={product} categories={categories} />
                </td>
                <td className="px-3 py-2.5 text-xs text-[#5F5F68] whitespace-nowrap">{TYPE_LABELS[product.type] ?? product.type}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[#111111] whitespace-nowrap">
                  {product.isMatrix && product.variants && product.variants.length > 1 && <span className="text-[10px] text-[#8A8A93] font-sans mr-1">From</span>}
                  {formatCurrency(displayPrice(product))}
                </td>
                <td className="px-3 py-2.5"><ActiveDot active={product.isActive} /></td>
                <td className="pr-5 pl-3 py-2.5 text-right text-xs text-[#8A8A93] whitespace-nowrap">{formatDate(addedAtById[product.id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden divide-y divide-[#F0F0F2] border-t border-[#F0F0F2]">
        {products.map((product) => (
          <li key={product.id}>
            <Link href={`/admin/products/${product.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#FFF6F8]/70 transition-colors">
              <Thumb product={product} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#111111] truncate">{product.name}</p>
                <p className="text-[11px] text-[#8A8A93] truncate">
                  {[product.code, TYPE_LABELS[product.type] ?? product.type].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                <p className="font-mono text-xs tabular-nums text-[#111111]">{formatCurrency(displayPrice(product))}</p>
                <ActiveDot active={product.isActive} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
