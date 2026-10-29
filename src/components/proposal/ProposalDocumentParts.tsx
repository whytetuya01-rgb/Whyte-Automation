import { Globe, Mail, Phone } from "lucide-react";
import WhyteLogo from "@/components/shared/WhyteLogo";
import SocialLinks from "@/components/shared/SocialLinks";
import type { ProposalContent } from "@/lib/documentSettings";

type AboutContent = NonNullable<ProposalContent["about"]>;

/**
 * The parts of the quotation document that carry company identity: the logo, the closing "who we are / how to
 * reach us" card and the running page footer. Used by the real PDF preview and by the Document Content editor's
 * preview, so what the editor shows is exactly what the document prints.
 */

/** The company logo; the default company keeps the Whyte artwork, any other company without a logo gets its name. */
export function ProposalLogo({ content, kind }: { content: ProposalContent; kind: "cover" | "header" | "footer" }) {
  if (content.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- the PDF is rasterised from this DOM; a plain <img> keeps it deterministic
      <img
        src={content.logoUrl}
        alt={`${content.brandName} logo`}
        crossOrigin="anonymous"
        className="object-contain object-left"
        style={kind === "cover" ? { height: 28, maxWidth: 140, width: "auto" } : kind === "header" ? { height: 20, maxWidth: 90, width: "auto" } : { height: 24, maxWidth: 120, width: "auto" }}
      />
    );
  }
  if (content.isDefaultCompany) {
    if (kind === "cover") return <WhyteLogo theme="light" alt="WHYTE Automations" size="document-cover" style={{ height: "22px", maxWidth: "100px", width: "auto" }} unoptimized loading="eager" />;
    if (kind === "header") return <WhyteLogo theme="light" alt="WHYTE" size="document-header" style={{ height: "18px", maxWidth: "80px", width: "auto" }} unoptimized loading="eager" />;
    return <WhyteLogo theme="light" alt="Whyte Automations" size="document-footer" unoptimized loading="eager" />;
  }
  return <span className={kind === "header" ? "text-sm font-black tracking-tight text-gray-950" : "text-base font-black tracking-tight text-gray-950"}>{content.brandName}</span>;
}

export function ProposalContactCard({ content }: { content: ProposalContent }) {
  const hasContact = Boolean(content.phone || content.email || content.website);
  return (
    <div data-testid="company-panel" className="rounded-xl border border-gray-200 border-l-4 border-l-accent bg-white overflow-hidden break-inside-avoid">
      {/* Two balanced columns: who we are | how to reach us */}
      <div className={hasContact ? "grid grid-cols-2 items-stretch" : "grid grid-cols-1 items-stretch"}>
        <div className="p-4 space-y-1.5">
          <ProposalLogo content={content} kind="footer" />
          <p className="font-bold text-gray-950 text-[15px] leading-snug">{content.legalName}</p>
          {(content.addressLine || content.tagline) && (
            <p className="text-[13px] text-gray-500 leading-snug">
              {content.addressLine}
              {content.addressLine && content.tagline && <span className="text-gray-300"> • </span>}
              {content.tagline && <span className="font-semibold text-accent">{content.tagline}</span>}
            </p>
          )}
        </div>
        {hasContact && (
          <div className="p-4 border-l border-gray-100 flex flex-col justify-center gap-2 text-[13px] text-gray-700">
            {content.phone && (
              <p className="flex items-center gap-2.5">
                <Phone size={14} className="text-accent shrink-0" />
                <span className="font-medium">{content.phone}</span>
              </p>
            )}
            {content.email && (
              <p className="flex items-center gap-2.5">
                <Mail size={14} className="text-accent shrink-0" />
                <span className="font-medium">{content.email}</span>
              </p>
            )}
            {content.website && (
              <p className="flex items-center gap-2.5">
                <Globe size={14} className="text-accent shrink-0" />
                <a href={content.website.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                  {content.website.url}
                </a>
              </p>
            )}
          </div>
        )}
      </div>
      {content.socialLinks.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between gap-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 shrink-0">Connect with {content.connectName}</span>
          <SocialLinks variant="proposal-card" links={content.socialLinks} />
        </div>
      )}
    </div>
  );
}

