"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Download, Loader2, Maximize2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type PdfJs = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

let pdfJsPromise: Promise<PdfJs> | null = null;

/** pdf.js, loaded only in the browser, with its worker started once for the whole page. */
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((lib) => {
      if (!lib.GlobalWorkerOptions.workerPort) {
        lib.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
      }
      return lib;
    });
  }
  return pdfJsPromise;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export interface RevisionPdfPanelProps {
  quotationId: string;
  revision: number;
  /** "Rev 2" etc., shown in the header and used for labels. */
  title: string;
  subtitle?: string;
  fileName: string;
  /** Extra classes for the scrolling page area (its height). */
  bodyClassName?: string;
}

/**
 * One issued revision's ORIGINAL PDF, exactly as stored when it was issued: the bytes come from the revision's PDF endpoint
 * (which checks the viewer may see the quotation) and are drawn page by page with pdf.js. Nothing is re-generated, annotated or
 * changed; Download saves those same bytes. Each panel scrolls and zooms on its own.
 */
export default function RevisionPdfPanel({ quotationId, revision, title, subtitle, fileName, bodyClassName }: RevisionPdfPanelProps) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  // The stored PDF, through the access-checked endpoint.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<PdfJs["getDocument"]> | null = null;
    setBytes(null);
    setDoc(null);
    setError(null);
    (async () => {
      try {
        const response = await fetch(`/api/quotations/${quotationId}/revisions/${revision}/pdf`, { credentials: "same-origin", headers: { "x-skip-api-loader": "true" } });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(response.status === 404 ? "No PDF was stored when this revision was issued." : body?.error?.message ?? "The PDF could not be loaded.");
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        setBytes(data);
        const lib = await loadPdfJs();
        // pdf.js takes ownership of the buffer it is given: hand it a copy so Download keeps the original bytes.
        loadingTask = lib.getDocument({ data: data.slice() });
        const loaded = await loadingTask.promise;
        if (cancelled) return;
        setDoc(loaded);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "The PDF could not be loaded.");
      }
    })();
    return () => {
      cancelled = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [quotationId, revision]);

  // The panel's width decides "fit width" (zoom 100%).
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Draw every page at the current zoom (sharp on high-density screens).
  useEffect(() => {
    if (!doc || width === 0) return;
    let cancelled = false;
    const tasks: Array<{ cancel: () => void }> = [];
    setRendering(true);
    (async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let number = 1; number <= doc.numPages && !cancelled; number += 1) {
        const page = await doc.getPage(number);
        const canvas = canvasRefs.current[number - 1];
        if (!canvas || cancelled) continue;
        const base = page.getViewport({ scale: 1 });
        const cssScale = ((width - 24) / base.width) * zoom;
        const viewport = page.getViewport({ scale: cssScale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const task = page.render({ canvas, viewport });
        tasks.push(task);
        try {
          await task.promise;
        } catch {
          // cancelled by a newer zoom or size: the next pass draws it
        }
      }
      if (!cancelled) setRendering(false);
    })();
    return () => {
      cancelled = true;
      for (const task of tasks) task.cancel();
    };
  }, [doc, width, zoom]);

  const download = useCallback(() => {
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [bytes, fileName]);

  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const step = (direction: 1 | -1) => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (zoomIndex < 0 ? 2 : zoomIndex) + direction))]);

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-label={`${title} PDF`} data-testid="revision-pdf-panel" data-revision={revision}>
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gray-950">{title}</p>
          {subtitle && <p className="truncate text-[11px] text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label={`Zoom ${title}`}>
          <button type="button" onClick={() => step(-1)} disabled={!doc || zoom <= ZOOM_STEPS[0]} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40" aria-label={`Zoom out ${title}`} data-testid="pdf-zoom-out">
            <Minus size={14} aria-hidden />
          </button>
          <span className="w-12 text-center text-xs font-semibold tabular-nums text-gray-700" data-testid="pdf-zoom-level">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => step(1)} disabled={!doc || zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40" aria-label={`Zoom in ${title}`} data-testid="pdf-zoom-in">
            <Plus size={14} aria-hidden />
          </button>
          <button type="button" onClick={() => setZoom(1)} disabled={!doc || zoom === 1} className="hidden h-8 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:flex" aria-label={`Fit ${title} to width`}>
            <Maximize2 size={12} aria-hidden /> Fit
          </button>
        </div>
        <button type="button" onClick={download} disabled={!bytes} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-950 px-3 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-40" data-testid="pdf-download">
          <Download size={13} aria-hidden /> Download
        </button>
      </header>
      <div ref={bodyRef} className={cn("relative overflow-auto bg-gray-100/80 p-3", bodyClassName ?? "h-[70vh]")} data-testid="pdf-scroll" tabIndex={0} aria-label={`${title} pages`}>
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center" role="alert" data-testid="pdf-error">
            <AlertCircle size={22} className="text-amber-500" aria-hidden />
            <p className="max-w-xs text-sm font-medium text-gray-700">{error}</p>
          </div>
        ) : !doc ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Loading the original PDF…
          </div>
        ) : (
          <div className="mx-auto flex w-max min-w-full flex-col items-center gap-3">
            {Array.from({ length: doc.numPages }, (_, index) => (
              <canvas
                key={index}
                ref={(element) => {
                  canvasRefs.current[index] = element;
                }}
                className="block bg-white shadow-sm ring-1 ring-black/5"
                aria-label={`${title}, page ${index + 1} of ${doc.numPages}`}
                data-testid="pdf-page"
              />
            ))}
          </div>
        )}
        {rendering && doc && <span className="sr-only" aria-live="polite">Drawing pages…</span>}
      </div>
      {doc && (
        <p className="border-t border-gray-100 px-4 py-1.5 text-[11px] text-gray-500" data-testid="pdf-page-count">
          {doc.numPages} {doc.numPages === 1 ? "page" : "pages"} · the original PDF issued with this revision
        </p>
      )}
    </section>
  );
}
