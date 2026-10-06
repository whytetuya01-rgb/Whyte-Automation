import { cn } from "@/lib/utils";
import type { VariantRow } from "./catalogPresentation";

interface ProductVariantPanelProps {
  rows: VariantRow[];
  total: number;
}

/**
 * Nested variant section.
 *
 * Reads as a lighter continuation of the product card rather than a second
 * table: no header bar, no heavy rules, no coloured spine. The panel inherits
 * the card's border and radius so it stays visually attached, and it scrolls
 * horizontally on its own so the page never does.
 */
export default function ProductVariantPanel({ rows, total }: ProductVariantPanelProps) {
  const activeCount = rows.filter((row) => row.isActive).length;

  return (
    <div className="border-t border-neutral-100 bg-neutral-50/50">
      {/* Compact header — one 44px line, light surface, no black bar */}
      <div className="flex h-11 items-center justify-between gap-3 px-3.5 sm:px-4">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-xs font-semibold text-neutral-700">Variants</span>
          <span className="text-xs text-neutral-300">·</span>
          <span className="text-xs font-medium tabular-nums text-neutral-500">{total}</span>
        </div>

        {total > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            {activeCount} active
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-3.5 pb-4 text-xs italic text-neutral-400 sm:px-4">
          No variants assigned to this product.
        </p>
      ) : (
        /* Local scroll only — the catalog page itself never scrolls sideways. */
        <div className="overflow-x-auto pb-3">
          <table className="catalog-variants w-full min-w-[560px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-y border-neutral-200/80 bg-neutral-50">
                <th scope="col" className="w-10 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-400">
                  #
                </th>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-500">
                  Variant
                </th>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-500">
                  Tier &amp; Finish
                </th>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-500">
                  Code / SKU
                </th>
                <th scope="col" className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-500">
                  Price
                </th>
                <th scope="col" className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-500">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-100">
              {rows.map((row) => (
                <tr key={row.variant.id} className="bg-white transition-colors duration-150">
                  <td className="px-3 py-2 text-center font-mono text-[11px] tabular-nums text-neutral-400">
                    {row.index + 1}
                  </td>

                  <td className="px-3 py-2">
                    <span className="font-medium text-neutral-800">{row.displayName}</span>
                  </td>

                  <td className="px-3 py-2">
                    {!row.hasAnyDimension ? (
                      /* Flat product — an explicit muted note, never empty badges. */
                      <span className="text-[11px] italic text-neutral-400">Not applicable</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1">
                        {row.tierLabel ? (
                          <span className="inline-flex items-center rounded-md bg-admin-primary-subtle px-1.5 py-px text-[11px] font-medium text-admin-primary-foreground ring-1 ring-inset ring-admin-primary-border/70">
                            {row.tierLabel}
                          </span>
                        ) : (
                          <span className="text-[11px] italic text-neutral-400">No tier</span>
                        )}
                        {row.finishLabel ? (
                          <span className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-px text-[11px] font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200">
                            {row.finishLabel}
                          </span>
                        ) : (
                          <span className="text-[11px] italic text-neutral-400">No finish</span>
                        )}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {row.code ? (
                      <span className="inline-block rounded-md bg-neutral-50 px-1.5 py-px font-mono text-[11px] text-neutral-600 ring-1 ring-inset ring-neutral-200/80">
                        {row.code}
                      </span>
                    ) : (
                      <span className="text-[11px] italic text-neutral-400">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-neutral-900">
                    {row.priceText}
                  </td>

                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                        row.isActive ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          row.isActive ? "bg-emerald-500" : "bg-neutral-400"
                        )}
                        aria-hidden="true"
                      />
                      {row.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}