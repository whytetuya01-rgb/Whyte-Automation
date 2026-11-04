"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, Columns2, Download, Eye, FileClock, Loader2, Maximize, Minimize } from "lucide-react";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { apiJson, toErrorMessage } from "@/lib/apiClient";
import { useUserTimeZone } from "@/lib/useUserTimeZone";
import type { RevisionComparison } from "@/lib/revisionCompare";
import RevisionPdfPanel from "./RevisionPdfPanel";
import RevisionChanges from "./RevisionChanges";

interface RevisionSummary {
  revision: number;
  quotationNumber: string;
  issuedAt: string;
  issuedByName: string | null;
  reason: string | null;
  reconstructed: boolean;
  hasPdf: boolean;
  grandTotal: number;
  current: boolean;
  superseded: { at: string; byRevision: number | null } | null;
}
interface RevisionList {
  currentRevision: number;
  status: string;
  revisions: RevisionSummary[];
}
interface CompareResponse {
  comparison: RevisionComparison;
}

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);

/**
 * The issued revisions of one quotation: view any one's original PDF, or put two side by side with what changed between them.
 * Everything shown comes from what was frozen when each revision was issued; nothing here can change a revision or its PDF.
 */
export default function RevisionViewer({ quotationId, initialView, initialFrom, initialTo }: { quotationId: string; initialView: number | null; initialFrom: number | null; initialTo: number | null }) {
  const router = useRouter();
  const timeZone = useUserTimeZone();
  const [list, setList] = useState<RevisionList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState<number | null>(initialFrom);
  const [to, setTo] = useState<number | null>(initialTo);
  const [view, setView] = useState<number | null>(initialView);
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"from" | "to">("from");
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone, day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

  useEffect(() => {
    let cancelled = false;
    apiJson
      .get<RevisionList>(`/api/quotations/${quotationId}/revisions`)
      .then((data) => {
        if (cancelled) return;
        setList(data);
        const issued = [...data.revisions].sort((a, b) => a.revision - b.revision);
        const exists = (n: number | null) => n !== null && issued.some((r) => r.revision === n);
        // A sensible default pair: the latest two issued revisions.
        if (issued.length >= 2 && !(exists(initialFrom) && exists(initialTo) && initialFrom !== initialTo) && initialView === null) {
          setFrom(issued[issued.length - 2].revision);
          setTo(issued[issued.length - 1].revision);
        }
        if (issued.length === 1) setView(issued[0].revision);
        if (initialView !== null && !exists(initialView)) setView(issued[issued.length - 1]?.revision ?? null);
      })
      .catch((err) => !cancelled && setLoadError(toErrorMessage(err, "The revisions could not be loaded.")));
    return () => {
      cancelled = true;
    };
  }, [quotationId, initialFrom, initialTo, initialView]);

  const issued = list ? [...list.revisions].sort((a, b) => a.revision - b.revision) : [];
  const canCompare = issued.length >= 2;
  const mode: "view" | "compare" = view !== null || !canCompare ? "view" : "compare";
  const byNumber = (n: number | null) => issued.find((r) => r.revision === n) ?? null;
  const fromRev = byNumber(from);
  const toRev = byNumber(to);
  const viewRev = byNumber(view) ?? issued[issued.length - 1] ?? null;
  const quotationNumber = issued[0]?.quotationNumber ?? "";

  // Keep the address in step, so the comparison can be bookmarked or shared with a colleague (who still needs access).
  useEffect(() => {
    if (!list) return;
    const query = mode === "compare" && from !== null && to !== null ? `?from=${from}&to=${to}` : viewRev ? `?view=${viewRev.revision}` : "";
    router.replace(`/quotation/${quotationId}/revisions${query}`, { scroll: false });
  }, [list, mode, from, to, viewRev, quotationId, router]);

  useEffect(() => {
    if (mode !== "compare" || from === null || to === null || from === to) return;
    let cancelled = false;
    setComparison(null);
    setCompareError(null);
    apiJson
      .get<CompareResponse>(`/api/quotations/${quotationId}/revisions/compare?from=${from}&to=${to}`)
      .then((data) => !cancelled && setComparison(data.comparison))
      .catch((err) => !cancelled && setCompareError(toErrorMessage(err, "The comparison could not be loaded.")));
    return () => {
      cancelled = true;
    };
  }, [mode, from, to, quotationId]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current && stageRef.current !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      // full screen is not available here (an embedded browser, for example): the panels still work
    }
  }, []);

  const options = issued.map((r) => ({ value: String(r.revision), label: `Rev ${r.revision} · ${when(r.issuedAt)} · ${money(r.grandTotal)}${r.current ? " · Current" : ""}` }));
  const pick = (side: "from" | "to", value: string) => {
    const n = Number(value);
    if (side === "from") {
      if (n === to) setTo(from);
      setFrom(n);
    } else {
      if (n === from) setFrom(to);
      setTo(n);
    }
  };
  const subtitle = (r: RevisionSummary) => `${r.quotationNumber} · issued ${when(r.issuedAt)}${r.issuedByName ? ` by ${r.issuedByName}` : ""} · ${money(r.grandTotal)}`;
  const fileName = (r: RevisionSummary) => `${r.quotationNumber}-rev${r.revision}.pdf`;
  const panelHeight = fullscreen ? "h-[calc(100vh-8.5rem)]" : "h-[62vh] lg:h-[72vh]";

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-5 sm:px-6" data-testid="revision-viewer">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/quotation/${quotationId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50">
          <ArrowLeft size={13} aria-hidden /> Back to quotation
        </Link>
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <h1 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-lg font-bold tracking-tight text-gray-950 sm:text-xl">
            <FileClock size={18} className="text-accent" aria-hidden /> Revision history
            {quotationNumber && <span className="font-mono text-sm font-semibold text-gray-500 sm:text-base">{quotationNumber}</span>}
          </h1>
          <p className="text-xs text-gray-500">Every PDF is the original issued with that revision, never regenerated or changed.</p>
        </div>
        {canCompare && (
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1" role="tablist" aria-label="View or compare">
            <button type="button" role="tab" aria-selected={mode === "view"} onClick={() => setView(viewRev?.revision ?? issued[issued.length - 1].revision)} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold", mode === "view" ? "bg-gray-950 text-white" : "text-gray-600 hover:bg-gray-50")} data-testid="mode-view">
              <Eye size={13} aria-hidden /> View one
            </button>
            <button type="button" role="tab" aria-selected={mode === "compare"} onClick={() => setView(null)} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold", mode === "compare" ? "bg-gray-950 text-white" : "text-gray-600 hover:bg-gray-50")} data-testid="mode-compare">
              <Columns2 size={13} aria-hidden /> Compare two
            </button>
          </div>
        )}
      </div>

      {loadError ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">{loadError}</p>
      ) : !list ? (
        <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" aria-hidden /> Loading revisions…</p>
      ) : issued.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">No revision of this quotation has been issued yet. A revision is issued when the quotation is sent.</p>
      ) : mode === "view" ? (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-3 sm:p-4">
            <div className="w-full sm:w-80">
              <Select label="Revision" value={String(viewRev?.revision ?? "")} onChange={(e) => setView(Number(e.target.value))} options={options} ariaLabel="Revision to view" />
            </div>
            {!canCompare && (
              <p className="flex-1 text-xs text-gray-500" data-testid="compare-unavailable">
                Comparison needs at least two issued revisions. This quotation has only Revision {issued[0].revision}; create and issue a revision to compare.
              </p>
            )}
          </div>
          {viewRev && (
            <>
              {viewRev.reason && <p className="text-xs text-gray-600">Why this revision: {viewRev.reason}</p>}
              <RevisionPdfPanel key={viewRev.revision} quotationId={quotationId} revision={viewRev.revision} title={`Rev ${viewRev.revision}${viewRev.current ? " · Current" : " · Superseded"}`} subtitle={subtitle(viewRev)} fileName={fileName(viewRev)} bodyClassName="h-[72vh]" />
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-3 sm:gap-3 sm:p-4" data-testid="compare-pickers">
            <div className="min-w-0 flex-1 sm:max-w-80">
              <Select label="Compare" value={String(from ?? "")} onChange={(e) => pick("from", e.target.value)} options={options} ariaLabel="First revision" />
            </div>
            <button type="button" onClick={() => { setFrom(to); setTo(from); }} className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50" aria-label="Swap the two revisions" data-testid="compare-swap">
              <ArrowLeftRight size={15} aria-hidden />
            </button>
            <div className="min-w-0 flex-1 sm:max-w-80">
              <Select label="With" value={String(to ?? "")} onChange={(e) => pick("to", e.target.value)} options={options} ariaLabel="Second revision" />
            </div>
          </div>

          {compareError ? (
            <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">{compareError}</p>
          ) : !comparison || !fromRev || !toRev ? (
            <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" aria-hidden /> Comparing…</p>
          ) : (
            <RevisionChanges comparison={comparison} fromLabel={`Rev ${fromRev.revision}`} toLabel={`Rev ${toRev.revision}`} />
          )}

          {fromRev && toRev && (
            <div ref={stageRef} className={cn("space-y-3", fullscreen && "overflow-auto bg-gray-50 p-4")} data-testid="compare-stage">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 lg:hidden" role="tablist" aria-label="Which PDF">
                  {(["from", "to"] as const).map((side) => {
                    const r = side === "from" ? fromRev : toRev;
                    return (
                      <button key={side} type="button" role="tab" aria-selected={mobileTab === side} onClick={() => setMobileTab(side)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", mobileTab === side ? "bg-gray-950 text-white" : "text-gray-600")} data-testid={`mobile-tab-${side}`}>
                        Rev {r.revision}
                      </button>
                    );
                  })}
                </div>
                <p className="hidden text-xs text-gray-500 lg:block">Each side scrolls and zooms on its own.</p>
                <button type="button" onClick={() => void toggleFullscreen()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50" data-testid="compare-fullscreen">
                  {fullscreen ? <Minimize size={13} aria-hidden /> : <Maximize size={13} aria-hidden />} {fullscreen ? "Exit full screen" : "Full screen"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className={cn(mobileTab === "from" ? "block" : "hidden", "lg:block")} data-testid="compare-left">
                  <RevisionPdfPanel key={`from-${fromRev.revision}`} quotationId={quotationId} revision={fromRev.revision} title={`Rev ${fromRev.revision}${fromRev.current ? " · Current" : " · Superseded"}`} subtitle={subtitle(fromRev)} fileName={fileName(fromRev)} bodyClassName={panelHeight} />
                </div>
                <div className={cn(mobileTab === "to" ? "block" : "hidden", "lg:block")} data-testid="compare-right">
                  <RevisionPdfPanel key={`to-${toRev.revision}`} quotationId={quotationId} revision={toRev.revision} title={`Rev ${toRev.revision}${toRev.current ? " · Current" : " · Superseded"}`} subtitle={subtitle(toRev)} fileName={fileName(toRev)} bodyClassName={panelHeight} />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {list && issued.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <Download size={11} aria-hidden /> Downloads save the stored file byte for byte; nothing about an issued revision can be changed from here.
        </p>
      )}
    </div>
  );
}
