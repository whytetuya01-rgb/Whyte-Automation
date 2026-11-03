import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardKpiProps {
  label: string;
  value: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  /** Short supporting description line */
  hint?: string;
  /** Real calculated delta or comparative trend */
  trend?: { text: string; direction: "up" | "down" | "flat" };
  /** Optional badge next to the label (e.g. "Real-Time") */
  badge?: string;
  className?: string;
}

/**
 * Ultra-Premium Executive KPI card with micro-sheen animations,
 * ambient elevation, smooth hover lift, and tactile feedback.
 */
export default function DashboardKpi({
  label,
  value,
  icon: Icon,
  href,
  onClick,
  hint,
  trend,
  badge,
  className,
}: DashboardKpiProps) {
  const commonClasses = cn(
    "group relative bg-white rounded-2xl border border-[#E5E5E7] p-5 flex flex-col justify-between gap-3.5 text-left w-full",
    "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.03),0_1px_2px_0_rgba(0,0,0,0.02)]",
    "hover:border-neutral-300 hover:shadow-[0_16px_36px_-10px_rgba(0,0,0,0.09)] hover:-translate-y-1 transition-all duration-300",
    "min-w-0 overflow-hidden kpi-sheen-effect",
    (href || onClick) && "cursor-pointer",
    className
  );

  const innerContent = (
    <>
      {/* Top illuminated brand glow on hover */}
      <span
        className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-[var(--color-admin-primary,#D85B83)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        aria-hidden="true"
      />

      {/* Subtle ambient background blush */}
      <span
        className="absolute inset-0 bg-gradient-to-b from-[var(--color-admin-primary-subtle,#FFF6F8)]/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl"
        aria-hidden="true"
      />

      {/* Top Header: Label + Context Pill + Icon */}
      <div className="relative z-10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A8A93] truncate group-hover:text-[#5F5F68] transition-colors">
            {label}
          </span>
          {badge && (
            <span className="text-[10px] font-semibold bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7] px-2 py-0.5 rounded-full shrink-0 group-hover:border-[var(--color-admin-primary-border,#F1B8C8)] group-hover:text-[var(--color-admin-primary-foreground,#8A2B4D)] transition-all">
              {badge}
            </span>
          )}
        </div>

        <span className="w-9 h-9 rounded-xl bg-[#F6F6F7] border border-[#E5E5E7] text-[#5F5F68] group-hover:scale-110 group-hover:bg-[var(--color-admin-primary-subtle,#FFF6F8)] group-hover:text-[var(--color-admin-primary,#D85B83)] group-hover:border-[var(--color-admin-primary-border,#F1B8C8)] group-hover:shadow-xs flex items-center justify-center shrink-0 transition-all duration-300">
          <Icon size={16} aria-hidden="true" />
        </span>
      </div>

      {/* Middle: Prominent Hero Value */}
      <div className="relative z-10 min-w-0">
        <p className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111111] tabular-nums truncate leading-none transition-transform duration-200 group-hover:translate-x-0.5">
          {value}
        </p>
      </div>

      {/* Bottom Footer: Trend Delta + Supporting Hint */}
      <div className="relative z-10 flex items-center justify-between gap-2 pt-2 border-t border-[#F0F0F2] min-w-0 text-xs">
        {hint && (
          <span className="text-[11px] text-[#8A8A93] font-normal truncate group-hover:text-[#5F5F68] transition-colors">
            {hint}
          </span>
        )}

        {trend && (
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border tabular-nums transition-transform duration-200 group-hover:scale-105 shadow-2xs",
              trend.direction === "up" && "bg-emerald-50 text-emerald-800 border-emerald-200",
              trend.direction === "down" && "bg-rose-50 text-rose-800 border-rose-200",
              trend.direction === "flat" && "bg-[#F6F6F7] text-[#5F5F68] border-[#E5E5E7]"
            )}
          >
            {trend.direction === "up" && <ArrowUpRight size={12} className="text-emerald-600 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />}
            {trend.direction === "down" && <ArrowDownRight size={12} className="text-rose-600 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" aria-hidden="true" />}
            {trend.direction === "flat" && <Minus size={11} className="text-[#8A8A93]" aria-hidden="true" />}
            <span>{trend.text}</span>
          </span>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={commonClasses}>
        {innerContent}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={commonClasses}>
        {innerContent}
      </button>
    );
  }

  return <div className={commonClasses}>{innerContent}</div>;
}
