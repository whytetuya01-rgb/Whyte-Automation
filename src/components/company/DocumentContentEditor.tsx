"use client";

import { useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui";
import {
  ProposalAboutCompany,
  ProposalContactCard,
  ProposalCoverTitle,
  ProposalIncludes,
  ProposalNextSteps,
  ProposalPageFooter,
  proposalValidityText,
} from "@/components/proposal/ProposalDocumentParts";
import {
  DEFAULT_NEXT_STEPS,
  DEFAULT_PROPOSAL_INCLUDES,
  DEFAULT_VALIDITY_DAYS,
  DOCUMENT_LABEL_DEFAULTS,
  DOCUMENT_LABEL_GROUPS,
  DOCUMENT_LABEL_KEYS,
  DOCUMENT_LABEL_LIMITS,
  DOCUMENT_LABEL_NAMES,
  DOCUMENT_LIMITS,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  isSocialUrl,
  resolveProposalContent,
  safeHttpsUrl,
  type DocumentCompanyInput,
  type DocumentLabelKey,
  type DocumentSettings,
  type IntroPageMode,
  type SocialNetwork,
} from "@/lib/documentSettings";
import { DEFAULT_COMPANY_SLUG } from "@/lib/tenant/constants";
import { cn } from "@/lib/utils";

interface Draft {
  legalName: string;
  website: string;
  footerText: string;
  automationType: string;
  socials: Record<SocialNetwork, string>;
  introPages: IntroPageMode;
  aboutTitle: string;
  aboutBody: string;
  highlights: Array<{ title: string; text: string }>;
  /** Reworded labels; "" = the default wording. */
  labels: Record<DocumentLabelKey, string>;
  includes: string[];
  nextSteps: Array<{ title: string; text: string }>;
  validityDays: string;
  defaultTerms: string;
}

type Errors = Partial<
  Record<
    "legalName" | "website" | "footerText" | "automationType" | "aboutBody" | "aboutTitle" | "highlights" | "includes" | "nextSteps" | "validityDays" | "defaultTerms" | SocialNetwork | `label.${DocumentLabelKey}`,
    string
  >
>;

const sameList = <T,>(a: readonly T[], b: readonly T[]) => JSON.stringify(a) === JSON.stringify(b);

/** The editor's starting values: what is saved, or (default company only) what its document has always said. */
function initialDraft(company: DocumentCompanyInput): Draft {
  const saved = company.documentSettings ?? null;
  const baseline = resolveProposalContent({ ...company, documentSettings: null });
  const isDefault = company.slug === DEFAULT_COMPANY_SLUG;
  const socialBaseline = Object.fromEntries(baseline.socialLinks.map((link) => [link.id, link.url])) as Partial<Record<SocialNetwork, string>>;
  const socials = Object.fromEntries(
    SOCIAL_NETWORKS.map((network) => {
      const value = saved?.socialLinks?.[network];
      return [network, value !== undefined ? value ?? "" : isDefault ? socialBaseline[network] ?? "" : ""];
    })
  ) as Record<SocialNetwork, string>;
  const text = (stored: string | null | undefined, fallback: string | null) => (stored !== undefined ? stored ?? "" : isDefault ? fallback ?? "" : "");
  return {
    legalName: text(saved?.legalName, baseline.legalName),
    website: text(saved?.website, baseline.website?.url ?? null),
    footerText: text(saved?.footerText, baseline.footerText),
    automationType: text(saved?.automationType, baseline.automationType),
    socials,
    introPages: saved?.introPages ?? baseline.introPages,
    aboutTitle: saved?.aboutTitle ?? "",
    aboutBody: saved?.aboutBody ?? "",
    highlights: (saved?.aboutHighlights ?? []).map((item) => ({ title: item.title, text: item.text })),
    labels: Object.fromEntries(
      DOCUMENT_LABEL_KEYS.map((key) => {
        const value = saved?.labels?.[key];
        return [key, value && value !== DOCUMENT_LABEL_DEFAULTS[key] ? value : ""];
      })
    ) as Record<DocumentLabelKey, string>,
    includes: Array.isArray(saved?.includes) ? [...saved.includes] : [...DEFAULT_PROPOSAL_INCLUDES],
    nextSteps: Array.isArray(saved?.nextSteps) ? saved.nextSteps.map((step) => ({ title: step.title, text: step.text })) : DEFAULT_NEXT_STEPS.map((step) => ({ ...step })),
    validityDays: saved?.defaultValidityDays ? String(saved.defaultValidityDays) : "",
    defaultTerms: saved?.defaultTerms ?? "",
  };
}

/** Draft values for "Reset document text": every label, list and default back to the standard wording. */
function defaultTextDraft(): Pick<Draft, "labels" | "includes" | "nextSteps" | "validityDays" | "defaultTerms"> {
  return {
    labels: Object.fromEntries(DOCUMENT_LABEL_KEYS.map((key) => [key, ""])) as Record<DocumentLabelKey, string>,
    includes: [...DEFAULT_PROPOSAL_INCLUDES],
    nextSteps: DEFAULT_NEXT_STEPS.map((step) => ({ ...step })),
    validityDays: "",
    defaultTerms: "",
  };
}

const SOCIAL_PLACEHOLDERS: Record<SocialNetwork, string> = {
  linkedin: "https://www.linkedin.com/company/…",
  instagram: "https://www.instagram.com/…",
  youtube: "https://www.youtube.com/@…",
  facebook: "https://www.facebook.com/…",
  whatsapp: "https://wa.me/919876543210",
};

const blankToNull = (value: string) => (value.trim() === "" ? null : value.trim());

function toSettings(draft: Draft): DocumentSettings {
  return {
    legalName: blankToNull(draft.legalName),
    website: blankToNull(draft.website),
    footerText: blankToNull(draft.footerText),
    automationType: blankToNull(draft.automationType),
    socialLinks: Object.fromEntries(SOCIAL_NETWORKS.map((network) => [network, blankToNull(draft.socials[network])])),
    introPages: draft.introPages,
    aboutTitle: blankToNull(draft.aboutTitle),
    aboutBody: blankToNull(draft.aboutBody),
    aboutHighlights: draft.highlights.filter((item) => item.title.trim() && item.text.trim()).map((item) => ({ title: item.title.trim(), text: item.text.trim() })),
    ...documentTextSettings(draft),
  };
}

/**
 * The document text part of the settings. Only what differs from the standard wording is stored, so a company that
 * changes nothing keeps following the defaults.
 */
function documentTextSettings(draft: Draft): Pick<DocumentSettings, "labels" | "includes" | "nextSteps" | "defaultValidityDays" | "defaultTerms"> {
  const labels = Object.fromEntries(
    DOCUMENT_LABEL_KEYS.map((key) => [key, draft.labels[key].trim()] as const).filter(([key, value]) => value && value !== DOCUMENT_LABEL_DEFAULTS[key])
  );
  const includes = draft.includes.map((item) => item.trim()).filter(Boolean);
  const nextSteps = draft.nextSteps.map((step) => ({ title: step.title.trim(), text: step.text.trim() })).filter((step) => step.title && step.text);
  const days = Number(draft.validityDays);
  return {
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    ...(sameList(includes, DEFAULT_PROPOSAL_INCLUDES) ? {} : { includes }),
    ...(sameList(nextSteps, DEFAULT_NEXT_STEPS) ? {} : { nextSteps }),
    ...(draft.validityDays.trim() && Number.isInteger(days) && days !== DEFAULT_VALIDITY_DAYS ? { defaultValidityDays: days } : {}),
    ...(draft.defaultTerms.trim() ? { defaultTerms: draft.defaultTerms.trim() } : {}),
  };
}

/** The same checks the server makes (it stays the authority); lets the form point at the field before saving. */
function validate(draft: Draft): Errors {
  const errors: Errors = {};
  if (draft.legalName.length > DOCUMENT_LIMITS.legalName) errors.legalName = `Legal name must be ${DOCUMENT_LIMITS.legalName} characters or fewer.`;
  if (draft.website.trim() && !safeHttpsUrl(draft.website)) errors.website = "Website must start with https://";
  if (draft.footerText.length > DOCUMENT_LIMITS.footerText) errors.footerText = `Footer text must be ${DOCUMENT_LIMITS.footerText} characters or fewer.`;
  if (draft.automationType.length > DOCUMENT_LIMITS.automationType) errors.automationType = `Automation type must be ${DOCUMENT_LIMITS.automationType} characters or fewer.`;
  for (const network of SOCIAL_NETWORKS) {
    const value = draft.socials[network].trim();
    if (value && !isSocialUrl(network, value)) errors[network] = `Enter a full https:// ${SOCIAL_LABELS[network]} address.`;
  }
  if (draft.introPages === "custom") {
    if (!draft.aboutBody.trim()) errors.aboutBody = "Write the About text, or choose \"None\".";
    if (draft.aboutBody.length > DOCUMENT_LIMITS.aboutBody) errors.aboutBody = `The About text must be ${DOCUMENT_LIMITS.aboutBody} characters or fewer.`;
    if (draft.aboutTitle.length > DOCUMENT_LIMITS.aboutTitle) errors.aboutTitle = `The title must be ${DOCUMENT_LIMITS.aboutTitle} characters or fewer.`;
  }
  for (const key of DOCUMENT_LABEL_KEYS) {
    const value = draft.labels[key].trim();
    if (value.length > DOCUMENT_LABEL_LIMITS[key]) errors[`label.${key}`] = `Use ${DOCUMENT_LABEL_LIMITS[key]} characters or fewer (it has to fit its place in the document).`;
  }
  if (draft.includes.some((item) => item.trim().length > DOCUMENT_LIMITS.includeItem)) errors.includes = `Each line must be ${DOCUMENT_LIMITS.includeItem} characters or fewer.`;
  if (draft.nextSteps.some((step) => (step.title.trim() === "") !== (step.text.trim() === ""))) errors.nextSteps = "Give every next step both a title and a description, or remove it.";
  else if (draft.nextSteps.some((step) => step.title.trim().length > DOCUMENT_LIMITS.stepTitle || step.text.trim().length > DOCUMENT_LIMITS.stepText)) {
    errors.nextSteps = `Step titles must be ${DOCUMENT_LIMITS.stepTitle} characters or fewer and descriptions ${DOCUMENT_LIMITS.stepText} or fewer.`;
  }
  if (draft.validityDays.trim()) {
    const days = Number(draft.validityDays);
    if (!Number.isInteger(days) || days < DOCUMENT_LIMITS.validityDaysMin || days > DOCUMENT_LIMITS.validityDaysMax) {
      errors.validityDays = `Enter a whole number of days from ${DOCUMENT_LIMITS.validityDaysMin} to ${DOCUMENT_LIMITS.validityDaysMax}.`;
    }
  }
  if (draft.defaultTerms.trim().length > DOCUMENT_LIMITS.defaultTerms) errors.defaultTerms = `Default terms must be ${DOCUMENT_LIMITS.defaultTerms} characters or fewer.`;
  return errors;
}

interface DocumentContentEditorProps {
  /** The saved company (from the authenticated company API). */
  company: DocumentCompanyInput;
  saving: boolean;
  /** Persists the settings; resolves with a field-level server error message, or null on success. */
  onSave: (settings: DocumentSettings) => Promise<{ field?: string; message: string } | null>;
}

export default function DocumentContentEditor({ company, saving, onSave }: DocumentContentEditorProps) {
  const initial = useMemo(() => initialDraft(company), [company]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [serverError, setServerError] = useState<{ field?: string; message: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const isDefault = company.slug === DEFAULT_COMPANY_SLUG;

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const errors = validate(draft);
  const preview = useMemo(
    () => resolveProposalContent({ ...company, documentSettings: toSettings(draft) }),
    [company, draft]
  );

  const update = (patch: Partial<Draft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setServerError(null);
  };
  const fieldError = (key: keyof Errors) => (showErrors ? errors[key] : undefined) ?? (serverError?.field === key ? serverError.message : undefined);

  const save = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    setServerError(await onSave(toSettings(draft)));
  };

  const modes: Array<{ value: IntroPageMode; label: string; hint: string; hidden?: boolean }> = [
    { value: "standard", label: "Standard Whyte pages", hint: "The built-in About and Project Overview pages.", hidden: !isDefault },
    { value: "custom", label: "Custom About page", hint: "One page written by you." },
    { value: "none", label: "None", hint: "Go straight to the project." },
  ];

  return (
    <section aria-label="Document content" data-testid="document-content-editor" className="space-y-6">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Legal name on the document" value={draft.legalName} onChange={(e) => update({ legalName: e.target.value })} placeholder={company.name ?? ""} error={fieldError("legalName")} maxLength={DOCUMENT_LIMITS.legalName + 20} />
          <Input label="Website" type="url" value={draft.website} onChange={(e) => update({ website: e.target.value })} placeholder="https://www.yourcompany.com" error={fieldError("website")} />
          <Input label="Footer text (every page)" value={draft.footerText} onChange={(e) => update({ footerText: e.target.value })} placeholder="www.yourcompany.com" error={fieldError("footerText")} />
          <Input label="Automation type (cover page)" value={draft.automationType} onChange={(e) => update({ automationType: e.target.value })} placeholder="Smart Home Automation" error={fieldError("automationType")} />
        </div>
        <p className="text-xs text-gray-500">Phone, email, address and tagline come from the Company Profile tab.</p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-900">Social media links</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {SOCIAL_NETWORKS.map((network) => (
            <Input key={network} label={SOCIAL_LABELS[network]} type="url" value={draft.socials[network]} onChange={(e) => update({ socials: { ...draft.socials, [network]: e.target.value } })} placeholder={SOCIAL_PLACEHOLDERS[network]} error={fieldError(network)} />
          ))}
        </div>
        <p className="text-xs text-gray-500">All optional. Only the links you add are shown, in the document and in the page footer. Links must start with https://.</p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-900">Introduction pages</p>
        <div role="radiogroup" aria-label="Introduction pages" className="grid gap-2 sm:grid-cols-3">
          {modes.filter((mode) => !mode.hidden).map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={draft.introPages === mode.value}
              onClick={() => update({ introPages: mode.value })}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                draft.introPages === mode.value ? "border-accent bg-accent-light" : "border-gray-200 bg-white hover:bg-gray-50"
              )}
            >
              <span className="block text-sm font-semibold text-gray-900">{mode.label}</span>
              <span className="block text-xs text-gray-500">{mode.hint}</span>
            </button>
          ))}
        </div>
        {draft.introPages === "custom" && (
          <div className="space-y-3 rounded-xl border border-gray-200 p-4">
            <Input label="About title" value={draft.aboutTitle} onChange={(e) => update({ aboutTitle: e.target.value })} placeholder={`About ${company.name ?? "your company"}`} error={fieldError("aboutTitle")} />
            <Textarea label="About text" rows={5} value={draft.aboutBody} onChange={(e) => update({ aboutBody: e.target.value })} placeholder="Who you are and what you build." error={fieldError("aboutBody")} />
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-800">Highlights <span className="font-normal text-gray-500">(optional, up to {DOCUMENT_LIMITS.highlights})</span></p>
              {draft.highlights.map((item, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
                  <Input aria-label={`Highlight ${index + 1} title`} value={item.title} placeholder="Title" onChange={(e) => update({ highlights: draft.highlights.map((h, i) => (i === index ? { ...h, title: e.target.value } : h)) })} />
                  <Input aria-label={`Highlight ${index + 1} description`} value={item.text} placeholder="Short description" onChange={(e) => update({ highlights: draft.highlights.map((h, i) => (i === index ? { ...h, text: e.target.value } : h)) })} />
                  <button type="button" aria-label={`Remove highlight ${index + 1}`} className="inline-flex h-10 items-center justify-center rounded-lg px-2 text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => update({ highlights: draft.highlights.filter((_, i) => i !== index) })}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {draft.highlights.length < DOCUMENT_LIMITS.highlights && (
                <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => update({ highlights: [...draft.highlights, { title: "", text: "" }] })}>
                  <Plus size={12} /> Add highlight
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Document text: every heading and label, the includes list, next steps and default validity / terms ── */}
      <div className="space-y-3" data-testid="document-text-editor">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Document text</p>
            <p className="text-xs text-gray-500">Reword any heading or label. Leave a field empty to keep the standard wording shown in grey.</p>
          </div>
          <button
            type="button"
            onClick={() => update(defaultTextDraft())}
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw size={12} /> Reset document text
          </button>
        </div>

        {DOCUMENT_LABEL_GROUPS.map((group) => (
          <details key={group.title} className="group rounded-xl border border-gray-200 bg-white open:shadow-2xs">
            <summary className="cursor-pointer select-none rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {group.title}
              <span className="ml-2 text-xs font-normal text-gray-500">
                {group.keys.filter((key) => draft.labels[key].trim()).length > 0 ? `${group.keys.filter((key) => draft.labels[key].trim()).length} changed` : "standard wording"}
              </span>
            </summary>
            <div className="grid gap-3 border-t border-gray-100 p-4 sm:grid-cols-2">
              {group.keys.map((key) => (
                <Input
                  key={key}
                  label={DOCUMENT_LABEL_NAMES[key]}
                  value={draft.labels[key]}
                  placeholder={DOCUMENT_LABEL_DEFAULTS[key]}
                  onChange={(e) => update({ labels: { ...draft.labels, [key]: e.target.value } })}
                  error={fieldError(`label.${key}`)}
                />
              ))}
            </div>
          </details>
        ))}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-800">
              Proposal includes <span className="font-normal text-gray-500">(up to {DOCUMENT_LIMITS.includes} lines)</span>
            </p>
            {draft.includes.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input aria-label={`Included item ${index + 1}`} value={item} onChange={(e) => update({ includes: draft.includes.map((line, i) => (i === index ? e.target.value : line)) })} />
                <button type="button" aria-label={`Remove included item ${index + 1}`} className="inline-flex h-10 items-center justify-center rounded-lg px-2 text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => update({ includes: draft.includes.filter((_, i) => i !== index) })}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {draft.includes.length < DOCUMENT_LIMITS.includes && (
              <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => update({ includes: [...draft.includes, ""] })}>
                <Plus size={12} /> Add line
              </button>
            )}
            <p className="text-xs text-gray-500">The quotation&apos;s selected tier and finish are added automatically after the first two lines.</p>
            {fieldError("includes") && <p role="alert" className="text-xs font-medium text-red-600">{fieldError("includes")}</p>}
          </div>

          <div className="space-y-2 rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-800">
              Next steps <span className="font-normal text-gray-500">(up to {DOCUMENT_LIMITS.nextSteps}; none hides the section)</span>
            </p>
            {draft.nextSteps.map((step, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
                <Input aria-label={`Next step ${index + 1} title`} value={step.title} placeholder="Title" onChange={(e) => update({ nextSteps: draft.nextSteps.map((item, i) => (i === index ? { ...item, title: e.target.value } : item)) })} />
                <Input aria-label={`Next step ${index + 1} description`} value={step.text} placeholder="Description" onChange={(e) => update({ nextSteps: draft.nextSteps.map((item, i) => (i === index ? { ...item, text: e.target.value } : item)) })} />
                <button type="button" aria-label={`Remove next step ${index + 1}`} className="inline-flex h-10 items-center justify-center rounded-lg px-2 text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => update({ nextSteps: draft.nextSteps.filter((_, i) => i !== index) })}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {draft.nextSteps.length < DOCUMENT_LIMITS.nextSteps && (
              <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => update({ nextSteps: [...draft.nextSteps, { title: "", text: "" }] })}>
                <Plus size={12} /> Add step
              </button>
            )}
            {fieldError("nextSteps") && <p role="alert" className="text-xs font-medium text-red-600">{fieldError("nextSteps")}</p>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Input
            label="Default validity (days)"
            type="number"
            inputMode="numeric"
            min={DOCUMENT_LIMITS.validityDaysMin}
            max={DOCUMENT_LIMITS.validityDaysMax}
            value={draft.validityDays}
            placeholder={String(DEFAULT_VALIDITY_DAYS)}
            onChange={(e) => update({ validityDays: e.target.value })}
            error={fieldError("validityDays")}
          />
          <Textarea
            label="Default terms"
            rows={3}
            value={draft.defaultTerms}
            placeholder="e.g. 50% advance with order, balance before installation."
            onChange={(e) => update({ defaultTerms: e.target.value })}
            error={fieldError("defaultTerms")}
          />
        </div>
        <p className="text-xs text-gray-500">Used only when a quotation has no validity date or terms of its own.</p>
      </div>

      {/* Preview: the same components the quotation document renders */}
      <div className="space-y-3" data-testid="document-live-preview">
        <p className="text-sm font-semibold text-gray-900">Live Preview</p>
        <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          {preview.about && <ProposalAboutCompany about={preview.about} />}
          <div className="rounded-lg bg-white p-4" data-testid="document-preview-cover">
            <span className="text-[10px] font-mono tracking-widest text-gray-400 uppercase font-bold block">{preview.text.quotationReference}</span>
            <div className={preview.coverImageUrl ? "mt-2 flex flex-wrap items-start gap-4" : "mt-2"}>
              <div className="w-[320px] max-w-full origin-top-left">
                <ProposalCoverTitle title={preview.text.coverTitle} />
              </div>
              {preview.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- mirrors the document, which is rasterised from plain <img>
                <img src={preview.coverImageUrl} alt="" className="h-[125px] w-[185px] rounded-xl border border-gray-100 object-cover" />
              )}
            </div>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">{preview.text.preparedFor}</p>
          </div>
          <div className="space-y-2 rounded-lg bg-white p-4" data-testid="document-preview-pricing">
            <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">{preview.text.closingEyebrow}</span>
            <h2 className="text-2xl font-black text-gray-950 tracking-tight">{preview.text.closingTitle}</h2>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <ProposalIncludes content={preview} tiers={[]} finishes={[]} />
              <div className="p-3 rounded-xl border border-gray-200 bg-white space-y-1">
                <h4 className="font-bold uppercase tracking-wider text-gray-900 text-[11px]">{preview.text.termsTitle}</h4>
                <p className="text-[13px] text-gray-600">
                  <strong className="text-gray-900">{preview.text.validityLabel}: </strong>
                  {proposalValidityText(preview, null, (value) => String(value))}
                </p>
                {preview.defaultTerms && (
                  <p className="text-[13px] text-gray-600">
                    <strong className="text-gray-900">{preview.text.termsLabel}: </strong>
                    {preview.defaultTerms}
                  </p>
                )}
              </div>
            </div>
            <ProposalNextSteps content={preview} />
          </div>
          <ProposalContactCard content={preview} />
          <div className="rounded-lg bg-white px-4 pb-3">
            <ProposalPageFooter content={preview} pageNumber={1} totalPages={5} />
          </div>
        </div>
      </div>

      {serverError && !serverError.field && <p role="alert" className="text-sm font-medium text-red-600">{serverError.message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-grey-border pt-4">
        <p className="text-xs text-gray-500" role="status">{dirty ? "You have unsaved changes." : "Everything shown is saved."}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={() => { setDraft(initial); setServerError(null); setShowErrors(false); }}>
            Cancel changes
          </Button>
          <Button type="button" variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save Document Content
          </Button>
        </div>
      </div>
    </section>
  );
}
