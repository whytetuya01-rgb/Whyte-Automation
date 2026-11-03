"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, Upload } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import { Button } from "@/components/ui";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import notify from "@/lib/notify";

interface Issue {
  row: number;
  column: string;
  message: string;
}
interface PreviewRow {
  row: number;
  productCode: string;
  productName: string;
  variantCode: string;
  action: "create" | "update" | "unchanged";
  productAction: "create" | "update" | "unchanged";
  changes: string[];
}
interface Preview {
  fileErrors: string[];
  ignoredColumns: string[];
  planHash: string | null;
  summary: { rows: number; productsToCreate: number; productsToUpdate: number; variantsToCreate: number; variantsToUpdate: number; unchanged: number; priceChanges: number; errors: number };
  rows: PreviewRow[];
  truncatedRows: boolean;
  issues: Issue[];
  truncatedIssues: boolean;
  failedProducts: string[];
  canApply: boolean;
}
interface Result {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  priceChanges: number;
  skippedProducts: string[];
}

const ACTION_LABEL = { create: "New", update: "Update", unchanged: "No change" } as const;

async function call<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const res = await fetch(path, { method: "POST", body: form });
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!res.ok || !body?.data) throw new Error(body?.error?.message ?? "The request failed. Please try again.");
  return body.data;
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