export function ProposalPageFooter({ content, pageNumber, totalPages }: { content: ProposalContent; pageNumber: number; totalPages: number }) {
  return (
    <div data-testid="page-footer" className="pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] font-medium text-gray-400">
      {content.footerText ? (
        content.website ? (
          <a href={content.website.url} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-gray-600">
            {content.footerText}
          </a>
        ) : (
          <span>{content.footerText}</span>
        )
      ) : (
        <span />
      )}
      <span className="font-mono tracking-wider text-gray-400">
        Page {pageNumber} of {totalPages}
      </span>
    </div>
  );
}

/** The company-written introduction page (title, text and up to four highlights). */
export function ProposalAboutCompany({ about }: { about: AboutContent }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-pink-50 via-white to-slate-100 p-6">
        <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">Company Profile</span>
        <h2 className="text-3xl font-black text-gray-950 tracking-tight mt-0.5">{about.title}</h2>
        <p className="text-sm text-gray-700 mt-3 leading-relaxed whitespace-pre-line">{about.body}</p>
      </div>
      {about.highlights.length > 0 && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          {about.highlights.map((highlight, index) => (
            <div key={index} className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 border-l-[3px] border-l-accent space-y-1">
              <p className="font-bold text-gray-950">{highlight.title}</p>
              <p className="text-[13px] text-gray-500 leading-relaxed">{highlight.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The cover's large title. Up to three words: one per line with the last word in the accent colour (the long-standing
 * "Smart / Automation / Proposal" look). Longer titles wrap normally, last word still accented.
 */
export function ProposalCoverTitle({ title }: { title: string }) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const last = words.pop() ?? "";
  return (
    <h1 className="text-[54px] font-extrabold leading-[1.0] tracking-tight text-gray-950 [overflow-wrap:anywhere]">
      {words.length <= 2
        ? words.map((word, index) => (
            <span key={index}>
              {word}
              <br />
            </span>
          ))
        : `${words.join(" ")} `}
      <span className="text-accent">{last}</span>
    </h1>
  );
}

/**
 * "Proposal Includes": the company's lines, with the quotation's selected tier / finish lines inserted after the
 * first two (where they have always appeared). Renders nothing when there is nothing to list.
 */
export function ProposalIncludes({ content, tiers, finishes }: { content: ProposalContent; tiers: string[]; finishes: string[] }) {
  const selections = [
    ...(tiers.length > 0 ? [`Selected automation tier: ${tiers.join(", ")}`] : []),
    ...(finishes.length > 0 ? [`Selected surface finish: ${finishes.join(", ")}`] : []),
  ];
  const lines = [...content.includes.slice(0, 2), ...selections, ...content.includes.slice(2)];
  if (lines.length === 0) return null;
  return (
    <div className="p-3 rounded-xl border border-gray-200 bg-white space-y-1" data-testid="proposal-includes">
      <h4 className="font-bold uppercase tracking-wider text-gray-900 text-[11px]">{content.text.includesTitle}</h4>
      <ul className="space-y-1 text-[13px] text-gray-600">
        {lines.map((line, index) => (
          <li key={index}>• {line}</li>
        ))}
      </ul>
    </div>
  );
}

/** "Next Steps": one box per step, numbered. Hidden when the company has removed every step. */
export function ProposalNextSteps({ content }: { content: ProposalContent }) {
  if (content.nextSteps.length === 0) return null;
  return (
    <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50 space-y-1.5" data-testid="proposal-next-steps">
      <h4 className="font-bold uppercase tracking-wider text-gray-950 text-[11px]">{content.text.nextStepsTitle}</h4>
      <ol className="grid gap-2 text-[13px] text-gray-700" style={{ gridTemplateColumns: `repeat(${content.nextSteps.length}, minmax(0, 1fr))` }}>
        {content.nextSteps.map((step, index) => (
          <li key={index} className="p-1.5 bg-white rounded-lg border border-gray-200">
            <span className="font-bold text-gray-950 block text-sm">
              {index + 1}. {step.title}
            </span>
            {step.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Validity line text: the quotation's own date, or the company's default number of days. */
export function proposalValidityText(content: ProposalContent, validUntil: string | Date | null | undefined, formatDate: (value: string | Date) => string): string {
  return validUntil ? `Valid until ${formatDate(validUntil)}` : `Valid for ${content.validityDays} days from date of issue.`;
}
