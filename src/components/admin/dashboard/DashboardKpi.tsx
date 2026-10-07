import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardKpiProps {
  label: string;
  value: string;
  icon: LucideIcon;
  href: string;
  /** Short supporting line. */
  hint?: string;
  /** Only pass a trend when it is computed from real data. */
  trend?: { text: string; direction: "up" | "down" | "flat" };
}

/** Compact KPI: small icon, muted label, controlled number, optional real trend. */
export default function DashboardKpi({ label, value, icon: Icon, href, hint, trend }: DashboardKpiProps) {
  return (
    <Link
      href={href}
      className="group bg-white rounded-2xl border border-[#E5E5E7] p-4 sm:p-5 flex flex-col gap-3 hover:border-[#F1B8C8] transition-colors min-w-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#8A8A93] truncate">{label}</span>
        <span className="w-7 h-7 rounded-lg bg-[#FFF6F8] text-[#D85B83] flex items-center justify-center shrink-0">
          <Icon size={15} aria-hidden="true" />
        </span>
      </div>

      <div className="flex items-end justify-between gap-2 min-w-0">
        <p className="text-2xl font-semibold text-[#111111] tracking-tight tabular-nums truncate">{value}</p>
        {trend && (
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md",
              trend.direction === "up" && "bg-emerald-50 text-emerald-700",
              trend.direction === "down" && "bg-red-50 text-red-700",
              trend.direction === "flat" && "bg-[#F6F6F7] text-[#5F5F68]"
            )}
          >
            {trend.direction === "up" && <ArrowUpRight size={12} aria-hidden="true" />}
            {trend.direction === "down" && <ArrowDownRight size={12} aria-hidden="true" />}
            {trend.text}
          </span>
        )}
      </div>

      {hint && <p className="text-[11px] text-[#8A8A93] -mt-1 truncate">{hint}</p>}
    </Link>
  );
}
