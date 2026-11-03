"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/admin/sidebar/motionTokens";
import { CountUp, riseVariants } from "./motion";
import { Sparkline } from "./charts";

export interface Trend {
  text: string;
  direction: "up" | "down" | "flat";
}

/** The up / down / flat change pill used on KPI cards and the hero. */
export function TrendPill({ trend, onDark }: { trend: Trend; onDark?: boolean }) {
  const Icon = trend.direction === "up" ? ArrowUpRight : trend.direction === "down" ? ArrowDownRight : Minus;
  const tone =
    trend.direction === "up"
      ? onDark
        ? "bg-emerald-400/15 text-emerald-300 border-emerald-400/25"
        : "bg-emerald-50 text-emerald-700 border-emerald-200"
      : trend.direction === "down"
      ? onDark
        ? "bg-rose-400/15 text-rose-300 border-rose-400/25"
        : "bg-rose-50 text-rose-700 border-rose-200"
      : onDark
      ? "bg-white/10 text-white/70 border-white/15"
      : "bg-neutral-100 text-neutral-600 border-neutral-200";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tabular-nums", tone)}>
      <Icon size={11} aria-hidden="true" />
      {trend.text}
    </span>
  );
}

interface PremiumKpiProps {
  label: string;
  /** A number animates up to it (formatted by `format`); a string is shown as it is. */
  value: number | string;
  format?: (n: number) => string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  hint?: string;
  trend?: Trend;
  badge?: string;
  /** Recent values for the sparkline along the bottom. */
  series?: number[];
  href?: string;
  onClick?: () => void;
  /** Accent colour of the icon chip and sparkline (a CSS colour). */
  accent?: string;
  /** Extra classes for the card's grid cell (for example a column span). */
  className?: string;
}

/** A KPI card: gradient icon chip, counting number, change pill, sparkline; lifts on hover and is a link or a button when it goes somewhere. */
export function PremiumKpi({ label, value, format, icon: Icon, hint, trend, badge, series, href, onClick, accent = "var(--color-admin-primary,#D85B83)", className }: PremiumKpiProps) {
  const body = (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(16,16,20,0.04)] transition-shadow duration-300 group-hover:shadow-[0_12px_32px_-12px_rgba(16,16,20,0.18)]">
      <div
        className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full opacity-[0.08] blur-2xl transition-opacity duration-300 group-hover:opacity-20"
        style={{ background: accent }}
        aria-hidden="true"
      />
      <div className="relative flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ring-1 ring-black/5"
          style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 55%, #111114))` }}
        >
          <Icon size={15} strokeWidth={2} />
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-500" title={badge ? `${label} · ${badge}` : label}>{label}</p>
      </div>
      <div className="relative mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="truncate text-2xl font-semibold tracking-tight text-neutral-950">
          {typeof value === "number" ? <CountUp value={value} format={format} /> : value}
        </p>
        {trend && <TrendPill trend={trend} />}
      </div>
      {hint && <p className="relative mt-0.5 line-clamp-2 text-xs leading-snug text-neutral-500">{hint}</p>}
      {series && series.length > 1 && (
        <div className="relative -mx-1 mt-auto pt-2">
          <Sparkline values={series} color={accent} height={26} />
        </div>
      )}
      {(href || onClick) && (
        <ArrowRight size={14} className="absolute bottom-4 right-4 text-neutral-300 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-neutral-500 group-hover:opacity-100" aria-hidden="true" />
      )}
    </div>
  );

  const wrapper = (children: React.ReactNode) => (
    <motion.div variants={riseVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} transition={{ duration: 0.2, ease: EASE }} className={cn("group h-full", className)} data-testid="premium-kpi">
      {children}
    </motion.div>
  );

  if (href) {
    return wrapper(
      <Link href={href} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-admin-primary,#D85B83)]">
        {body}
      </Link>
    );
  }
  if (onClick) {
    return wrapper(
      <button type="button" onClick={onClick} className="block h-full w-full rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-admin-primary,#D85B83)]">
        {body}
      </button>
    );
  }
  return wrapper(body);
}

/** A dashboard section: title, one-line description, optional link, and a body that rises in with its siblings. */
export function PremiumPanel({
  title,
  description,
  action,
  flush,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section variants={riseVariants} className={cn("flex min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(16,16,20,0.04)]", className)} data-testid="premium-panel">
      <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-neutral-950">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-snug text-neutral-500">{description}</p>}
        </div>
        {action && (
          <Link href={action.href} className="group inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-admin-primary-foreground,#B83E68)] transition hover:bg-[var(--color-admin-primary-soft,#FCEAF0)]">
            {action.label}
            <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        )}
      </header>
      <div className={cn("min-w-0 flex-1", flush ? "pt-3" : "px-4 pb-4 pt-4 sm:px-5 sm:pb-5")}>{children}</div>
    </motion.section>
  );
}

/** A friendly empty state inside a panel. */
export function EmptyHint({ icon: Icon, title, text }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-400">
        <Icon size={18} />
      </span>
      <p className="text-sm font-semibold text-neutral-800">{title}</p>
      {text && <p className="max-w-xs text-xs text-neutral-500">{text}</p>}
    </div>
  );
}
