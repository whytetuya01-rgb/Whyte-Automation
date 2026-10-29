"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, ImagePlus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import AnimatedLogo from "@/components/admin/sidebar/AnimatedLogo";
import { BrandingProvider } from "@/components/providers/BrandingProvider";
import WhyteLoader from "@/components/shared/WhyteLoader";
import DealerHeaderLogo from "@/components/shared/DealerHeaderLogo";
import type { CompanyBranding } from "@/lib/companyBranding";
import {
  DEFAULT_LOGO_SETTINGS,
  LOGO_BACKGROUNDS,
  LOGO_FITS,
  LOGO_PADDING_RANGE,
  LOGO_RADIUS_RANGE,
  logoDimensionProblem,
  logoFileSizeProblem,
  logoSpecSummary,
  sameLogoSettings,
  type LogoBackground,
  type LogoFit,
  type LogoSettings,
  type LogoUploadKind,
} from "@/lib/logoSettings";
import { ALLOWED_IMAGE_MIME_TYPES } from "@/lib/validation/upload";
import { DEFAULT_LAYOUT_SETTINGS, DEFAULT_THEME } from "@/lib/themeTokens";
import { cn } from "@/lib/utils";

/**
 * Everything the user has changed but not saved yet. Nothing here is persisted until the parent form submits it, so
 * leaving the page (or Discard) never touches the stored logo.
 */
export interface LogoDraft {
  logoFile: File | null;
  removeLogo: boolean;
  compactFile: File | null;
  removeCompact: boolean;
  settings: LogoSettings;
}

export function emptyLogoDraft(settings: LogoSettings = DEFAULT_LOGO_SETTINGS): LogoDraft {
  return { logoFile: null, removeLogo: false, compactFile: null, removeCompact: false, settings };
}

export function isLogoDraftDirty(draft: LogoDraft, saved: LogoSettings): boolean {
  return Boolean(draft.logoFile || draft.compactFile || draft.removeLogo || draft.removeCompact || !sameLogoSettings(draft.settings, saved));
}

/** The multipart body for POST /api/company/logo (or the registration form): only what actually changed. */
export function appendLogoDraft(body: FormData, draft: LogoDraft, options: { includeSettings: boolean }): void {
  if (draft.logoFile) body.append("logo", draft.logoFile);
  if (draft.compactFile) body.append("compactLogo", draft.compactFile);
  if (draft.removeLogo) body.append("removeLogo", "true");
  if (draft.removeCompact) body.append("removeCompactLogo", "true");
  if (options.includeSettings) {
    body.append("logoFit", draft.settings.fit);
    body.append("logoBackground", draft.settings.background);
    body.append("logoPadding", String(draft.settings.padding));
    body.append("logoRadius", String(draft.settings.radius));
  }
}

export type LogoFieldErrors = Partial<Record<"logo" | "compactLogo" | "logoFit" | "logoBackground" | "logoPadding" | "logoRadius", string>>;

interface LogoCustomizerProps {
  draft: LogoDraft;
  onChange: (next: LogoDraft) => void;
  /** The logo currently saved for the company (absent on registration). */
  savedLogoUrl?: string | null;
  savedCompactLogoUrl?: string | null;
  companyName?: string | null;
  /** Errors from the server (or the parent), shown next to the matching control. */
  errors?: LogoFieldErrors;
  disabled?: boolean;
  /** Shown instead of the generic note when there is a saved logo that is not being changed. */
  idPrefix?: string;
}

const ACCEPT = ALLOWED_IMAGE_MIME_TYPES.join(",");

/** Same rules the server enforces for this upload (type, size, pixel size, aspect ratio); the server remains the authority. */
async function checkLogoFile(file: File, kind: LogoUploadKind): Promise<string | null> {
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPG or WebP image (SVG is not accepted).";
  const sizeProblem = logoFileSizeProblem(kind, file.size);
  if (sizeProblem) return sizeProblem;
  const url = URL.createObjectURL(file);
  try {
    const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const probe = new window.Image();
      probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
      probe.onerror = () => resolve(null);
      probe.src = url;
    });
    if (!size) return "That image could not be read. Please choose a different file.";
    return logoDimensionProblem(kind, size);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  return url;
}

/** Whether an image URL actually loads, so the preview can say so instead of silently showing the default. */
function useImageStatus(url: string | null): "none" | "loading" | "ok" | "error" {
  const [state, setState] = useState<{ url: string | null; status: "loading" | "ok" | "error" }>({ url: null, status: "loading" });
  useEffect(() => {
    if (!url) return;
    let active = true;
    const probe = new window.Image();
    probe.onload = () => active && setState({ url, status: "ok" });
    probe.onerror = () => active && setState({ url, status: "error" });
    probe.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  if (!url) return "none";
  return state.url === url ? state.status : "loading";
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  error,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; text: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-1.5">
      <p className="text-sm font-medium text-gray-800">{label}</p>
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60",
              value === option.value ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
            )}
          >
            {option.text}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  error,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-sm font-medium text-gray-800">
        {label}
        <span className="text-xs font-semibold text-gray-500">{value}px</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
      />
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </label>
  );
}

