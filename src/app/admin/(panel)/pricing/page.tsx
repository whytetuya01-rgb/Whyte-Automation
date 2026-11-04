"use client";

import { useEffect, useMemo, useState } from "react";
import EmptyState from "@/components/admin/EmptyState";
import useSWR from "swr";
import { History, Info, Percent, Undo2 } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Button, Checkbox, Input } from "@/components/ui";
import CustomDropdown from "@/components/shared/CustomDropdown";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { flattenCategoryTree } from "@/lib/productSpecs";
import { ROUNDINGS, SKIP_REASON_TEXT, ruleProblem, type BulkPriceRule, type SkipReason } from "@/lib/bulkPricing";

interface PreviewRow {
  variantId: number;
  productName: string;
  variantCode: string | null;
  variantName: string | null;
  before: number;
  after: number;
  delta: number;
  deltaPercent: number;
}
interface Preview {
  scopeLabel: string;
  checksum: string;
  summary: { matched: number; changes: number; products: number; skipped: Record<SkipReason, number>; totalBefore: number; totalAfter: number };
  rows: PreviewRow[];
  truncated: boolean;
}
interface Batch {
  _id: string;
  kind: "change" | "revert";
  scopeLabel: string;
  rule: BulkPriceRule | null;
  note: string | null;
  variantsChanged: number;
  variantsSkipped: number;
  createdByName: string | null;
  createdAt: string;
  revertedAt: string | null;
}

const rupees = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const describeRule = (rule: BulkPriceRule) => `${rule.direction === "increase" ? "Increase" : "Decrease"} by ${rule.mode === "percent" ? `${rule.value}%` : rupees(rule.value)}, rounded ${rule.rounding === "none" ? "to the paisa" : `to ${rule.rounding === "1" ? "₹1" : "₹10"}`}`;

const FIELD = "mt-1 block w-full";
const FIELD_TRIGGER = "w-full font-normal text-neutral-900";
const DIRECTION_OPTIONS = [{ value: "increase", label: "Increase" }, { value: "decrease", label: "Decrease" }];
const MODE_OPTIONS = [{ value: "percent", label: "Percent (%)" }, { value: "amount", label: "Amount (₹)" }];
const ROUNDING_OPTIONS = ROUNDINGS.map((option) => ({ value: option, label: option === "none" ? "Not at all (to the paisa)" : option === "1" ? "To the nearest ₹1" : "To the nearest ₹10" }));

/**
 * Bulk pricing (#3, batch 5): raise or lower catalogue prices for everything, some categories or some products, by a
 * percentage or a fixed amount, rounded to the rupee or ten rupees. Always previewed first. Only catalogue prices change:
 * quotations already issued keep the prices they were issued at. Every change is recorded and can be undone.
 */
