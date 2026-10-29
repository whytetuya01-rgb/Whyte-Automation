"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutPanelLeft } from "lucide-react";
import { Button } from "@/components/ui";
import notify from "@/lib/notify";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";
import { refreshCachedBranding } from "@/lib/offline/identity";
import {
  BORDER_RADIUS_OPTIONS,
  CONTENT_DENSITY_OPTIONS,
  SIDEBAR_STYLE_OPTIONS,
  themeLayoutAttributes,
  type LayoutOption,
  type ThemeLayoutSettings,
} from "@/lib/themeTokens";
import { cn } from "@/lib/utils";

function applyToPage(layout: ThemeLayoutSettings) {
  for (const [name, value] of Object.entries(themeLayoutAttributes(layout))) document.documentElement.setAttribute(name, value);
}

const sameLayout = (a: ThemeLayoutSettings, b: ThemeLayoutSettings) =>
  a.sidebarStyle === b.sidebarStyle && a.borderRadius === b.borderRadius && a.contentDensity === b.contentDensity;

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: LayoutOption<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-2">
      <p className="text-sm font-semibold text-gray-900">{label}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60",
              value === option.id ? "border-accent bg-accent-light" : "border-gray-200 bg-white hover:bg-gray-50"
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900">{option.title}</span>
              {option.badge && <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{option.badge}</span>}
            </span>
            <span className="mt-0.5 block text-xs text-gray-500">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Sidebar style, corner radius and content density for the company. A choice shows on this page at once (set on
 * <html>, like a preset preview) but is saved only with "Save Layout"; Cancel, or leaving the page, puts the saved
 * layout back. The saved layout comes from the server-resolved branding, so the whole app renders it without a flash.
 */
export default function ThemeLayoutEditor({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const { layout: saved } = useCompanyBranding();
  const [draft, setDraft] = useState<ThemeLayoutSettings>(saved);
  const [busy, setBusy] = useState(false);
  const savedRef = useRef(saved);

  // Follow the server after a save (or a different company); and show the draft on this page while editing.
  const [seenSaved, setSeenSaved] = useState(saved);
  if (!sameLayout(seenSaved, saved)) {
    setSeenSaved(saved);
    setDraft(saved);
  }
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  useEffect(() => {
    applyToPage(draft);
  }, [draft]);
  // Leaving the page never keeps an unsaved layout.
  useEffect(() => () => applyToPage(savedRef.current), []);

  const dirty = !sameLayout(draft, saved);
  const locked = busy || disabled;

  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/theme", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: draft }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        notify.error("Layout not saved", result?.error?.message ?? "The layout could not be saved. Nothing was changed.");
        return;
      }
      notify.success("Layout saved", "The sidebar, corners and density now apply across the app for your company.");
      router.refresh();
      void refreshCachedBranding();
    } catch {
      notify.error("Layout not saved", "Unable to reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Layout and density" data-testid="theme-layout-editor" className="space-y-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
          <LayoutPanelLeft size={17} className="text-[var(--color-admin-primary)]" /> Layout &amp; Density
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Choices show on this page straight away; they apply to everyone in your company once saved. The quotation document keeps its own layout.
        </p>
      </div>
      <OptionGroup label="Sidebar style" options={SIDEBAR_STYLE_OPTIONS} value={draft.sidebarStyle} onChange={(sidebarStyle) => setDraft({ ...draft, sidebarStyle })} disabled={locked} />
      <OptionGroup label="Corner radius" options={BORDER_RADIUS_OPTIONS} value={draft.borderRadius} onChange={(borderRadius) => setDraft({ ...draft, borderRadius })} disabled={locked} />
      <OptionGroup label="Content density" options={CONTENT_DENSITY_OPTIONS} value={draft.contentDensity} onChange={(contentDensity) => setDraft({ ...draft, contentDensity })} disabled={locked} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <p className="text-xs text-gray-500" role="status">{dirty ? "Showing unsaved layout changes." : "Everything shown is saved."}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" disabled={!dirty || locked} onClick={() => setDraft(saved)}>
            Cancel changes
          </Button>
          <Button type="button" variant="primary" loading={busy} disabled={!dirty || disabled} onClick={() => void save()}>
            Save Layout
          </Button>
        </div>
      </div>
    </section>
  );
}
