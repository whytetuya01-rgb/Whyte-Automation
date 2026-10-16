"use client";

import { useState } from "react";
import {
  Palette,
  Check,
  Eye,
  Sparkles,
  RotateCcw,
  Sliders,
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  FileText,
  Copy,
  Info,
  Layers,
  ArrowRight,
} from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import { useTheme } from "@/components/providers/ThemeProvider";
import { THEME_LIST, THEME_CONFIGS, ThemeConfig } from "@/lib/themeTokens";
import type { SiteTheme } from "@/models/Company";
import toast from "react-hot-toast";

export default function ThemeCustomizationPage() {
  const {
    activeTheme,
    previewTheme,
    currentEffectiveTheme,
    setTheme,
    preview,
    cancelPreview,
    isSaving,
    isLoading,
  } = useTheme();

  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  const handleCopy = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    toast.success(`Copied ${hex} to clipboard!`);
    setTimeout(() => setCopiedHex(null), 2000);
  };

  const handleApplyTheme = async (themeId: SiteTheme) => {
    await setTheme(themeId);
  };

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto pb-12">
      {/* Top Page Header */}
      <PageHeader
        title="Theme & Brand Customization"
        subtitle="Empowering Superadmins with full control over the platform brand palette. Changes reflect live across the admin portal, dealer workspaces, and quotation proposals."
        icon={Palette}
        badge={
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--color-admin-primary)]/10 text-[var(--color-admin-primary)] border border-[var(--color-admin-primary)]/20">
            <ShieldCheck size={13} />
            Superadmin Exclusive
          </span>
        }
        actions={
          previewTheme ? (
            <div className="flex items-center gap-2">
              <button
                onClick={cancelPreview}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs transition"
              >
                <RotateCcw size={13} />
                <span>Exit Preview</span>
              </button>
              <button
                onClick={() => handleApplyTheme(previewTheme)}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[var(--color-admin-primary)] text-white text-xs font-bold shadow-xs hover:opacity-90 transition disabled:opacity-50"
              >
                <Check size={13} />
                <span>{isSaving ? "Applying..." : "Apply This Theme"}</span>
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-700 shadow-2xs">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-admin-primary)] animate-pulse" />
              <span>Active: <strong>{THEME_CONFIGS[activeTheme]?.name}</strong></span>
            </div>
          )
        }
      />

      {/* Live Preview Mode Alert Banner */}
      {previewTheme && (
        <div className="rounded-2xl border border-[var(--color-admin-primary)]/30 bg-[var(--color-admin-primary-soft)]/60 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-admin-primary)] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Eye size={18} />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">
                Live Preview Active: {THEME_CONFIGS[previewTheme]?.name}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                The entire UI is currently previewing this theme in real-time. Notice the sidebar, active states, and accents.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={cancelPreview}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 transition"
            >
              Reset to Active
            </button>
            <button
              onClick={() => handleApplyTheme(previewTheme)}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-[var(--color-admin-primary)] hover:opacity-90 transition shadow-xs"
            >
              {isSaving ? "Saving..." : "Apply Permanently"}
            </button>
          </div>
        </div>
      )}

      {/* ── Theme Options Grid ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">Choose Your Brand Identity</h2>
            <p className="text-xs text-gray-500">
              Select one of the 3 hand-crafted palettes tailored for Whyte Automations.
            </p>
          </div>
          <span className="text-xs font-medium text-gray-400">3 Curated Options</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {THEME_LIST.map((theme: ThemeConfig) => {
            const isCurrentlyActive = activeTheme === theme.id;
            const isCurrentlyPreviewed = currentEffectiveTheme === theme.id;

            return (
              <div
                key={theme.id}
                className={`relative rounded-2xl border transition-all duration-200 overflow-hidden bg-white flex flex-col justify-between ${isCurrentlyPreviewed
                  ? "border-[var(--color-admin-primary)] ring-2 ring-[var(--color-admin-primary)]/20 shadow-md"
                  : "border-gray-200 hover:border-gray-300 shadow-2xs hover:shadow-xs"
                  }`}
              >
                {/* Card Top Color Strip */}
                <div
                  className="h-3 w-full"
                  style={{
                    background: `linear-gradient(90deg, ${theme.palette.primary} 0%, ${theme.palette.primaryHover} 60%, ${theme.palette.primarySoft} 100%)`,
                  }}
                />

                <div className="p-5 space-y-4 flex-1">
                  {/* Title & Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-950 text-base">{theme.name}</h3>
                        {isCurrentlyActive && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Check size={10} /> Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-gray-500 mt-0.5">{theme.subtitle}</p>
                    </div>

                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shrink-0"
                      style={{
                        backgroundColor: theme.palette.primarySoft,
                        color: theme.palette.primaryForeground,
                        borderColor: theme.palette.primaryBorder,
                        borderWidth: "1px",
                      }}
                    >
                      {theme.badge}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {theme.description}
                  </p>

                  {/* Swatch Strip */}
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      Color Palette Tokens
                    </p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {/* Primary */}
                      <button
                        type="button"
                        onClick={() => handleCopy(theme.palette.primary)}
                        className="group relative flex flex-col items-center gap-1 p-1 rounded-lg hover:bg-gray-50 transition"
                        title={`Primary: ${theme.palette.primary} (Click to copy)`}
                      >
                        <div
                          className="w-full h-8 rounded-md shadow-2xs border border-black/5"
                          style={{ backgroundColor: theme.palette.primary }}
                        />
                        <span className="text-[10px] font-mono text-gray-500 group-hover:text-gray-950">
                          {theme.palette.primary}
                        </span>
                      </button>

                      {/* Hover */}
                      <button
                        type="button"
                        onClick={() => handleCopy(theme.palette.primaryHover)}
                        className="group relative flex flex-col items-center gap-1 p-1 rounded-lg hover:bg-gray-50 transition"
                        title={`Hover: ${theme.palette.primaryHover} (Click to copy)`}
                      >
                        <div
                          className="w-full h-8 rounded-md shadow-2xs border border-black/5"
                          style={{ backgroundColor: theme.palette.primaryHover }}
                        />
                        <span className="text-[10px] font-mono text-gray-500 group-hover:text-gray-950">
                          {theme.palette.primaryHover}
                        </span>
                      </button>

                      {/* Soft Pill */}
                      <button
                        type="button"
                        onClick={() => handleCopy(theme.palette.primarySoft)}
                        className="group relative flex flex-col items-center gap-1 p-1 rounded-lg hover:bg-gray-50 transition"
                        title={`Soft Tint: ${theme.palette.primarySoft} (Click to copy)`}
                      >
                        <div
                          className="w-full h-8 rounded-md shadow-2xs border border-black/10"
                          style={{ backgroundColor: theme.palette.primarySoft }}
                        />
                        <span className="text-[10px] font-mono text-gray-500 group-hover:text-gray-950">
                          {theme.palette.primarySoft}
                        </span>
                      </button>

                      {/* Subtle Row */}
                      <button
                        type="button"
                        onClick={() => handleCopy(theme.palette.primarySubtle)}
                        className="group relative flex flex-col items-center gap-1 p-1 rounded-lg hover:bg-gray-50 transition"
                        title={`Subtle: ${theme.palette.primarySubtle} (Click to copy)`}
                      >
                        <div
                          className="w-full h-8 rounded-md shadow-2xs border border-black/10"
                          style={{ backgroundColor: theme.palette.primarySubtle }}
                        />
                        <span className="text-[10px] font-mono text-gray-500 group-hover:text-gray-950">
                          {theme.palette.primarySubtle}
                        </span>
                      </button>

                      {/* Border */}
                      <button
                        type="button"
                        onClick={() => handleCopy(theme.palette.primaryBorder)}
                        className="group relative flex flex-col items-center gap-1 p-1 rounded-lg hover:bg-gray-50 transition"
                        title={`Border: ${theme.palette.primaryBorder} (Click to copy)`}
                      >
                        <div
                          className="w-full h-8 rounded-md shadow-2xs border border-black/10"
                          style={{ backgroundColor: theme.palette.primaryBorder }}
                        />
                        <span className="text-[10px] font-mono text-gray-500 group-hover:text-gray-950">
                          {theme.palette.primaryBorder}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Strategic Target / Best For */}
                  <div className="rounded-xl p-3 bg-gray-50/80 border border-gray-100 text-xs space-y-1">
                    <p className="font-semibold text-gray-800">Best Suited For:</p>
                    <p className="text-gray-600 text-[11px] leading-relaxed">{theme.bestFor}</p>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="p-4 bg-gray-50/50 border-t border-gray-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => preview(theme.id)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition border cursor-pointer ${isCurrentlyPreviewed
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                      }`}
                  >
                    <Eye size={13} />
                    <span>{isCurrentlyPreviewed ? "Previewing" : "Preview Theme"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleApplyTheme(theme.id)}
                    disabled={isSaving || (isCurrentlyActive && !previewTheme)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer ${isCurrentlyActive && !previewTheme
                      ? "bg-emerald-600 text-white opacity-80 cursor-default"
                      : "text-white hover:opacity-95"
                      }`}
                    style={
                      isCurrentlyActive && !previewTheme
                        ? undefined
                        : { backgroundColor: theme.palette.primary }
                    }
                  >
                    <Check size={13} />
                    <span>{isCurrentlyActive && !previewTheme ? "Active Theme" : isSaving ? "Saving..." : "Set as Theme"}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Live Interactive UI Component Simulation ── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-gray-950 flex items-center gap-2">
              <Sparkles size={17} className="text-[var(--color-admin-primary)]" />
              Live Interactive UI Component Simulation
            </h3>
            <p className="text-xs text-gray-500">
              Components below are rendered with the currently effective theme (<strong>{THEME_CONFIGS[currentEffectiveTheme].name}</strong>).
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
            <span>Primary:</span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-md text-white font-mono text-[11px]"
              style={{ backgroundColor: THEME_CONFIGS[currentEffectiveTheme].palette.primary }}
            >
              {THEME_CONFIGS[currentEffectiveTheme].palette.primary}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Simulation 1: Sidebar Nav Item Preview */}
          <div className="rounded-xl border border-gray-200 p-4 bg-[#111111] text-white space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
              Admin Sidebar State
            </p>
            <div className="space-y-1.5">
              {/* Active nav item */}
              <div className="relative flex items-center justify-between px-3 py-2 rounded-xl border border-[var(--color-admin-primary)]/30 bg-[var(--color-admin-primary)]/15 text-white text-xs font-semibold shadow-[0_0_12px_var(--color-admin-primary)]/10">
                <div className="flex items-center gap-2.5">
                  <FileText size={15} className="text-[var(--color-admin-primary)]" />
                  <span>Quotations</span>
                </div>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-admin-primary)] shadow-[0_0_6px_var(--color-admin-primary)]" />
              </div>

              {/* Inactive nav item */}
              <div className="flex items-center justify-between px-3 py-2 rounded-xl text-neutral-400 hover:text-white text-xs font-semibold">
                <div className="flex items-center gap-2.5">
                  <Palette size={15} />
                  <span>Theme & Branding</span>
                </div>
              </div>
            </div>
          </div>

          {/* Simulation 2: KPI & Trend Card */}
          <div className="rounded-xl border border-gray-200 p-4 bg-white space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Quotation Analytics KPI
            </p>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black text-gray-950">₹ 42,85,000</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-[var(--color-admin-primary-soft)] text-[var(--color-admin-primary-foreground)] border border-[var(--color-admin-primary-border)]">
                <TrendingUp size={11} /> +18.4%
              </span>
            </div>
            <p className="text-xs text-gray-500">Gross pipeline value this month</p>
          </div>

          {/* Simulation 3: Status Badge & Pill Preview */}
          <div className="rounded-xl border border-gray-200 p-4 bg-white space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Quotation Status Pill
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-[var(--color-admin-primary-soft)] text-[var(--color-admin-primary-foreground)] border border-[var(--color-admin-primary-border)] shadow-2xs">
                <CheckCircle2 size={13} /> Approved Proposal
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-[var(--color-admin-primary)] text-white shadow-2xs">
                Active Client
              </span>
            </div>
          </div>

          {/* Simulation 4: Client Proposal Cover Title Accent */}
          <div className="rounded-xl border border-gray-200 p-4 bg-white space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Proposal Cover Preview
            </p>
            <div>
              <p className="text-sm font-extrabold text-gray-900 leading-tight">
                Smart Automation
              </p>
              <p className="text-sm font-extrabold text-[var(--color-admin-primary)] leading-tight">
                Proposal 2026
              </p>
              <div className="h-0.5 w-16 mt-1.5 rounded-full bg-gradient-to-r from-[var(--color-admin-primary)] to-transparent" />
            </div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mt-1">
              Whyte Living Ecosystems
            </p>
          </div>
        </div>
      </div>

      {/* ── PM Discussion Guide / Rationale Panel ── */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Info size={18} className="text-[var(--color-admin-primary)]" />
          <h3 className="text-sm font-bold text-gray-900">
            Product Manager & Stakeholder Discussion Guide
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-white p-4 rounded-xl border border-gray-200/80 space-y-1.5">
            <span className="font-bold text-gray-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#D85B83]" />
              Option 1: Whyte Rose
            </span>
            <p className="text-gray-600 leading-relaxed">
              <strong>PM Rationale:</strong> Preserves Whyte’s established visual brand equity. Aligns 1:1 with the pink accent in the physical Whyte company logo and existing marketing brochures.
            </p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200/80 space-y-1.5">
            <span className="font-bold text-gray-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#C4823F]" />
              Option 3: Champagne Bronze
            </span>
            <p className="text-gray-600 leading-relaxed">
              <strong>PM Rationale:</strong> Shifts aesthetic toward ultra-luxury architecture, bespoke brass switch finishes, and high-end villas. Favored when presenting to architects and luxury interior designers.
            </p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200/80 space-y-1.5">
            <span className="font-bold text-gray-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
              Option 4: Emerald Haven
            </span>
            <p className="text-gray-600 leading-relaxed">
              <strong>PM Rationale:</strong> Evokes contemporary sustainable energy, green smart buildings, and biophilic living. Offers the highest WCAG contrast ratio for corporate and enterprise clarity.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

