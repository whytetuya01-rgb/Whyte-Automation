import { Cpu, Layers, Package, CheckCircle2, type LucideIcon } from "lucide-react";
import { StatGrid, StatTile, type StatTone } from "@/components/admin/StatTiles";
import { type CatalogStatCard, type CatalogStatTone } from "./catalogPresentation";

const STAT_ICONS: Record<CatalogStatTone, LucideIcon> = {
  neutral: Package,
  success: CheckCircle2,
  accent: Layers,
  info: Cpu,
};

const STAT_TONES: Record<CatalogStatTone, StatTone> = {
  neutral: "neutral",
  success: "emerald",
  accent: "accent",
  info: "violet",
};

export default function ProductCatalogStats({ items }: { items: CatalogStatCard[] }) {
  return (
    <StatGrid columns={4}>
      {items.map((item) => (
        <StatTile key={item.id} label={item.label} value={item.value.toLocaleString()} icon={STAT_ICONS[item.tone]} tone={STAT_TONES[item.tone]} />
      ))}
    </StatGrid>
  );
}
