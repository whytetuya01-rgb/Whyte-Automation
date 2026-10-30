"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Percent, Plus, X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { TAX_LIMITS, formatGstRate, isValidGstRate, type TaxSettingsView } from "@/lib/taxSettings";

interface Props {
  view: TaxSettingsView;
  onSaved: () => void;
}

/**
 * The company's allowed GST rates and the default for new products. Rates are edited as a draft and saved together;
 * a rate that a product or an HSN/SAC code still uses cannot be removed (the API refuses it too).
 */
export default function GstRatesCard({ view, onSaved }: Props) {
  const [rates, setRates] = useState<number[]>(view.gstRates);
  const [defaultRate, setDefaultRate] = useState(view.defaultGstRate);
  const [newRate, setNewRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRates(view.gstRates);
    setDefaultRate(view.defaultGstRate);
  }, [view.gstRates, view.defaultGstRate]);

  const usage = useMemo(() => {
    const byRate = new Map<number, string[]>();
    for (const rate of rates) {
      const products = view.productsByRate[String(rate)] ?? 0;
      const codes = view.hsnCodes.filter((entry) => entry.gstRate === rate).length;
      byRate.set(rate, [products ? `${products} product${products === 1 ? "" : "s"}` : "", codes ? `${codes} HSN/SAC code${codes === 1 ? "" : "s"}` : ""].filter(Boolean));
    }
    return byRate;
  }, [rates, view.productsByRate, view.hsnCodes]);

  const dirty = defaultRate !== view.defaultGstRate || rates.length !== view.gstRates.length || rates.some((rate, index) => rate !== view.gstRates[index]);
  const readOnly = !view.canManage;

  const addRate = (event: FormEvent) => {
    event.preventDefault();
    const rate = Number(newRate.trim());
    if (newRate.trim() === "" || !isValidGstRate(rate)) return setError("Enter a rate between 0 and 100, with at most two decimals.");
    if (rates.includes(rate)) return setError(`${formatGstRate(rate)} is already in the list.`);
    if (rates.length >= TAX_LIMITS.rates) return setError(`Up to ${TAX_LIMITS.rates} GST rates.`);
    setRates([...rates, rate].sort((a, b) => a - b));
    setNewRate("");
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiJson.put("/api/catalog/tax-settings", { gstRates: rates, defaultGstRate: defaultRate });
      notify.success("GST rates saved", `${rates.length} rate${rates.length === 1 ? "" : "s"}; new products start at ${formatGstRate(defaultRate)}.`);
      onSaved();
    } catch (err: unknown) {
      notifyApiError(err, "Unable to save the GST rates", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-2xs" aria-labelledby="gst-rates-title" data-testid="gst-rates-card">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3 sm:px-5">
        <Percent className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 id="gst-rates-title" className="text-sm font-bold text-neutral-900">
          GST rates
        </h2>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <ul className="flex flex-wrap gap-2" aria-label="Allowed GST rates" data-testid="gst-rate-list">
          {rates.map((rate) => {
            const usedBy = usage.get(rate) ?? [];
            const locked = usedBy.length > 0 || rate === defaultRate;
            const why = rate === defaultRate ? "The default rate cannot be removed; choose another default first." : usedBy.length > 0 ? `Used by ${usedBy.join(" and ")}.` : undefined;
            return (
              <li key={rate} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 py-1 pl-3 pr-1 text-sm font-semibold text-neutral-900" data-testid="gst-rate-chip">
                <span>{formatGstRate(rate)}</span>
                {rate === defaultRate && <span className="rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Default</span>}
                {usedBy.length > 0 && <span className="text-[11px] font-medium text-neutral-500">{usedBy.join(" · ")}</span>}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setRates(rates.filter((value) => value !== rate))}
                    disabled={locked || saving}
                    title={why}
                    aria-label={`Remove ${formatGstRate(rate)}${why ? ` (${why})` : ""}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {!readOnly && (
          <div className="grid gap-4 md:grid-cols-2">
            <form onSubmit={addRate} className="space-y-1.5" noValidate>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Add a rate (%)"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={0.01}
                    value={newRate}
                    onChange={(e) => {
                      setNewRate(e.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. 3"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "gst-rate-error" : undefined}
                    data-testid="gst-rate-input"
                  />
                </div>
                <Button type="submit" variant="secondary" leftIcon={<Plus size={14} />} disabled={saving} data-testid="gst-rate-add">
                  Add
                </Button>
              </div>
              {error && (
                <p id="gst-rate-error" role="alert" className="text-xs font-medium text-red-600">
                  {error}
                </p>
              )}
            </form>
            <Select
              label="Default for new products"
              value={String(defaultRate)}
              onChange={(e) => setDefaultRate(Number(e.target.value))}
              options={rates.map((rate) => ({ value: String(rate), label: formatGstRate(rate) }))}
              disabled={saving}
              ariaLabel="Default GST rate for new products"
            />
          </div>
        )}

        {!readOnly && (
          <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={!dirty || saving}
              onClick={() => {
                setRates(view.gstRates);
                setDefaultRate(view.defaultGstRate);
                setError(null);
              }}
            >
              Discard changes
            </Button>
            <Button type="button" variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()} data-testid="gst-rates-save">
              Save GST rates
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
