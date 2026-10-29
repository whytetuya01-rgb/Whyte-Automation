"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import notify from "@/lib/notify";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";
import { refreshCachedBranding } from "@/lib/offline/identity";
import {
  MIN_BRAND_CONTRAST_ON_WHITE,
  brandContrastOnWhite,
  brandPreviewStyle,
  deriveBrandPalette,
  normalizeBrandColor,
} from "@/lib/brandColor";
import { THEME_CONFIGS, THEME_LIST } from "@/lib/themeTokens";
import { cn } from "@/lib/utils";

/** Extra hand-picked colours beside the preset accents; every one passes the contrast gate. */
const CURATED_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Whyte Navy", hex: "#1b3c73" },
  { name: "Indigo", hex: "#4338ca" },
  { name: "Crimson", hex: "#b91c1c" },
  { name: "Plum", hex: "#86198f" },
  { name: "Pine", hex: "#166534" },
  { name: "Olive", hex: "#4d7c0f" },
  { name: "Chocolate", hex: "#7c4a2d" },
  { name: "Steel", hex: "#3b5b7a" },
];

/**
 * Custom brand colour: pick one colour and the whole app (admin, dealer pages, quotation documents) uses it as its
 * accent, replacing the selected preset's. The preview is scoped to this card (CSS variables on a wrapper), so
 * nothing else in the app changes until Save. The saved colour comes from the server-resolved branding context.
 *
 * `onDraftChange` reports a valid, readable unsaved colour (or null) so the page's live preview can show it too.
 */
