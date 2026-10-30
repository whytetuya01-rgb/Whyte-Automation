import type { Metadata } from "next";
import { Download, ExternalLink, FileText, LinkIcon } from "lucide-react";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationDelivery } from "@/models";
import { findLinkTarget, inLinkCompany, type LinkTarget } from "@/lib/quotationLinks";
import { loadBrandingForCompany, type CompanyBranding } from "@/lib/companyBranding";
import CompanyLogo from "@/components/shared/CompanyLogo";
import ViewRecorder from "./ViewRecorder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quotation",
  robots: { index: false, follow: false, nocache: true },
  // The token is the whole credential: never pass the page address on to other sites.
  referrer: "no-referrer",
};

type PageProps = { params: Promise<{ token: string }> };

interface ViewDetails {
  quotationNumber: string;
  clientName: string | null;
  sentAt: Date | null;
  senderName: string | null;
}

async function loadDetails(target: LinkTarget): Promise<ViewDetails | null> {
  return inLinkCompany(target, async () => {
    const [delivery, quotation] = await Promise.all([
      QuotationDelivery.findById(target.deliveryId).select("sentAt createdAt createdByName").lean(),
      Quotation.findById(target.quotationId).select("quotationNumber clientName").lean(),
    ]);
    if (!delivery || !quotation) return null;
    return {
      quotationNumber: quotation.quotationNumber,
      clientName: quotation.clientName?.trim() || null,
      sentAt: delivery.sentAt ?? delivery.createdAt ?? null,
      senderName: delivery.createdByName?.trim() || null,
    };
  });
}

function Shell({ branding, children }: { branding: CompanyBranding | null; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-admin-background">
      <header className="border-b border-admin-grey-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          {branding?.logoUrl ? (
            <CompanyLogo src={branding.logoUrl} name={branding.companyName} variant="header" settings={branding.settings} chipHeight={40} />
          ) : null}
          {branding?.companyName ? <span className="truncate text-sm font-semibold text-admin-black">{branding.companyName}</span> : null}
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
    </main>
  );
}

function Unavailable({ branding, title, message }: { branding: CompanyBranding | null; title: string; message: string }) {
  return (
    <Shell branding={branding}>
      <section className="mx-auto max-w-md rounded-2xl border border-admin-grey-border bg-white p-6 text-center shadow-sm sm:p-8">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-admin-grey-light text-admin-grey">
          <LinkIcon size={22} aria-hidden />
        </span>
        <h1 className="text-lg font-semibold text-admin-black">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-admin-grey">{message}</p>
      </section>
    </Shell>
  );
}

/**
 * Public view of a sent quotation (no sign-in): whoever holds the link sees the exact PDF that was sent. Opening the
 * page marks the delivery "Viewed" (recorded by the page's script, so link previews do not count).
 */
export default async function QuotationLinkPage({ params }: PageProps) {
  const { token } = await params;
  await connectMongoDB();
  const target = await findLinkTarget(token);
  if (!target) {
    return <Unavailable branding={null} title="This link is not valid" message="Please check that the whole link was copied, or ask the sender for a new one." />;
  }
  const branding = await loadBrandingForCompany(target.companyId);
  const from = branding.companyName ?? "the sender";
  if (target.state === "revoked") {
    return <Unavailable branding={branding} title="This link has been switched off" message={`Please contact ${from} for an up-to-date copy of the quotation.`} />;
  }
  if (target.state !== "active") {
    return <Unavailable branding={branding} title="This link has expired" message={`Quotation links stay open for a limited time. Please contact ${from} for a new copy.`} />;
  }
  const details = await loadDetails(target);
  if (!details) {
    return <Unavailable branding={branding} title="This quotation is no longer available" message={`Please contact ${from} for a new copy.`} />;
  }

  const pdfUrl = `/api/public/quotation-links/${token}/pdf`;
  const sentOn = details.sentAt
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(details.sentAt)
    : null;

  return (
    <Shell branding={branding}>
      <ViewRecorder token={token} />
      <section className="rounded-2xl border border-admin-grey-border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-admin-grey-light text-admin-black">
              <FileText size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-admin-black">Quotation {details.quotationNumber}</h1>
              <p className="mt-0.5 text-sm text-admin-grey">
                {details.clientName ? <>Prepared for {details.clientName}</> : null}
                {details.clientName && (sentOn || details.senderName) ? " · " : null}
                {sentOn ? <>Sent on {sentOn}</> : null}
                {details.senderName ? <> by {details.senderName}</> : null}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
            <a
              href={`${pdfUrl}?download=1`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-admin-black px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-admin-charcoal"
            >
              <Download size={16} aria-hidden /> Download PDF
            </a>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-admin-grey-border bg-white px-4 py-2.5 text-sm font-semibold text-admin-black transition-colors hover:bg-admin-grey-light"
            >
              <ExternalLink size={16} aria-hidden /> Open full screen
            </a>
          </div>
        </div>
      </section>

      {/* Phones often cannot show a PDF inside a page, so they get the buttons above; larger screens get the preview. */}
      <section className="mt-5 hidden overflow-hidden rounded-2xl border border-admin-grey-border bg-white shadow-sm md:block">
        <iframe src={pdfUrl} title={`Quotation ${details.quotationNumber}`} className="block h-[80vh] w-full" />
      </section>
      <p className="mt-5 text-center text-xs text-admin-grey md:hidden">Tap “Open full screen” to read the quotation, or download it to keep a copy.</p>
    </Shell>
  );
}
