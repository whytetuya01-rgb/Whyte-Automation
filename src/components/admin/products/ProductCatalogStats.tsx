import { cn } from "@/lib/utils";
import { Cpu, Layers, Package, CheckCircle2, type LucideIcon } from "lucide-react";
import { STAT_TONE_CLASSES, type CatalogStatCard, type CatalogStatTone } from "./catalogPresentation";

const STAT_ICONS: Record<CatalogStatTone, LucideIcon> = {
  neutral: Package,
  success: CheckCircle2,
  accent: Layers,
  info: Cpu,
};

/**
 * Catalog summary strip. Deliberately compact: a small uppercase label, one
 * large number and a 28px tinted icon, so it reads as a row of metrics instead
 * of four competing panels. Each metric keeps a single semantic accent.
 */
export default function ProductCatalogStats({ items }: { items: CatalogStatCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = STAT_ICONS[item.tone];
        const tone = STAT_TONE_CLASSES[item.tone];

        return (
          <div
            key={item.id}
            className="group flex items-center gap-3 rounded-xl border border-neutral-200/80 bg-white px-3.5 py-2.5 shadow-2xs transition-[border-color,box-shadow] duration-200 hover:border-neutral-300 hover:shadow-sm"
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-black/[0.03]",
                tone.icon
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>

            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
                {item.label}
              </p>
              <p className={cn("mt-0.5 text-[22px] font-semibold leading-none tabular-nums", tone.value)}>
                {item.value}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}