export default function BrandColorEditor({ disabled = false, onDraftChange }: { disabled?: boolean; onDraftChange?: (color: string | null) => void }) {
  const router = useRouter();
  const { brandColor: saved, theme } = useCompanyBranding();
  const [draft, setDraft] = useState<string>(saved ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-seed the draft when the saved colour changes (after a save, or another company's session).
  const [seenSaved, setSeenSaved] = useState<string | null>(saved);
  if (seenSaved !== saved) {
    setSeenSaved(saved);
    setDraft(saved ?? "");
  }

  const typed = draft.trim();
  const valid = normalizeBrandColor(typed);
  const contrast = valid ? brandContrastOnWhite(valid) : null;
  const readable = contrast !== null && contrast >= MIN_BRAND_CONTRAST_ON_WHITE;
  const palette = valid && readable ? deriveBrandPalette(valid) : null;
  const dirty = (valid ?? "") !== (saved ?? "") || (typed !== "" && !valid);
  const unsavedPreview = dirty && palette ? valid : null;
  useEffect(() => {
    onDraftChange?.(unsavedPreview);
  }, [unsavedPreview, onDraftChange]);
  const locked = busy || disabled;

  const save = async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/theme", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandColor: next }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const issue = result?.error?.details?.issues?.find((i: { path?: unknown[] }) => i.path?.[0] === "brandColor") as { message?: string } | undefined;
        const message = issue?.message ?? result?.error?.message ?? "The brand colour could not be saved. Nothing was changed.";
        setError(message);
        notify.error("Brand colour not saved", message);
        return;
      }
      notify.success(next ? "Brand colour saved" : "Custom colour removed", next ? "Your colour is now used across the app and your quotation documents." : "The selected theme's colours are used again.");
      router.refresh();
      void refreshCachedBranding();
    } catch {
      const message = "Unable to reach the server. Nothing was changed.";
      setError(message);
      notify.error("Brand colour not saved", message);
    } finally {
      setBusy(false);
    }
  };

  const problem =
    typed !== "" && !valid
      ? "Enter a colour as #rrggbb, for example #1b3c73."
      : valid && !readable
      ? `That colour is too light: white text on it would be hard to read (contrast ${contrast?.toFixed(1)}:1, needs at least ${MIN_BRAND_CONTRAST_ON_WHITE}:1).`
      : null;

  return (
    <section aria-label="Custom brand colour" data-testid="brand-color-editor" className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900">Custom Brand Colour</h2>
          <p className="mt-0.5 text-xs text-gray-500">Use your own colour instead of a preset. It replaces the accent everywhere: buttons, highlights, the admin panel and your quotation documents.</p>
        </div>
        {saved ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700" data-testid="brand-color-active">
            <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: saved }} /> Active: {saved.toUpperCase()} · custom colour (replaces the preset)
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600" data-testid="brand-color-inactive">
            <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: THEME_CONFIGS[theme].palette.primary }} /> Not set · using the {THEME_CONFIGS[theme].name} preset
          </span>
        )}
      </div>
      {disabled && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800" data-testid="brand-color-disabled">
          Choose a company with “Act as company” to set its brand colour.
        </p>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-gray-800">Colour</span>
              <input
                type="color"
                aria-label="Pick a brand colour"
                value={valid ?? "#d85b83"}
                onChange={(event) => { setDraft(event.target.value); setError(null); }}
                disabled={locked}
                className="h-10 w-14 cursor-pointer rounded-lg border border-gray-200 bg-white p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="min-w-[8rem] flex-1 space-y-1.5">
              <span className="block text-sm font-medium text-gray-800">Hex value</span>
              <input
                type="text"
                aria-label="Brand colour hex value"
                value={draft}
                onChange={(event) => { setDraft(event.target.value); setError(null); }}
                placeholder="#1b3c73"
                maxLength={7}
                spellCheck={false}
                disabled={locked}
                aria-invalid={Boolean(problem)}
                className="h-10 w-full rounded-lg border border-gray-200 px-3 font-mono text-sm uppercase focus:border-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:border-red-400"
              />
            </label>
          </div>

          <div className="space-y-1.5" data-testid="brand-color-swatches">
            <p className="text-xs font-medium text-gray-500">Start from a preset accent or a curated colour</p>
            <div className="flex flex-wrap gap-2">
              {[...THEME_LIST.map((preset) => ({ name: preset.name, hex: preset.palette.primary.toLowerCase() })), ...CURATED_COLORS].map((swatch) => (
                <button
                  key={swatch.name}
                  type="button"
                  disabled={locked}
                  title={`${swatch.name} ${swatch.hex.toUpperCase()}`}
                  aria-label={`Use ${swatch.name} colour ${swatch.hex.toUpperCase()}`}
                  aria-pressed={valid === swatch.hex}
                  onClick={() => { setDraft(swatch.hex); setError(null); }}
                  className="h-7 w-7 rounded-full border border-black/10 transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1 aria-pressed:ring-2 aria-pressed:ring-gray-900 aria-pressed:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: swatch.hex }}
                />
              ))}
            </div>
          </div>

          <p className={cn("flex items-start gap-1.5 text-xs font-medium", problem ? "text-red-600" : contrast ? "text-emerald-700" : "text-gray-500")} role={problem ? "alert" : "status"} data-testid="brand-color-contrast">
            {problem ? <AlertTriangle size={14} className="mt-px shrink-0" /> : contrast ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : null}
            <span>{problem ?? (contrast ? `Readable: white text on this colour has a contrast of ${contrast.toFixed(1)}:1.` : "Pick a colour to preview it.")}</span>
          </p>
          {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" loading={busy} disabled={disabled || !dirty || !valid || !readable} onClick={() => void save(valid)}>
              Save Brand Colour
            </Button>
            <Button type="button" variant="secondary" disabled={!dirty || locked} onClick={() => { setDraft(saved ?? ""); setError(null); }}>
              Cancel changes
            </Button>
            {saved && (
              <button type="button" disabled={locked} onClick={() => void save(null)} className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60">
                <RotateCcw size={12} /> Remove custom colour (use {THEME_CONFIGS[theme].name})
              </button>
            )}
          </div>
        </div>

        {/* Preview: CSS variables are set on this wrapper only */}
        <div className="space-y-2" data-testid="brand-color-preview" style={palette ? (brandPreviewStyle(valid) as React.CSSProperties) : undefined}>
          <p className="text-xs font-medium text-gray-500">Preview</p>
          <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-xl bg-accent px-3.5 py-2 text-xs font-bold text-white">Accent button</span>
              <span className="inline-flex items-center rounded-xl border border-accent-border bg-accent-light px-3.5 py-2 text-xs font-bold text-accent-foreground">Soft badge</span>
              <span className="text-xs font-semibold text-accent">Accent link</span>
            </div>
            <div className="h-1 w-24 rounded-full bg-gradient-to-r from-accent to-transparent" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-accent">Quotation heading</p>
            {palette && (
              <div className="flex flex-wrap gap-2 pt-1" aria-label="Derived shades">
                {([["Main", palette.primary], ["Hover", palette.hover], ["Soft", palette.soft], ["Border", palette.border], ["Text", palette.foreground], ["On dark", palette.onDark]] as const).map(([label, hex]) => (
                  <span key={label} className="flex flex-col items-center gap-1 text-[10px] text-gray-500">
                    <span className="h-6 w-6 rounded-md border border-black/10" style={{ background: hex }} />
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
