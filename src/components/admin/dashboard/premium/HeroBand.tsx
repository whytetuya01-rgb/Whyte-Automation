"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Building2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/admin/sidebar/motionTokens";
import type { DateRangeKey } from "@/lib/adminDashboardData";
import { CountUp } from "./motion";
import { TrendPill, type Trend } from "./PremiumCards";

export interface HeroStat {
  label: string;
  value: number;
  format: (n: number) => string;
  hint?: string;
  trend?: Trend;
}

const RANGES: Array<{ key: DateRangeKey; label: string }> = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "1y", label: "Year" },
  { key: "all", label: "All" },
];

interface HeroBandProps {
  companyName: string | null;
  actingAsCompany: boolean;
  isSuperAdmin: boolean;
  isDemoMode: boolean;
  canEnableDemo: boolean;
  dateRange: DateRangeKey;
  rangeLabel: string;
  stats: HeroStat[];
}

/** The dark hero at the top of the dashboard: who and when, the period switch, and the four numbers that matter most. */
export default function HeroBand({ companyName, actingAsCompany, isSuperAdmin, isDemoMode, canEnableDemo, dateRange, rangeLabel, stats }: HeroBandProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const go = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
  };

  return (
    <section className="relative overflow-hidden rounded-3xl bg-[#101014] text-white shadow-[0_24px_60px_-28px_rgba(16,16,20,0.7)] ring-1 ring-white/5" data-testid="dashboard-hero">
      {/* light that drifts slowly behind the content */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, var(--color-admin-primary,#D85B83) 0%, transparent 70%)", opacity: 0.38 }}
        animate={{ x: [0, 40, 0], y: [0, 24, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, #6D5BD0 0%, transparent 70%)", opacity: 0.26 }}
        animate={{ x: [0, -50, 0], y: [0, -18, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "radial-gradient(ellipse at 30% 0%, black, transparent 70%)" }} />

      <div className="relative space-y-6 p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {actingAsCompany && companyName ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
                  <Building2 size={12} aria-hidden="true" />
                  Viewing <strong className="font-bold">{companyName}</strong> (Act-As)
                </span>
              ) : companyName ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90">
                  <Building2 size={12} className="text-white/60" aria-hidden="true" />
                  {companyName}
                </span>
              ) : isSuperAdmin ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold">
                  <ShieldCheck size={12} className="text-[var(--color-admin-primary,#D85B83)]" aria-hidden="true" />
                  Platform Governance
                </span>
              ) : null}
              {isDemoMode ? (
                <span className="inline-flex animate-pulse items-center gap-1.5 rounded-full border border-[var(--color-admin-primary,#D85B83)]/40 bg-[var(--color-admin-primary,#D85B83)]/15 px-3 py-1 text-[11px] font-bold text-[var(--color-admin-primary-on-dark,#F08BAB)]">
                  <Sparkles size={12} aria-hidden="true" />
                  CRM Demo Preview
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  Live data
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.9rem]">Executive Dashboard</h1>
            <p className="mt-1 text-sm text-white/60">
              Leads, deals, quotations and revenue · <span className="font-medium text-white/80">{rangeLabel}</span>
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08, ease: EASE }} className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center rounded-2xl border border-white/10 bg-white/[0.06] p-1 backdrop-blur" role="group" aria-label="Period" data-testid="range-switch">
              {RANGES.map((range) => {
                const isActive = dateRange === range.key;
                return (
                  <button
                    key={range.key}
                    type="button"
                    onClick={() => go((params) => params.set("range", range.key))}
                    aria-pressed={isActive}
                    className={cn("relative rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60", isActive ? "text-[#101014]" : "text-white/65 hover:text-white")}
                  >
                    {isActive && <motion.span layoutId="hero-range-pill" className="absolute inset-0 rounded-xl bg-white shadow-sm" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                    <span className="relative">{range.label}</span>
                  </button>
                );
              })}
            </div>
            {canEnableDemo && (
              <button
                type="button"
                onClick={() => go((params) => (isDemoMode ? params.delete("demo") : params.set("demo", "1")))}
                aria-pressed={isDemoMode}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60", isDemoMode ? "border-[var(--color-admin-primary,#D85B83)]/50 bg-[var(--color-admin-primary,#D85B83)]/20 text-white" : "border-white/10 bg-white/[0.06] text-white/70 hover:text-white")}
              >
                <Sparkles size={13} aria-hidden="true" />
                Demo
              </button>
            )}
            <button
              type="button"
              onClick={() => startTransition(() => router.refresh())}
              disabled={pending}
              aria-label="Refresh dashboard"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-white/70 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-60"
            >
              <RefreshCw size={14} className={pending ? "animate-spin" : undefined} aria-hidden="true" />
            </button>
          </motion.div>
        </div>

        {stats.length > 0 && <div className={cn("grid grid-cols-2 gap-3 transition-opacity duration-200 lg:grid-cols-4", pending && "opacity-60")} data-testid="hero-stats">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 + index * 0.07, ease: EASE }}
              className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm"
            >
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-white/55">{stat.label}</p>
              <p className="mt-1 truncate text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
                <CountUp value={stat.value} format={stat.format} duration={1.3} />
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {stat.trend && <TrendPill trend={stat.trend} onDark />}
                {stat.hint && <span className="text-[11px] text-white/50">{stat.hint}</span>}
              </div>
            </motion.div>
          ))}
        </div>}
      </div>
    </section>
  );
}