/** An error report people can open in Excel and fix against: row, column, what is wrong. */
function downloadErrorReport(issues: Issue[], fileErrors: string[]) {
  const lines = ["Row,Column,Problem", ...fileErrors.map((message) => `,,${csvCell(message)}`), ...issues.map((issue) => `${issue.row},${csvCell(issue.column)},${csvCell(issue.message)}`)];
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "catalogue-import-errors.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Catalogue import / export (#3, batch 7). Export the catalogue to Excel, change it there, import it back: products and variants
 * are matched by code, you see exactly what would change (and every problem row) before anything is saved, and price changes
 * go into the price history so they can be undone. Nothing is ever deleted and issued quotations never change.
 */
export default function ImportExportPage() {
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const choose = (next: File | null) => {
    setFile(next);
    reset();
  };

  const runPreview = async () => {
    if (!file) return;
    setBusy("preview");
    reset();
    try {
      setPreview(await call<Preview>("/api/catalog/import/preview", file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file.");
    } finally {
      setBusy(null);
    }
  };

  const runApply = async () => {
    if (!file || !preview?.planHash) return;
    const { summary } = preview;
    const ok = await confirm({
      title: "Import these changes?",
      message: `${summary.productsToCreate} new product${summary.productsToCreate === 1 ? "" : "s"}, ${summary.variantsToCreate} new variant${summary.variantsToCreate === 1 ? "" : "s"}, ${summary.variantsToUpdate} variant${summary.variantsToUpdate === 1 ? "" : "s"} updated (${summary.priceChanges} price change${summary.priceChanges === 1 ? "" : "s"}).${preview.failedProducts.length > 0 ? ` ${preview.failedProducts.length} product${preview.failedProducts.length === 1 ? "" : "s"} with problems will be skipped.` : ""} Nothing is deleted and issued quotations keep their prices.`,
      confirmText: "Import",
    });
    if (!ok) return;
    setBusy("apply");
    try {
      const done = await call<Result>("/api/catalog/import/apply", file, { planHash: preview.planHash });
      setResult(done);
      setPreview(null);
      notify.success("Catalogue imported", `${done.productsCreated} created, ${done.productsUpdated} updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import failed.");
      setPreview(null); // a stale preview must be run again
    } finally {
      setBusy(null);
    }
  };

  const s = preview?.summary;
  return (
    <div className="space-y-6">
      <PageHeader title="Import / Export" icon={FileSpreadsheet} subtitle="Move your catalogue to and from Excel." />

      <div className="flex gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700" data-testid="import-note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <p>
          One row per <strong className="font-semibold text-neutral-900">variant</strong>. Products and variants are matched by <strong className="font-semibold text-neutral-900">code</strong>; a new code creates one. A blank cell leaves an existing value as it is.
          You see everything that would change before anything is saved. <strong className="font-semibold text-neutral-900">Nothing is deleted, and quotations already issued keep their prices.</strong>
        </p>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5" aria-label="Export">
        <h2 className="text-sm font-bold text-neutral-900">1. Export</h2>
        <p className="mt-1 text-xs text-neutral-500">Your whole catalogue, ready to edit. Or start from an empty template with a help sheet.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/catalog/export" className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black" data-testid="export-catalogue">
            <Download className="h-4 w-4" aria-hidden /> Download catalogue (.xlsx)
          </a>
          <a href="/api/catalog/import/template" className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50" data-testid="export-template">
            <Download className="h-4 w-4" aria-hidden /> Download empty template
          </a>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5" aria-label="Import">
        <div>
          <h2 className="text-sm font-bold text-neutral-900">2. Import</h2>
          <p className="mt-1 text-xs text-neutral-500">Choose your edited Excel file (.xlsx, up to 5 MB), then preview.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => choose(e.target.files?.[0] ?? null)} data-testid="import-file" />
          <Button type="button" variant="secondary" onClick={() => input.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" aria-hidden /> Choose file
          </Button>
          <span className="min-w-0 truncate text-sm text-neutral-600" data-testid="import-filename">{file ? file.name : "No file chosen"}</span>
          <Button type="button" variant="primary" onClick={() => void runPreview()} disabled={!file || busy !== null} loading={busy === "preview"} data-testid="import-preview">
            Preview import
          </Button>
        </div>

        {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="import-error">{error}</p>}

        {result && (
          <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status" data-testid="import-result">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Imported.</p>
              <p>{result.productsCreated} product{result.productsCreated === 1 ? "" : "s"} created, {result.productsUpdated} updated; {result.variantsCreated} variant{result.variantsCreated === 1 ? "" : "s"} created, {result.variantsUpdated} updated; {result.priceChanges} price change{result.priceChanges === 1 ? "" : "s"} (see Bulk Pricing history to undo).</p>
              {result.skippedProducts.length > 0 && <p className="mt-1">Skipped because of problems: {result.skippedProducts.join(", ")}.</p>}
            </div>
          </div>
        )}

        {preview && s && (
          <div className="space-y-4" data-testid="import-preview-result">
            {preview.fileErrors.length > 0 && (
              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="import-file-errors">
                <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden /> This file cannot be imported</p>
                <ul className="mt-1 list-disc pl-5">{preview.fileErrors.map((message) => <li key={message}>{message}</li>)}</ul>
              </div>
            )}
            {preview.fileErrors.length === 0 && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm" data-testid="import-summary">
                <p className="font-semibold text-neutral-900">{s.rows} row{s.rows === 1 ? "" : "s"} read</p>
                <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-neutral-700 sm:grid-cols-2">
                  <li>{s.productsToCreate} new product{s.productsToCreate === 1 ? "" : "s"}</li>
                  <li>{s.productsToUpdate} product{s.productsToUpdate === 1 ? "" : "s"} to update</li>
                  <li>{s.variantsToCreate} new variant{s.variantsToCreate === 1 ? "" : "s"}</li>
                  <li>{s.variantsToUpdate} variant{s.variantsToUpdate === 1 ? "" : "s"} to update ({s.priceChanges} price change{s.priceChanges === 1 ? "" : "s"})</li>
                  <li>{s.unchanged} unchanged</li>
                  <li className={s.errors > 0 ? "font-semibold text-amber-800" : ""}>{s.errors} problem{s.errors === 1 ? "" : "s"}</li>
                </ul>
                {preview.ignoredColumns.length > 0 && <p className="mt-2 text-xs text-neutral-500">Ignored columns: {preview.ignoredColumns.join(", ")}.</p>}
              </div>
            )}

            {preview.issues.length > 0 && (
              <div className="space-y-2" data-testid="import-issues">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-amber-900">
                    Rows with problems{preview.failedProducts.length > 0 ? `: ${preview.failedProducts.length} product${preview.failedProducts.length === 1 ? "" : "s"} will be skipped entirely` : ""}
                  </p>
                  <button type="button" onClick={() => downloadErrorReport(preview.issues, preview.fileErrors)} className="text-xs font-semibold text-neutral-700 underline hover:text-neutral-900" data-testid="import-error-report">
                    Download error report (.csv)
                  </button>
                </div>
                <div className="max-h-64 overflow-auto rounded-xl border border-amber-200">
                  <table className="w-full min-w-[460px] text-left text-xs">
                    <thead className="sticky top-0 bg-amber-100 text-[10px] uppercase tracking-wider text-amber-900"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Column</th><th className="px-3 py-2">Problem</th></tr></thead>
                    <tbody className="divide-y divide-amber-100 bg-white">
                      {preview.issues.map((issue, index) => (
                        <tr key={`${issue.row}-${issue.column}-${index}`} data-testid="import-issue"><td className="px-3 py-2 tabular-nums">{issue.row}</td><td className="px-3 py-2">{issue.column}</td><td className="px-3 py-2">{issue.message}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.truncatedIssues && <p className="text-xs text-neutral-500">Showing the first {preview.issues.length} problems. Fix these and preview again.</p>}
              </div>
            )}

            {preview.rows.length > 0 && (
              <div className="max-h-[420px] overflow-auto rounded-xl border border-neutral-200">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="sticky top-0 bg-neutral-900 text-[10px] uppercase tracking-wider text-white"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Variant</th><th className="px-3 py-2">What happens</th></tr></thead>
                  <tbody className="divide-y divide-neutral-100">
                    {preview.rows.map((row) => (
                      <tr key={row.row} data-testid="import-preview-row" data-action={row.action}>
                        <td className="px-3 py-2 tabular-nums">{row.row}</td>
                        <td className="px-3 py-2"><span className="font-medium text-neutral-900">{row.productName}</span> <span className="font-mono text-neutral-500">{row.productCode}</span></td>
                        <td className="px-3 py-2 font-mono">{row.variantCode}</td>
                        <td className="px-3 py-2 text-neutral-700"><span className="mr-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase">{ACTION_LABEL[row.action]}</span>{row.changes.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.truncatedRows && <p className="text-xs text-neutral-500">Showing the first {preview.rows.length} rows (changes first). Everything in the summary will be imported.</p>}

            <Button type="button" variant="primary" onClick={() => void runApply()} disabled={!preview.canApply || busy !== null} loading={busy === "apply"} data-testid="import-apply">
              3. Import these changes
            </Button>
            {!preview.canApply && preview.fileErrors.length === 0 && <p className="text-xs text-neutral-500">Nothing in this file would change the catalogue.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
