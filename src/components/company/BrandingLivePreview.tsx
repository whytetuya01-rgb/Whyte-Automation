"use client";

import { useState } from "react";
import { CheckCircle2, FileText, Home, Info, LayoutGrid, MapPin, Package, TrendingUp } from "lucide-react";
import AnimatedLogo from "@/components/admin/sidebar/AnimatedLogo";
import WhyteLoader from "@/components/shared/WhyteLoader";
import { Button, Input, Select } from "@/components/ui";
import { brandPreviewStyle } from "@/lib/brandColor";
import { cn } from "@/lib/utils";

/**
 * One preview of everything the accent touches, built from the real application components (sidebar logo, loader,
 * buttons, inputs, dropdown) plus faithful copies of the sidebar item, dealer builder and quotation accents.
 *
 * It renders with the page's current accent (the saved theme, or the preset being previewed). Pass `colorOverride`
 * (a validated, unsaved custom colour) to scope that colour to this panel only; nothing outside it changes.
 */
export default function BrandingLivePreview({ colorOverride = null, caption }: { colorOverride?: string | null; caption?: string }) {
  const [region, setRegion] = useState("north");
  const style = colorOverride ? (brandPreviewStyle(colorOverride) as React.CSSProperties) : undefined;
  const label = "text-[11px] font-bold uppercase tracking-wider text-gray-400";

  return (
    <section aria-label="Branding live preview" data-testid="branding-live-preview" className="space-y-4" style={style}>
      {caption && <p className="text-xs text-gray-500" data-testid="branding-live-preview-caption">{caption}</p>}

      {/* Navigation: the real header logo on the black sidebar, expanded and collapsed */}
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <div className="space-y-1.5">
          <p className={label}>Expanded sidebar</p>
          <div className="space-y-3 rounded-xl bg-[#111111] p-4" data-testid="preview-sidebar-expanded">
            <div className="flex min-h-[44px] items-center"><AnimatedLogo collapsed={false} /></div>
            <div className="space-y-1">
              <div className="relative flex items-center justify-between overflow-hidden rounded-xl border border-[var(--color-admin-primary-on-dark)]/30 bg-[var(--color-admin-primary-on-dark)]/15 px-3 py-2 text-xs font-semibold text-white">
                <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-[var(--color-admin-primary-on-dark)]" aria-hidden="true" />
                <span className="flex items-center gap-2.5"><FileText size={15} className="text-[var(--color-admin-primary-on-dark)]" /> Quotations</span>
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-admin-primary-on-dark)]" aria-hidden="true" />
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-neutral-400"><Package size={15} /> Products</div>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <p className={label}>Collapsed sidebar</p>
          <div className="flex flex-col items-center gap-3 rounded-xl bg-[#111111] p-4" data-testid="preview-sidebar-collapsed">
            <div className="flex min-h-[44px] items-center"><AnimatedLogo collapsed /></div>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--color-admin-primary-on-dark)]/30 bg-[var(--color-admin-primary-on-dark)]/15">
              <FileText size={15} className="text-[var(--color-admin-primary-on-dark)]" />
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Controls */}
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <p className={label}>Buttons, badges & links</p>
          <div className="flex flex-wrap items-center gap-2">
            {/* The app's primary buttons are black by design; the accent button is the one that follows the colour. */}
            <Button type="button" variant="accent" size="sm">Accent button</Button>
            <Button type="button" variant="primary" size="sm">Primary button</Button>
            <Button type="button" variant="secondary" size="sm">Secondary button</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-admin-primary-border)] bg-[var(--color-admin-primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--color-admin-primary-foreground)]">
              <CheckCircle2 size={13} /> Approved
            </span>
            <span className="inline-flex items-center rounded-lg bg-[var(--color-admin-primary)] px-2.5 py-1 text-xs font-bold text-white">Active client</span>
            <a href="#" onClick={(event) => event.preventDefault()} className="text-xs font-semibold text-accent underline underline-offset-2 hover:text-accent-hover">Accent link</a>
          </div>
          <p className={cn(label, "pt-1")}>Inputs & dropdown</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Customer name" placeholder="Click to see the focus ring" />
            <Select
              label="Region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              options={[
                { value: "north", label: "North zone" },
                { value: "west", label: "West zone" },
                { value: "south", label: "South zone" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-gray-500">Focused field</span>
            <div
              className="flex h-10 items-center rounded-lg border bg-white px-3 text-sm text-gray-900"
              style={{ borderColor: "var(--color-admin-primary)", boxShadow: "0 0 0 3px var(--admin-focus-ring)" }}
              data-testid="preview-focus-ring"
            >
              Riverside Villa
            </div>
          </div>
        </div>

        {/* Admin, dealer and quotation accents */}
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className={label}>Admin dashboard</p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-xl font-black text-gray-950">₹ 42,85,000</span>
              <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-admin-primary-border)] bg-[var(--color-admin-primary-soft)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--color-admin-primary-foreground)]">
                <TrendingUp size={11} /> +18.4%
              </span>
            </div>
            <p className="text-xs text-gray-500">Pipeline value this month</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4" data-testid="preview-dealer">
            <p className={label}>Dealer workspace</p>
            <div className="mt-2 flex items-center gap-2 text-xs font-semibold">
              {["Project", "Spaces", "Products"].map((step, index) => (
                <span key={step} className="flex items-center gap-1.5">
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px]", index < 2 ? "bg-accent text-white" : "bg-gray-100 text-gray-500")}>{index + 1}</span>
                  <span className={index === 1 ? "text-accent" : "text-gray-500"}>{step}</span>
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-accent bg-accent-light px-3 py-2 text-xs font-semibold text-accent-foreground">
              <Home size={14} className="text-accent" /> Living Room <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[10px] text-white">Selected</span>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4" data-testid="preview-quotation">
            <p className={label}>Quotation document</p>
            <p className="mt-1 text-sm font-extrabold leading-tight text-gray-900">
              Smart Automation <span className="text-accent">Proposal</span>
            </p>
            <div className="mt-1.5 h-[3px] w-24 rounded-full bg-gradient-to-r from-accent to-accent/0" />
            <div className="mt-3 flex items-center justify-between rounded-lg border border-gray-200 border-l-4 border-l-accent px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 font-bold text-gray-900"><LayoutGrid size={13} className="text-accent" /> Master Bedroom</span>
              <span className="font-mono font-black text-accent">12</span>
            </div>
            <p className="mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-accent"><MapPin size={11} /> Site address</p>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className={label}>Loader</p>
        <div className="overflow-hidden rounded-xl border border-gray-200" data-testid="preview-loader">
          <WhyteLoader variant="content" message="Preview" className="min-h-0 flex-none py-6 sm:py-6" />
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-gray-500" data-testid="preview-fixed-note">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          Fixed by design: the black header and sidebar surfaces, black primary buttons, success / warning / error colours,
          neutral text and the default Whyte wordmark. On the dark sidebar the accent is lightened automatically when it would be too dark to see.
        </span>
      </p>
    </section>
  );
}
