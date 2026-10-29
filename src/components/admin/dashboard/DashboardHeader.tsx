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
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {actingAsCompany && companyName ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
                <Building2 size={12} className="text-amber-700" />
                <span>Viewing: <strong className="font-semibold">{companyName}</strong> (Act-As)</span>
              </span>
            ) : companyName ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7]">
                <Building2 size={12} className="text-[#8A8A93]" />
                <span>{companyName}</span>
              </span>
            ) : isSuperAdmin ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#111111] text-white">
                <ShieldCheck size={12} className="text-[var(--color-admin-primary,#D85B83)]" />
                <span>Platform Governance</span>
              </span>
            ) : null}

            {/* Data Source Badge */}
            {isDemoMode ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary-foreground,#8A2B4D)] border border-[var(--color-admin-primary-border,#F1B8C8)]">
                <Sparkles size={11} className="text-[var(--color-admin-primary,#D85B83)]" />
                <span>CRM Demo Preview</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live Data</span>
              </span>
            )}
          </div>

          <h1 className="flex items-center gap-2.5 text-xl sm:text-2xl font-bold tracking-tight text-[#111111]">
            <LayoutDashboard size={22} className="text-[var(--color-admin-primary,#D85B83)] shrink-0" aria-hidden="true" />
            <span>Executive Dashboard</span>
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[#8A8A93] font-normal leading-relaxed">
            Real-time analytics across quotation pipeline, revenue performance, delivery operations, and CRM intelligence.
          </p>
        </div>

        {/* Right Side Controls */}
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-center shrink-0">
          {/* Segmented Date Range Selector */}
          <div className="inline-flex items-center bg-[#F6F6F7] p-1 rounded-xl border border-[#E5E5E7]">
            <Calendar size={13} className="text-[#8A8A93] ml-1.5 mr-1 shrink-0" />
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => handleRangeChange(opt.key)}
                disabled={isPending}
                className={`px-3 py-1 rounded-lg text-xs transition-all cursor-pointer font-medium ${
                  currentRange === opt.key
                    ? "bg-white text-[#111111] shadow-2xs font-semibold"
                    : "text-[#5F5F68] hover:text-[#111111]"
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
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs transition-colors cursor-pointer ${
                isDemoMode
                  ? "bg-[#111111] text-white border-[#111111] hover:bg-[#1E1E22] font-semibold"
                  : "bg-white text-[#3F3F46] border-[#E5E5E7] hover:border-[var(--color-admin-primary-border,#F1B8C8)] hover:text-[var(--color-admin-primary-foreground,#8A2B4D)] font-medium"
              }`}
            >
              <Sparkles size={13} className={isDemoMode ? "text-[var(--color-admin-primary,#D85B83)]" : "text-[#8A8A93]"} />
              <span>{isDemoMode ? "Exit Demo" : "CRM Demo"}</span>
            </button>
          )}

          {/* Refresh Action */}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isPending}
            title="Refresh dashboard"
            className="inline-flex items-center justify-center w-8 h-8 rounded-xl border border-[#E5E5E7] bg-white text-[#5F5F68] hover:text-[#111111] hover:bg-[#F6F6F7] transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={isPending ? "animate-spin text-[#111111]" : ""} />
          </button>
        </div>
      </div>
    </div>
  );
}
