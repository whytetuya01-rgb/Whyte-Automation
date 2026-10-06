import { cn } from "@/lib/utils";
import type { VariantRow } from "./catalogPresentation";

interface ProductVariantPanelProps {
  rows: VariantRow[];
  total: number;
}

export default function ProductVariantPanel({ rows }: ProductVariantPanelProps) {
  return (
    <div className="border-t border-neutral-200/80 bg-neutral-50/70 p-4 space-y-3">
      {/* Expanded header - clean and un-duplicated */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          Variants & Configurations
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-2 text-xs italic text-neutral-400">
          No variants configured for this product.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200/80 bg-white">
          <table className="w-full min-w-[500px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-200/80 bg-neutral-50/80 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                <th scope="col" className="w-10 px-3 py-2 text-center">
                  #
                </th>
                <th scope="col" className="px-3 py-2">
                  Variant
                </th>
                <th scope="col" className="px-3 py-2">
                  Tier &amp; Finish
                </th>
                <th scope="col" className="px-3 py-2">
                  SKU
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Price
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-100">
              {rows.map((row) => (
                <tr key={row.variant.id} className="hover:bg-neutral-50/50 transition-colors">
                  <td className="px-3 py-2 text-center font-mono text-[11px] text-neutral-400">
                    {row.index + 1}
                  </td>

                  <td className="px-3 py-2 font-semibold text-neutral-900">
                    {row.displayName}
                  </td>

                  <td className="px-3 py-2">
                    {!row.hasAnyDimension ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {row.tierLabel && (
                          <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                            {row.tierLabel}
                          </span>
                        )}
                        {row.finishLabel && (
                          <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                            {row.finishLabel}
                          </span>
                        )}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {row.code ? (
                      <span className="font-mono text-[11px] text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded-md border border-neutral-200/60">
                        {row.code}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right font-mono font-bold text-neutral-900">
                    {row.priceText}
                  </td>

                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold",
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