export default function LogoCustomizer({
  draft,
  onChange,
  savedLogoUrl = null,
  savedCompactLogoUrl = null,
  companyName = null,
  errors = {},
  disabled = false,
  idPrefix = "company",
}: LogoCustomizerProps) {
  const logoInput = useRef<HTMLInputElement>(null);
  const compactInput = useRef<HTMLInputElement>(null);
  const [fileErrors, setFileErrors] = useState<{ logo?: string; compactLogo?: string }>({});

  const logoBlob = useObjectUrl(draft.logoFile);
  const compactBlob = useObjectUrl(draft.compactFile);
  const effectiveLogo = draft.logoFile ? logoBlob : draft.removeLogo ? null : savedLogoUrl;
  const effectiveCompact = !effectiveLogo ? null : draft.compactFile ? compactBlob : draft.removeCompact ? null : savedCompactLogoUrl;
  const logoStatus = useImageStatus(effectiveLogo);

  const previewBranding = useMemo<CompanyBranding>(
    () => ({ companyId: -1, companyName, logoUrl: effectiveLogo, compactLogoUrl: effectiveCompact, settings: draft.settings, brandColor: null, theme: DEFAULT_THEME, layout: DEFAULT_LAYOUT_SETTINGS }),
    [companyName, effectiveLogo, effectiveCompact, draft.settings]
  );

  const chooseFile = async (kind: LogoUploadKind, file: File | null) => {
    if (!file) return;
    const problem = await checkLogoFile(file, kind);
    setFileErrors((previous) => ({ ...previous, [kind]: problem ?? undefined }));
    if (problem) return;
    onChange(kind === "logo" ? { ...draft, logoFile: file, removeLogo: false } : { ...draft, compactFile: file, removeCompact: false });
  };
  const resetInput = (ref: React.RefObject<HTMLInputElement | null>) => {
    if (ref.current) ref.current.value = "";
  };
  const set = (patch: Partial<LogoSettings>) => onChange({ ...draft, settings: { ...draft.settings, ...patch } });

  const fileButton = "inline-flex cursor-pointer items-center rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-1 aria-disabled:opacity-60";
  const textButton = "inline-flex items-center gap-1 text-xs font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60";

  return (
    <section aria-label="Company logo customization" data-testid="logo-customizer" className="space-y-5">
      {/* ── Logo files ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-800">Company Logo</p>
          <div className="flex items-center gap-3">
            <div
              className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
              data-testid="company-logo-frame"
            >
              {effectiveLogo ? (
                <Image src={effectiveLogo} alt="Selected company logo preview" width={96} height={64} unoptimized className="max-h-full max-w-full object-contain" />
              ) : (
                <ImagePlus size={22} className="text-gray-300" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className={fileButton} aria-disabled={disabled}>
                {effectiveLogo ? "Replace logo" : "Upload logo"}
                <input
                  ref={logoInput}
                  id={`${idPrefix}-logo`}
                  type="file"
                  accept={ACCEPT}
                  aria-label="Company logo file"
                  className="sr-only"
                  disabled={disabled}
                  onChange={(event) => {
                    void chooseFile("logo", event.target.files?.[0] ?? null);
                    resetInput(logoInput);
                  }}
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                {draft.logoFile && (
                  <button type="button" disabled={disabled} className={cn(textButton, "text-gray-600")} onClick={() => onChange({ ...draft, logoFile: null })}>
                    <Undo2 size={12} /> Discard new logo
                  </button>
                )}
                {!draft.logoFile && savedLogoUrl && !draft.removeLogo && (
                  <button type="button" disabled={disabled} className={cn(textButton, "text-red-600")} onClick={() => onChange({ ...draft, removeLogo: true, compactFile: null })}>
                    <Trash2 size={12} /> Remove logo
                  </button>
                )}
                {draft.removeLogo && (
                  <button type="button" disabled={disabled} className={cn(textButton, "text-gray-600")} onClick={() => onChange({ ...draft, removeLogo: false })}>
                    <Undo2 size={12} /> Keep current logo
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500" data-testid="logo-spec">
            {logoSpecSummary("logo")} Without a logo the default Whyte branding is used.
          </p>
          {draft.removeLogo && <p className="text-xs font-medium text-amber-700">The logo will be removed when you save.</p>}
          {(fileErrors.logo || errors.logo) && <p role="alert" className="text-xs font-medium text-red-600">{fileErrors.logo ?? errors.logo}</p>}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-800">Compact Sidebar Logo <span className="font-normal text-gray-500">(Optional)</span></p>
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50" data-testid="compact-logo-frame">
              {effectiveCompact ? (
                <Image src={effectiveCompact} alt="Selected compact logo preview" width={64} height={64} unoptimized className="max-h-full max-w-full object-contain" />
              ) : (
                <ImagePlus size={20} className="text-gray-300" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className={fileButton} aria-disabled={disabled || !effectiveLogo}>
                {effectiveCompact ? "Replace" : "Upload"}
                <input
                  ref={compactInput}
                  id={`${idPrefix}-compact-logo`}
                  type="file"
                  accept={ACCEPT}
                  aria-label="Compact sidebar logo file"
                  className="sr-only"
                  disabled={disabled || !effectiveLogo}
                  onChange={(event) => {
                    void chooseFile("compactLogo", event.target.files?.[0] ?? null);
                    resetInput(compactInput);
                  }}
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                {draft.compactFile && (
                  <button type="button" disabled={disabled} className={cn(textButton, "text-gray-600")} onClick={() => onChange({ ...draft, compactFile: null })}>
                    <Undo2 size={12} /> Discard
                  </button>
                )}
                {!draft.compactFile && savedCompactLogoUrl && !draft.removeCompact && effectiveLogo && (
                  <button type="button" disabled={disabled} className={cn(textButton, "text-red-600")} onClick={() => onChange({ ...draft, removeCompact: true })}>
                    <Trash2 size={12} /> Remove
                  </button>
                )}
                {draft.removeCompact && (
                  <button type="button" disabled={disabled} className={cn(textButton, "text-gray-600")} onClick={() => onChange({ ...draft, removeCompact: false })}>
                    <Undo2 size={12} /> Keep
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500" data-testid="compact-logo-spec">
            A square mark for the collapsed sidebar. {logoSpecSummary("compactLogo")} Without one, your full logo is shown, scaled to fit.
          </p>
          {(fileErrors.compactLogo || errors.compactLogo) && <p role="alert" className="text-xs font-medium text-red-600">{fileErrors.compactLogo ?? errors.compactLogo}</p>}
        </div>
      </div>

      {/* ── Presentation ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Segmented<LogoFit>
          label="Logo Fit"
          value={draft.settings.fit}
          disabled={disabled}
          onChange={(fit) => set({ fit })}
          options={LOGO_FITS.map((value) => ({ value, text: value === "contain" ? "Contain" : "Cover / Crop" }))}
          error={errors.logoFit}
        />
        <Segmented<LogoBackground>
          label="Logo Background"
          value={draft.settings.background}
          disabled={disabled}
          onChange={(background) => set({ background })}
          options={LOGO_BACKGROUNDS.map((value) => ({ value, text: value === "white" ? "White" : "Transparent" }))}
          error={errors.logoBackground}
        />
        <RangeField label="Logo Padding" value={draft.settings.padding} min={LOGO_PADDING_RANGE.min} max={LOGO_PADDING_RANGE.max} disabled={disabled} onChange={(padding) => set({ padding })} error={errors.logoPadding} />
        <RangeField label="Corner Rounding" value={draft.settings.radius} min={LOGO_RADIUS_RANGE.min} max={LOGO_RADIUS_RANGE.max} disabled={disabled} onChange={(radius) => set({ radius })} error={errors.logoRadius} />
      </div>
      <p className="text-xs text-gray-500">Contain shows the whole logo. Cover / Crop fills a fixed-width area and may trim the edges.</p>
      <button
        type="button"
        disabled={disabled || sameLogoSettings(draft.settings, DEFAULT_LOGO_SETTINGS)}
        onClick={() => onChange({ ...draft, settings: DEFAULT_LOGO_SETTINGS })}
        className={cn(textButton, "text-gray-700")}
      >
        <RotateCcw size={12} /> Reset to Defaults
      </button>

      {/* ── Live preview: the real header logo and loader, fed the unsaved draft ── */}
      <div className="space-y-3" data-testid="logo-live-preview">
        <p className="text-sm font-semibold text-gray-900">Live Preview</p>
        {!effectiveLogo && <p className="text-xs text-gray-500" data-testid="logo-preview-note">No company logo: the default Whyte branding is shown.</p>}
        {effectiveLogo && logoStatus === "loading" && <p className="text-xs text-gray-500" data-testid="logo-preview-note">Loading preview…</p>}
        {effectiveLogo && logoStatus === "error" && (
          <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-600" data-testid="logo-preview-note">
            <AlertCircle size={13} /> This image could not be loaded, so the default Whyte branding is shown.
          </p>
        )}
        <BrandingProvider branding={previewBranding}>
          <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">Expanded sidebar</p>
              <div className="flex min-h-[56px] items-center rounded-lg bg-[#0E0E10] px-4 py-2" data-testid="logo-preview-expanded">
                <AnimatedLogo collapsed={false} />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">Collapsed sidebar</p>
              <div className="flex min-h-[56px] items-center justify-center rounded-lg bg-[#0E0E10] px-2 py-2" data-testid="logo-preview-collapsed">
                <AnimatedLogo collapsed />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-500">Dealer header (light)</p>
            <div className="flex min-h-[48px] items-center rounded-lg border border-gray-200 bg-white px-4 py-2" data-testid="logo-preview-dealer-header">
              <DealerHeaderLogo />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-500">Loader</p>
            <div className="overflow-hidden rounded-lg border border-gray-200" data-testid="logo-preview-loader">
              <WhyteLoader variant="content" message="Preview" className="min-h-0 flex-none py-8 sm:py-8" />
            </div>
          </div>
        </BrandingProvider>
      </div>
    </section>
  );
}
