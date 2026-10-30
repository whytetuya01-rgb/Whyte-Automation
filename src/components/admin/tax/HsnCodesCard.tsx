"use client";

import { useMemo, useState } from "react";
import { FileDigit, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { formatGstRate, type HsnSacCode, type TaxSettingsView } from "@/lib/taxSettings";

type Row = TaxSettingsView["hsnCodes"][number];

interface Props {
  view: TaxSettingsView;
  onAdd: () => void;
  onEdit: (entry: HsnSacCode) => void;
  onChanged: () => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The company's HSN/SAC codes: a table on wide screens, cards on phones. */
export default function HsnCodesCard({ view, onAdd, onEdit, onChanged }: Props) {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...view.hsnCodes]
      .sort((a, b) => a.code.localeCompare(b.code))
      .filter((row) => !needle || row.code.includes(needle) || (row.description ?? "").toLowerCase().includes(needle));
  }, [view.hsnCodes, query]);

  const apply = async (row: Row) => {
    const ok = await confirm({
      title: `Apply ${formatGstRate(row.gstRate)} to ${plural(row.productCount, "product")}?`,
      message: `Every product with ${row.kind.toUpperCase()} ${row.code} gets ${formatGstRate(row.gstRate)}. Their prices stay exactly the same (they include GST); only the split into price without tax and tax changes.`,
      detail: "Existing quotations are not affected.",
      confirmText: "Apply rate",
      variant: "primary",
    });
    if (!ok) return;
    setBusyCode(row.code);
    try {
      const result = await apiJson.post<{ products: number; variants: number; changed: number }>(`/api/catalog/tax-settings/hsn-codes/${encodeURIComponent(row.code)}/apply`);
      notify.success("GST rate applied", `${plural(result.products, "product")}, ${plural(result.changed, "variant")} updated. No price changed.`);
      onChanged();
    } catch (err: unknown) {
      notifyApiError(err, "Unable to apply the rate", "Please try again.");
    } finally {
      setBusyCode(null);
    }
  };

  const remove = async (row: Row) => {
    const ok = await confirm({ title: `Remove ${row.kind.toUpperCase()} ${row.code}?`, message: "It will no longer be available for products.", confirmText: "Remove" });
    if (!ok) return;
    setBusyCode(row.code);
    try {
      await apiJson.delete(`/api/catalog/tax-settings/hsn-codes/${encodeURIComponent(row.code)}`);
      notify.success("Code removed", `${row.code} was removed.`);
      onChanged();
    } catch (err: unknown) {
      notifyApiError(err, "Unable to remove the code", "Please try again.");
    } finally {
      setBusyCode(null);
    }
  };

  const actions = (row: Row) => {
    if (!view.canManage) return null;
    const busy = busyCode === row.code;
    const iconButton = "inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
    return (
      <div className="flex items-center justify-end gap-1">
        <button type="button" className={iconButton} onClick={() => onEdit(row)} disabled={busy} aria-label={`Edit ${row.code}`} title="Edit">
          <Pencil size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={iconButton}
          onClick={() => void apply(row)}
          disabled={busy || row.productCount === 0}
          aria-label={`Apply ${formatGstRate(row.gstRate)} to products with ${row.code}`}
          title={row.productCount === 0 ? "No product uses this code yet" : `Apply ${formatGstRate(row.gstRate)} to ${plural(row.productCount, "product")}`}
          data-testid="hsn-apply"
        >
          <RefreshCw size={15} aria-hidden="true" className={busy ? "animate-spin" : undefined} />
        </button>
        <button
          type="button"
          className={`${iconButton} hover:text-red-600`}
          onClick={() => void remove(row)}
          disabled={busy || row.productCount > 0}
          aria-label={`Remove ${row.code}`}
          title={row.productCount > 0 ? `Used by ${plural(row.productCount, "product")}: deactivate it instead` : "Remove"}
          data-testid="hsn-remove"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
    );
  };

  const status = (row: Row) => (row.isActive ? <Badge variant="success" size="sm">Active</Badge> : <Badge variant="secondary" size="sm">Inactive</Badge>);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-2xs" aria-labelledby="hsn-codes-title" data-testid="hsn-codes-card">
      <div className="flex flex-col gap-3 border-b border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-center gap-2">
          <FileDigit className="h-4 w-4 text-accent" aria-hidden="true" />
          <h2 id="hsn-codes-title" className="text-sm font-bold text-neutral-900">
            HSN/SAC codes
          </h2>
          <span className="text-xs text-neutral-500">
            {plural(view.hsnCodes.length, "code")} · {view.unclassifiedProducts} of {view.totalProducts} products without a code
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="sm:w-56">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search code or description" aria-label="Search HSN/SAC codes" leftIcon={<Search size={14} />} />
          </div>
          {view.canManage && (
            <Button type="button" variant="primary" leftIcon={<Plus size={14} />} onClick={onAdd} data-testid="hsn-add">
              Add code
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-neutral-500 sm:px-5" data-testid="hsn-empty">
          {view.hsnCodes.length === 0 ? "No HSN/SAC codes yet. Add the codes your products use, for example 8536 for switches and sockets." : "No code matches your search."}
        </p>
      ) : (
        <>
          <div className="hidden md:block">
            <table className="w-full text-left text-sm" data-testid="hsn-table">
              <thead className="border-b border-neutral-100 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                <tr>
                  <th scope="col" className="px-5 py-2.5">Code</th>
                  <th scope="col" className="px-3 py-2.5">Description</th>
                  <th scope="col" className="px-3 py-2.5">GST</th>
                  <th scope="col" className="px-3 py-2.5">Products</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
                  {view.canManage && <th scope="col" className="px-5 py-2.5 text-right"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((row) => (
                  <tr key={row.code} data-testid="hsn-row">
                    <td className="whitespace-nowrap px-5 py-3">
                      <span className="font-mono font-semibold text-neutral-900">{row.code}</span>
                      <span className="ml-2 text-[10px] font-semibold uppercase text-neutral-500">{row.kind}</span>
                    </td>
                    <td className="max-w-xs px-3 py-3 text-neutral-700">{row.description ?? <span className="text-neutral-400">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-neutral-900">{formatGstRate(row.gstRate)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-neutral-700">{row.productCount}</td>
                    <td className="px-3 py-3">{status(row)}</td>
                    {view.canManage && <td className="px-5 py-1.5">{actions(row)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-neutral-100 md:hidden" data-testid="hsn-cards">
            {rows.map((row) => (
              <li key={row.code} className="space-y-2 px-4 py-3" data-testid="hsn-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-neutral-900">
                      {row.code} <span className="font-sans text-[10px] font-semibold uppercase text-neutral-500">{row.kind}</span>
                    </p>
                    {row.description && <p className="break-words text-sm text-neutral-600">{row.description}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-bold text-neutral-900">{formatGstRate(row.gstRate)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    {status(row)}
                    <span>{plural(row.productCount, "product")}</span>
                  </div>
                  {actions(row)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
