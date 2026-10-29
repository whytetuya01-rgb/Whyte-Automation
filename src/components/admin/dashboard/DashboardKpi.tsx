import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardKpiProps {
  label: string;
  value: string;
  icon: LucideIcon;
  href: string;
  /** Short supporting description line */
  hint?: string;
  /** Real calculated delta or comparative trend */
  trend?: { text: string; direction: "up" | "down" | "flat" };
  /** Optional badge next to the label (e.g. "Real-Time") */
  badge?: string;
  className?: string;
}

/**
 * Premium Executive KPI card modeled after Linear & Stripe dashboard design.
 * Features micro-elevation, refined typography, and smooth hover interaction.
 */
export default function DashboardKpi({
  label,
  value,
  icon: Icon,
  href,
  hint,
  trend,
  badge,
  className,
}: DashboardKpiProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative bg-white rounded-2xl border border-[#E5E5E7] p-5 flex flex-col justify-between gap-3.5",
        "shadow-[0_1px_3px_0_rgba(0,0,0,0.02)] hover:border-neutral-300 hover:shadow-xs hover:-translate-y-0.5 transition-all duration-200 min-w-0 overflow-hidden",
        className
      )}
    >
      {/* Subtle top edge glow on hover */}
      <span
        className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-[var(--color-admin-primary,#D85B83)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        aria-hidden="true"
      />

      {/* Top Header: Label + Context Pill + Icon */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A8A93] truncate">
            {label}
          </span>
          {badge && (
            <span className="text-[10px] font-medium bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7] px-1.5 py-0.2 rounded-full shrink-0">
              {badge}
            </span>
          )}
        </div>

        <span className="w-8 h-8 rounded-xl bg-[#F6F6F7] border border-[#E5E5E7] text-[#5F5F68] group-hover:bg-[var(--color-admin-primary-subtle,#FFF6F8)] group-hover:text-[var(--color-admin-primary,#D85B83)] group-hover:border-[var(--color-admin-primary-border,#F1B8C8)] flex items-center justify-center shrink-0 transition-all duration-200 shadow-2xs">
          <Icon size={16} aria-hidden="true" />
        </span>
      </div>

      {/* Middle: Prominent Hero Value */}
      <div className="min-w-0">
        <p className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#111111] tabular-nums truncate leading-none">
          {value}
        </p>
      </div>

      {/* Bottom Footer: Trend Delta + Supporting Hint */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#F0F0F2] min-w-0 text-xs">
        {hint && (
          <span className="text-[11px] text-[#8A8A93] font-normal truncate">
            {hint}
          </span>
        )}

        {trend && (
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border tabular-nums",
              trend.direction === "up" && "bg-emerald-50 text-emerald-800 border-emerald-200",
              trend.direction === "down" && "bg-rose-50 text-rose-800 border-rose-200",
              trend.direction === "flat" && "bg-[#F6F6F7] text-[#5F5F68] border-[#E5E5E7]"
            )}
          >
            {trend.direction === "up" && <ArrowUpRight size={12} className="text-emerald-600" aria-hidden="true" />}
            {trend.direction === "down" && <ArrowDownRight size={12} className="text-rose-600" aria-hidden="true" />}
            {trend.direction === "flat" && <Minus size={11} className="text-[#8A8A93]" aria-hidden="true" />}
            <span>{trend.text}</span>
          </span>
        )}
      </div>
    </Link>
  );
}
