"use client";

import { useState } from "react";
import useSWR from "swr";
import { Info, Receipt } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import GstRatesCard from "@/components/admin/tax/GstRatesCard";
import HsnCodesCard from "@/components/admin/tax/HsnCodesCard";
import HsnCodeModal from "@/components/admin/tax/HsnCodeModal";
import { apiJson, toErrorMessage } from "@/lib/apiClient";
import type { HsnSacCode, TaxSettingsView } from "@/lib/taxSettings";

/**
 * GST & HSN/SAC (#3, batch 2): the company's allowed GST rates and its HSN/SAC codes. Products pick from these on the
 * product form. Catalogue prices stay GST-inclusive, so nothing here changes a price or an existing quotation.
 */
export default function TaxSettingsPage() {
  const { data, error, isLoading, mutate } = useSWR<TaxSettingsView>("/api/catalog/tax-settings", (url: string) => apiJson.get<TaxSettingsView>(url), {
    revalidateOnFocus: false,
  });
  const [modalTarget, setModalTarget] = useState<HsnSacCode | "new" | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="GST & HSN/SAC" icon={Receipt} subtitle="GST rates and HSN/SAC codes your products use." />

      <div className="flex gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700" data-testid="tax-inclusive-note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <p>
          Your catalogue prices <strong className="font-semibold text-neutral-900">include GST</strong>. A product&apos;s GST rate only splits its price into price
          without tax and tax; it never changes the price or any existing quotation. The Service &amp; Integration charge on quotations is separate and is not affected.
        </p>
      </div>

      {isLoading && !data ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : error || !data ? (
        <div role="alert" className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-700" data-testid="tax-settings-error">
          {toErrorMessage(error, "The GST settings could not be loaded. Please try again.")}
        </div>
      ) : (
        <>
          {!data.canManage && <p className="text-xs text-neutral-500">You can view these settings; editing needs catalogue edit access.</p>}
          <GstRatesCard view={data} onSaved={() => void mutate()} />
          <HsnCodesCard view={data} onAdd={() => setModalTarget("new")} onEdit={setModalTarget} onChanged={() => void mutate()} />
          <HsnCodeModal target={modalTarget} gstRates={data.gstRates} defaultGstRate={data.defaultGstRate} onClose={() => setModalTarget(null)} onSaved={() => void mutate()} />
        </>
      )}
    </div>
  );
}
