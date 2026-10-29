"use client";

import { useEffect, useState } from "react";
import { Palette, Check, Eye, Sparkles, RotateCcw, Info, Building2 } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import BrandColorEditor from "@/components/company/BrandColorEditor";
import BrandingLivePreview from "@/components/company/BrandingLivePreview";
import ThemeLayoutEditor from "@/components/company/ThemeLayoutEditor";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { THEME_LIST, THEME_CONFIGS, accentSource, type ThemeConfig, type SiteTheme } from "@/lib/themeTokens";
import toast from "react-hot-toast";

/**
 * Theme & Brand Customization for the signed-in company (or the company a Super Admin is acting as). The accent is ONE
 * choice: a preset theme, or a custom brand colour. Saving a custom colour replaces the preset's accent; choosing a
 * preset while a custom colour is active asks first, then removes the colour (one request), so a preset click always
 * visibly changes the app. The stored preset is what "Remove custom colour" returns to.
 *
 * "Preview" only changes this browser tab until "Exit Preview" or leaving the page; "Set as Theme" saves.
 */
export default function ThemeCustomizationPage() {
  const { activeTheme, previewTheme, setTheme, preview, cancelPreview, isSaving } = useTheme();
  const { companyId, companyName, brandColor } = useCompanyBranding();
  const confirm = useConfirm();
  const hasCompany = companyId !== null;
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  // A preview belongs to this page: leaving it returns the app to the saved theme.
  useEffect(() => cancelPreview, [cancelPreview]);

  const source = accentSource(activeTheme, brandColor);
  const activeName = THEME_CONFIGS[activeTheme].name;

  const handleCopy = (hex: string) => {
    void navigator.clipboard?.writeText(hex);
    setCopiedHex(hex);
    toast.success(`Copied ${hex} to clipboard!`);
    setTimeout(() => setCopiedHex(null), 2000);
  };

  const applyLabel = brandColor ? "Use this preset" : "Set as Theme";

  const handleApplyTheme = async (themeId: SiteTheme) => {
    if (!brandColor) {
      await setTheme(themeId);
      return;
    }
    const name = THEME_CONFIGS[themeId].name;
    const ok = await confirm({
      title: `Use ${name}?`,
      message: `Your custom colour ${brandColor.toUpperCase()} will be removed and ${name}'s colours will be used everywhere: the admin portal, dealer workspaces and quotation documents.`,
      confirmText: `Use ${name}`,
      cancelText: "Keep custom colour",
      variant: "primary",
    });
    if (!ok) return;
    await setTheme(themeId, { clearBrandColor: true });
  };

  const previewCaption = draftColor
    ? `Showing your unsaved custom colour ${draftColor.toUpperCase()}. Save it in Custom Brand Colour to apply it everywhere.`
    : previewTheme
    ? `Showing the ${THEME_CONFIGS[previewTheme].name} preset (preview only, not saved).`
    : source.kind === "custom"
    ? `Showing your saved custom colour ${source.color}.`
    : `Showing your saved ${activeName} preset.`;

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Theme & Brand Customization"
        subtitle={`Choose a preset theme and, optionally, your own brand colour${companyName ? ` for ${companyName}` : ""}. Saved changes apply to this company only: the admin portal, dealer workspaces and quotation documents.`}
        icon={Palette}
        badge={
          <span
            data-testid="accent-source"
            data-source={source.kind}
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white text-gray-700 border border-gray-200"
          >
            <span className="w-2.5 h-2.5 rounded-full border border-black/10" style={{ background: source.color }} />
            {source.kind === "custom" ? `Accent: custom colour ${source.color}` : `Accent: ${activeName} preset`}
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
                disabled={isSaving || !hasCompany}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[var(--color-admin-primary)] text-white text-xs font-bold shadow-xs hover:opacity-90 transition disabled:opacity-50"
              >
                <Check size={13} />
                <span>{isSaving ? "Applying..." : applyLabel}</span>
              </button>
            </div>
          ) : undefined
        }
      />

      {!hasCompany && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="theme-platform-notice" role="status">
          <Building2 size={18} className="mt-0.5 shrink-0" />
          <p>
            You are in platform mode, so there is no company to customise. Use <strong>Act as company</strong> to choose one.
            Previews still work here, but nothing can be saved.
          </p>
        </div>
      )}

      {previewTheme && (
        <div className="rounded-2xl border border-[var(--color-admin-primary)]/30 bg-[var(--color-admin-primary-soft)]/60 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs" data-testid="theme-preview-banner">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-admin-primary)] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Eye size={18} />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Previewing {THEME_CONFIGS[previewTheme].name} (not saved)</p>
              <p className="text-xs text-gray-600 mt-0.5">
                Only this tab shows the preview; leaving the page or Exit Preview returns to {activeName}.
                {brandColor && ` Your custom colour ${brandColor.toUpperCase()} is hidden while previewing; choosing “Use this preset” replaces it with this preset.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={cancelPreview}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 transition"
            >
              Exit Preview
            </button>
            <button
              onClick={() => handleApplyTheme(previewTheme)}
              disabled={isSaving || !hasCompany}
              className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-[var(--color-admin-primary)] hover:opacity-90 transition shadow-xs disabled:opacity-50"
            >
              {isSaving ? "Saving..." : applyLabel}
            </button>
          </div>
        </div>
      )}

      {/* A company's own brand colour (overrides the accent of the selected preset) */}
      <BrandColorEditor disabled={!hasCompany} onDraftChange={setDraftColor} />

      {/* ── Preset themes ── */}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">Preset Themes</h2>
            <p className="text-xs text-gray-500" data-testid="preset-section-note">
              Choose a preset, or set a custom brand colour above: only one is active at a time.
              {brandColor && ` Your custom colour ${brandColor.toUpperCase()} is active now; choosing a preset replaces it.`}
            </p>
          </div>
          <span className="text-xs font-medium text-gray-400">{THEME_LIST.length} curated palettes</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" data-testid="theme-grid">
          {THEME_LIST.map((theme: ThemeConfig) => {
            // With a custom colour active no preset is in effect, so every preset can be chosen.
            const isCurrentlyActive = activeTheme === theme.id && !brandColor;
            const isCurrentlyPreviewed = previewTheme ? previewTheme === theme.id : isCurrentlyActive;
            const swatches = [
              ["Primary", theme.palette.primary],
              ["Hover", theme.palette.primaryHover],
              ["Soft", theme.palette.primarySoft],
              ["Border", theme.palette.primaryBorder],
              ["Text", theme.palette.primaryForeground],
            ] as const;

            return (
              <div
                key={theme.id}
                data-testid={`theme-card-${theme.id}`}
                className={`relative rounded-2xl border transition-all duration-200 overflow-hidden bg-white flex flex-col justify-between ${isCurrentlyPreviewed
                  ? "border-[var(--color-admin-primary)] ring-2 ring-[var(--color-admin-primary)]/20 shadow-md"
                  : "border-gray-200 hover:border-gray-300 shadow-2xs hover:shadow-xs"
                  }`}
              >
                <div
                  className="h-2.5 w-full"
                  style={{ background: `linear-gradient(90deg, ${theme.palette.primary} 0%, ${theme.palette.primaryHover} 60%, ${theme.palette.primarySoft} 100%)` }}
                />

                <div className="p-4 space-y-3 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-bold text-gray-950 text-sm">{theme.name}</h3>
                        {isCurrentlyActive && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Check size={10} /> Selected
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-semibold text-gray-500 mt-0.5">{theme.subtitle}</p>
                    </div>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0 border"
                      style={{ backgroundColor: theme.palette.primarySoft, color: theme.palette.primaryForeground, borderColor: theme.palette.primaryBorder }}
                    >
                      {theme.badge}
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 leading-relaxed" title={theme.bestFor}>{theme.description}</p>

                  <div className="grid grid-cols-5 gap-1" aria-label={`${theme.name} colour tokens`}>
                    {swatches.map(([label, hex]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleCopy(hex)}
                        className="group flex flex-col items-center gap-1 rounded-md p-0.5 hover:bg-gray-50 transition"
                        title={`${label}: ${hex} (click to copy)`}
                        aria-label={`Copy ${theme.name} ${label} colour ${hex}`}
                      >
                        <span className="w-full h-6 rounded border border-black/10" style={{ backgroundColor: hex }} />
                        <span className="text-[9px] font-mono text-gray-500 group-hover:text-gray-950">{copiedHex === hex ? "Copied" : label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-gray-50/50 border-t border-gray-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => preview(theme.id)}
                    aria-pressed={previewTheme === theme.id}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition border cursor-pointer ${previewTheme === theme.id
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                      }`}
                  >
                    <Eye size={13} />
                    <span>{previewTheme === theme.id ? "Previewing" : "Preview"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleApplyTheme(theme.id)}
                    disabled={!hasCompany || isSaving || (isCurrentlyActive && !previewTheme)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer disabled:cursor-not-allowed ${isCurrentlyActive && !previewTheme
                      ? "bg-emerald-600 text-white opacity-80"
                      : "text-white hover:opacity-95 disabled:opacity-50"
                      }`}
                    style={isCurrentlyActive && !previewTheme ? undefined : { backgroundColor: theme.palette.primary }}
                  >
                    <Check size={13} />
                    <span>{isCurrentlyActive && !previewTheme ? "Active Theme" : isSaving ? "Saving..." : applyLabel}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Sidebar style, corner radius and content density ── */}
      <ThemeLayoutEditor disabled={!hasCompany} />

      {/* ── Live preview of every accented surface ── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-2xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-gray-950 flex items-center gap-2">
              <Sparkles size={17} className="text-[var(--color-admin-primary)]" />
              Live Preview
            </h3>
            <p className="text-xs text-gray-500">The real sidebar logo, loader, buttons, form controls, dealer and quotation accents.</p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-gray-500">
            <Info size={13} /> Nothing here is saved.
          </p>
        </div>
        <BrandingLivePreview colorOverride={draftColor} caption={previewCaption} />
      </div>
    </div>
  );
}
