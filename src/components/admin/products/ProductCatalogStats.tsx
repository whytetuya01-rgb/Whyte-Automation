import { Cpu, Layers, Package, CheckCircle2, type LucideIcon } from "lucide-react";
import { type CatalogStatCard, type CatalogStatTone } from "./catalogPresentation";

const STAT_ICONS: Record<CatalogStatTone, LucideIcon> = {
  neutral: Package,
  success: CheckCircle2,
  accent: Layers,
  info: Cpu,
};

export default function ProductCatalogStats({ items }: { items: CatalogStatCard[] }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200/80 p-3.5 sm:px-6 shadow-2xs">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
        {items.map((item) => {
          const Icon = STAT_ICONS[item.tone];

          return (
            <div key={item.id} className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-neutral-100 border border-neutral-200/60 flex items-center justify-center shrink-0 text-neutral-600">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-[20px] font-semibold text-neutral-900 leading-tight tabular-nums font-mono">
                  {item.value.toLocaleString()}
                </div>
                <div className="text-xs font-normal text-neutral-500 truncate">
                  {item.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}