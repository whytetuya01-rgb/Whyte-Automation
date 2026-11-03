"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  RefreshCw,
  Sparkles,
  Building2,
  ShieldCheck,
  LayoutDashboard,
} from "lucide-react";
import type { DateRangeKey } from "@/lib/adminDashboardData";

interface DashboardHeaderProps {
  currentRange: DateRangeKey;
  companyName: string | null;
  actingAsCompany: boolean;
  isSuperAdmin: boolean;
  isDemoMode: boolean;
  canEnableDemo: boolean;
  activeView?: "all" | "revenue" | "crm";
  onViewChange?: (view: "all" | "revenue" | "crm") => void;
  onRefresh?: () => void;
}

const RANGE_OPTIONS: Array<{ key: DateRangeKey; label: string }> = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "1y", label: "This Year" },
];

export default function DashboardHeader({
  currentRange,
  companyName,
  actingAsCompany,
  isSuperAdmin,
  isDemoMode,
  canEnableDemo,
  onRefresh,
}: DashboardHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleRangeChange = (newRange: DateRangeKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", newRange);
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  };

  const handleToggleDemo = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (isDemoMode) {
      params.delete("demo");
    } else {
      params.set("demo", "1");
    }
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  };

  const handleManualRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      startTransition(() => {
        router.refresh();
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-2 border-b border-[#E5E5E7]">
      {/* Top Title & Context Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            {actingAsCompany && companyName ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-900 border border-amber-200/80 shadow-2xs">
                <Building2 size={12} className="text-amber-700" />
                <span>Viewing: <strong className="font-bold">{companyName}</strong> (Act-As)</span>
              </span>
            ) : companyName ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7] shadow-2xs">
                <Building2 size={12} className="text-[#8A8A93]" />
                <span className="font-semibold text-[#111111]">{companyName}</span>
              </span>
            ) : isSuperAdmin ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-neutral-900 text-white shadow-2xs">
                <ShieldCheck size={12} className="text-[var(--color-admin-primary,#D85B83)]" />
                <span>Platform Governance</span>
              </span>
            ) : null}

            {/* Data Source Radar Beacon Badge */}
            {isDemoMode ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary-foreground,#8A2B4D)] border border-[var(--color-admin-primary-border,#F1B8C8)] shadow-2xs animate-pulse">
                <Sparkles size={12} className="text-[var(--color-admin-primary,#D85B83)]" />
                <span>CRM Demo Preview</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span>Live Data</span>
              </span>
            )}
          </div>

          <h1 className="flex items-center gap-2.5 text-xl sm:text-2xl font-bold tracking-tight text-[#111111]">
            <LayoutDashboard size={22} className="text-[var(--color-admin-primary,#D85B83)] shrink-0 transition-transform hover:scale-110 duration-200" aria-hidden="true" />
            <span>Executive Dashboard</span>
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[#8A8A93] font-normal leading-relaxed">
            Real-time analytics across quotation pipeline, revenue performance, delivery operations, and CRM intelligence.
          </p>
        </div>

        {/* Right Side Controls */}
        <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center shrink-0">
          {/* Segmented Date Range Selector */}
          <div className="inline-flex items-center bg-[#F6F6F7] p-1 rounded-xl border border-[#E5E5E7] shadow-2xs">
            <Calendar size={13} className="text-[#8A8A93] ml-1.5 mr-1 shrink-0" />
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => handleRangeChange(opt.key)}
                disabled={isPending}
                className={`px-3 py-1 rounded-lg text-xs transition-all duration-200 cursor-pointer font-medium ${
                  currentRange === opt.key
                    ? "bg-white text-[#111111] shadow-xs font-bold scale-[1.02]"
                    : "text-[#5F5F68] hover:text-[#111111] hover:bg-white/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* CRM Demo Preview Toggle */}
          {canEnableDemo && (
            <button
              type="button"
              onClick={handleToggleDemo}
              disabled={isPending}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs transition-all duration-200 cursor-pointer shadow-2xs ${
                isDemoMode
                  ? "bg-gradient-to-r from-neutral-950 to-neutral-900 text-white border-neutral-700 hover:from-black hover:to-neutral-900 font-bold"
                  : "bg-white text-[#3F3F46] border-[#E5E5E7] hover:border-[var(--color-admin-primary-border,#F1B8C8)] hover:text-[var(--color-admin-primary-foreground,#8A2B4D)] hover:shadow-xs font-medium"
              }`}
            >
              <Sparkles size={13} className={isDemoMode ? "text-[var(--color-admin-primary,#D85B83)] animate-pulse" : "text-[#8A8A93]"} />
              <span>{isDemoMode ? "Exit Demo" : "CRM Demo"}</span>
            </button>
          )}

          {/* Refresh Action */}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isPending}
            title="Refresh dashboard"
            className="group inline-flex items-center justify-center w-8 h-8 rounded-xl border border-[#E5E5E7] bg-white text-[#5F5F68] hover:text-[#111111] hover:bg-[#F6F6F7] hover:shadow-2xs transition-all duration-200 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={`transition-transform duration-500 group-hover:rotate-180 ${
                isPending ? "animate-spin text-[#111111]" : ""
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