export default function BulkPricingPage() {
  const confirm = useConfirm();
  const [all, setAll] = useState(true);
  const [categoryIds, setCategoryIds] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<BulkPriceRule["mode"]>("percent");
  const [direction, setDirection] = useState<BulkPriceRule["direction"]>("increase");
  const [value, setValue] = useState("");
  const [rounding, setRounding] = useState<BulkPriceRule["rounding"]>("10");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Array<{ id: number; parentId: number | null; name?: string }>>([]);
  useEffect(() => {
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCategories(flattenCategoryTree(Array.isArray(data) ? data : [])))
      .catch(() => undefined);
  }, []);
  const depthOf = useMemo(() => {
    const byId = new Map(categories.map((category) => [category.id, category]));
    return (id: number) => {
      let depth = 0;
      for (let node = byId.get(id); node && node.parentId !== null && depth < 10; node = byId.get(node.parentId)) depth += 1;
      return depth;
    };
  }, [categories]);

  const { data: history, mutate: refreshHistory, isLoading: historyLoading } = useSWR<{ batches: Batch[]; total: number }>("/api/catalog/bulk-pricing/history", (url: string) => apiJson.get<{ batches: Batch[]; total: number }>(url), { revalidateOnFocus: false });

  const numericValue = Number(value);
  const rule: BulkPriceRule = { mode, direction, value: numericValue, rounding };
  const problem = value.trim() === "" ? null : ruleProblem(rule);
  const scope = all ? { all: true } : { categoryIds: [...categoryIds] };
  const scopeReady = all || categoryIds.size > 0;
  const canPreview = scopeReady && value.trim() !== "" && !problem && busy === null;

  const changed = () => {
    setPreview(null);
    setError(null);
  };

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await apiJson.post<Preview>("/api/catalog/bulk-pricing/preview", { scope, rule }));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "Could not preview the change.");
    } finally {
      setBusy(null);
    }
  };

  const runApply = async () => {
    if (!preview) return;
    const ok = await confirm({
      title: `Change ${preview.summary.changes} price${preview.summary.changes === 1 ? "" : "s"}?`,
      message: `${describeRule(rule)} for ${preview.scopeLabel.toLowerCase()}. Quotations already issued keep their prices. You can undo this from the history below.`,
      confirmText: "Change prices",
    });
    if (!ok) return;
    setBusy("apply");
    try {
      const result = await apiJson.post<{ changed: number }>("/api/catalog/bulk-pricing/apply", { scope, rule, checksum: preview.checksum, note: note.trim() || undefined });
      notify.success("Prices changed", `${result.changed} price${result.changed === 1 ? "" : "s"} updated.`);
      setPreview(null);
      setValue("");
      setNote("");
      await refreshHistory();
    } catch (err) {
      notifyApiError(err, "Could not change the prices");
      setPreview(null); // a stale preview must be run again
    } finally {
      setBusy(null);
    }
  };

  const revert = async (batch: Batch) => {
    const ok = await confirm({
      title: "Undo this price change?",
      message: `Prices that are still exactly what this change set go back to what they were. Prices someone has changed since are left alone.`,
      confirmText: "Undo",
    });
    if (!ok) return;
    try {
      const result = await apiJson.post<{ restored: number; skipped: number }>(`/api/catalog/bulk-pricing/history/${batch._id}/revert`, {});
      notify.success("Prices restored", `${result.restored} restored${result.skipped ? `, ${result.skipped} left as they are (changed since)` : ""}.`);
      await refreshHistory();
    } catch (err) {
      notifyApiError(err, "Could not undo the change");
    }
  };

  const skippedTotal = preview ? Object.values(preview.summary.skipped).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Bulk pricing" icon={Percent} subtitle="Raise or lower catalogue prices for many products at once." />

      <div className="flex gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700" data-testid="pricing-note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <p>
          Prices include GST and the GST rate never changes. You always see the result before anything is saved. <strong className="font-semibold text-neutral-900">Quotations already issued keep the prices they were issued at</strong>; only new quotations use the new prices.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-5" aria-label="What to change">
          <div>
            <h2 className="text-sm font-bold text-neutral-900">1. What to change</h2>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm text-neutral-800">
                <input type="radio" name="scope" checked={all} onChange={() => { setAll(true); changed(); }} className="accent-black" data-testid="pricing-scope-all" /> All products
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-800">
                <input type="radio" name="scope" checked={!all} onChange={() => { setAll(false); changed(); }} className="accent-black" data-testid="pricing-scope-categories" /> Chosen categories (and their sub-categories)
              </label>
              {!all && (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-50/60 p-2" data-testid="pricing-categories">
                  {categories.length === 0 ? (
                    <p className="p-2 text-xs text-neutral-500">No categories yet.</p>
                  ) : (
                    categories.map((category) => (
                      <div key={category.id} style={{ paddingLeft: depthOf(category.id) * 16 }}>
                        <Checkbox
                          label={category.name ?? `Category ${category.id}`}
                          checked={categoryIds.has(category.id)}
                          onChange={(event) => {
                            setCategoryIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(category.id);
                              else next.delete(category.id);
                              return next;
                            });
                            changed();
                          }}
                          data-testid={`pricing-category-${category.id}`}
                        />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-bold text-neutral-900">2. How much</h2>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="text-xs font-semibold text-neutral-700">
                <span>Change</span>
                <CustomDropdown value={direction} onChange={(next) => { setDirection(next as BulkPriceRule["direction"]); changed(); }} options={DIRECTION_OPTIONS} ariaLabel="Increase or decrease" testId="pricing-direction" className={FIELD} triggerClassName={FIELD_TRIGGER} />
              </div>
              <div className="text-xs font-semibold text-neutral-700">
                <span>By</span>
                <CustomDropdown value={mode} onChange={(next) => { setMode(next as BulkPriceRule["mode"]); changed(); }} options={MODE_OPTIONS} ariaLabel="Change by percent or amount" testId="pricing-mode" className={FIELD} triggerClassName={FIELD_TRIGGER} />
              </div>
              <div className="col-span-2">
                <Input
                  label={mode === "percent" ? "Percentage" : "Amount in rupees"}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={value}
                  onChange={(e) => { setValue(e.target.value); changed(); }}
                  placeholder={mode === "percent" ? "e.g. 5" : "e.g. 100"}
                  error={problem ?? undefined}
                  data-testid="pricing-value"
                />
              </div>
              <div className="col-span-2 text-xs font-semibold text-neutral-700">
                <span>Round the new price</span>
                <CustomDropdown value={rounding} onChange={(next) => { setRounding(next as BulkPriceRule["rounding"]); changed(); }} options={ROUNDING_OPTIONS} ariaLabel="Round the new price" testId="pricing-rounding" className={FIELD} triggerClassName={FIELD_TRIGGER} />
              </div>
              <div className="col-span-2">
                <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Festival price list" data-testid="pricing-note-input" />
              </div>
            </div>
          </div>

          <Button type="button" variant="primary" onClick={() => void runPreview()} disabled={!canPreview} loading={busy === "preview"} data-testid="pricing-preview">
            3. Preview the change
          </Button>
          {!scopeReady && <p className="text-xs text-amber-700">Choose at least one category.</p>}
        </section>

        <section className="min-w-0 space-y-4 rounded-2xl border border-neutral-200 bg-white p-5" aria-label="Preview" aria-live="polite">
          <h2 className="text-sm font-bold text-neutral-900">Preview</h2>
          {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="pricing-error">{error}</p>}
          {!preview && !error && <p className="text-sm text-neutral-500" data-testid="pricing-preview-empty">Choose what to change and how much, then preview. Nothing is saved until you confirm.</p>}
          {preview && (
            <>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm" data-testid="pricing-preview-summary">
                <p className="font-semibold text-neutral-900">{describeRule(rule)}</p>
                <p className="mt-1 text-neutral-700">
                  {preview.scopeLabel}: <strong>{preview.summary.changes}</strong> price{preview.summary.changes === 1 ? "" : "s"} across {preview.summary.products} product{preview.summary.products === 1 ? "" : "s"} would change
                  {skippedTotal > 0 ? `, ${skippedTotal} left as they are` : ""}.
                </p>
                {preview.summary.changes > 0 && (
                  <p className="mt-1 text-xs text-neutral-500">Total of the changed prices: {rupees(preview.summary.totalBefore)} → {rupees(preview.summary.totalAfter)}</p>
                )}
                {skippedTotal > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-neutral-600" data-testid="pricing-skipped">
                    {(Object.keys(preview.summary.skipped) as SkipReason[]).filter((reason) => preview.summary.skipped[reason] > 0).map((reason) => (
                      <li key={reason}>{preview.summary.skipped[reason]} {SKIP_REASON_TEXT[reason]}</li>
                    ))}
                  </ul>
                )}
              </div>

              {preview.rows.length > 0 && (
                <div className="max-h-[420px] overflow-auto rounded-xl border border-neutral-200">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="sticky top-0 bg-neutral-900 text-[10px] uppercase tracking-wider text-white">
                      <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Variant</th><th className="px-3 py-2 text-right">Now</th><th className="px-3 py-2 text-right">New</th><th className="px-3 py-2 text-right">Change</th></tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {preview.rows.map((row) => (
                        <tr key={row.variantId} data-testid="pricing-preview-row">
                          <td className="px-3 py-2 font-medium text-neutral-900">{row.productName}</td>
                          <td className="px-3 py-2 text-neutral-600">{row.variantCode ?? row.variantName ?? `#${row.variantId}`}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{rupees(row.before)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{rupees(row.after)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${row.delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.delta >= 0 ? "+" : ""}{rupees(row.delta)} ({row.deltaPercent >= 0 ? "+" : ""}{row.deltaPercent}%)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.truncated && <p className="text-xs text-neutral-500">Showing the first {preview.rows.length}. All {preview.summary.changes} will change.</p>}

              <Button type="button" variant="primary" onClick={() => void runApply()} disabled={preview.summary.changes === 0 || busy !== null} loading={busy === "apply"} data-testid="pricing-apply">
                4. Change {preview.summary.changes} price{preview.summary.changes === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5" aria-label="Price change history">
        <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900"><History className="h-4 w-4" aria-hidden /> Price change history</h2>
        {historyLoading && !history ? (
          <div className="py-8"><LoadingSpinner /></div>
        ) : !history || history.batches.length === 0 ? (
          <EmptyState compact icon={History} title="No bulk price changes yet." text="Each bulk change is listed here with what it changed, and can be undone." data-testid="pricing-history-empty" />
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100" data-testid="pricing-history">
            {history.batches.map((batch) => (
              <li key={batch._id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="pricing-history-row" data-kind={batch.kind}>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-neutral-900">
                    {batch.kind === "revert" ? "Undo" : batch.rule ? describeRule(batch.rule) : "Price change"}
                    {batch.revertedAt && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase text-neutral-600">Undone</span>}
                  </p>
                  <p className="text-xs text-neutral-600">{batch.scopeLabel} · {batch.variantsChanged} price{batch.variantsChanged === 1 ? "" : "s"}{batch.variantsSkipped ? `, ${batch.variantsSkipped} left alone` : ""}</p>
                  <p className="text-xs text-neutral-500">{when(batch.createdAt)}{batch.createdByName ? ` · ${batch.createdByName}` : ""}{batch.note ? ` · “${batch.note}”` : ""}</p>
                </div>
                {batch.kind === "change" && !batch.revertedAt && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => void revert(batch)} data-testid="pricing-revert"><Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Undo</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
