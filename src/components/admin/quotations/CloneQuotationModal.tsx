"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Info } from "lucide-react";
import Modal from "@/components/shared/Modal";
import { Button, Input, Select } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

export interface CloneSource {
  id: string;
  quotationNumber: string;
  clientName: string;
}

interface CloneQuotationModalProps {
  source: CloneSource | null;
  /** Dealers the clone can be given to. */
  dealerOptions: Array<{ value: string; label: string }>;
  /** Only people who may assign quotations (Admin, Company Owner, Super Admin) get the owner choice. */
  canChooseOwner: boolean;
  onClose: () => void;
}

const KEEP = "keep";
const MINE = "mine";

/**
 * "Clone a quotation": a new draft with a new number, copied from an existing one. The person can rename the client,
 * choose who owns the clone (the original's dealer, themselves, or another dealer) and whether to copy the rooms and
 * items or only the header. Prices are refreshed to the current catalogue and unavailable products are skipped; the
 * original is never changed.
 */
export default function CloneQuotationModal({ source, dealerOptions, canChooseOwner, onClose }: CloneQuotationModalProps) {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [owner, setOwner] = useState(KEEP);
  const [includeRooms, setIncludeRooms] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!source) return;
    setClientName("");
    setOwner(KEEP);
    setIncludeRooms(true);
    setSubmitting(false);
  }, [source]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!source) return;
    setSubmitting(true);
    try {
      const created = await apiJson.post<{ id?: string; _id?: string; skippedItems?: Array<{ label: string }> }>(
        `/api/quotations/${source.id}/duplicate`,
        {
          ...(clientName.trim() ? { clientName: clientName.trim() } : {}),
          includeRooms,
          // Left out = keep the original's dealer; null = keep it for the person cloning; a number = that dealer.
          ...(canChooseOwner && owner === MINE ? { dealerId: null } : {}),
          ...(canChooseOwner && owner !== KEEP && owner !== MINE ? { dealerId: Number(owner) } : {}),
        },
        { fallbackMessage: "Failed to clone the quotation" }
      );
      const newId = created?.id ?? created?._id;
      if (!newId) throw new Error("The quotation was cloned but its id could not be read. Please refresh the list.");
      const skipped = created?.skippedItems ?? [];
      notify.success(
        "Quotation cloned",
        skipped.length > 0 ? `${skipped.length} unavailable product${skipped.length === 1 ? " was" : "s were"} left out.` : `A new draft was created from ${source.quotationNumber}.`
      );
      const skippedParam = skipped.length > 0 ? `?skipped=${encodeURIComponent(skipped.map((s) => s.label).join(","))}` : "";
      onClose();
      router.push(`/quotation/${newId}${skippedParam}`);
    } catch (error) {
      notifyApiError(error, "Could not clone the quotation");
      setSubmitting(false);
    }
  };

  const choice = (active: boolean) =>
    cn(
      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition focus-within:ring-2 focus-within:ring-accent",
      active ? "border-accent bg-accent-light/40" : "border-neutral-200 bg-white hover:border-neutral-300"
    );

  return (
    <Modal isOpen={source !== null} onClose={() => !submitting && onClose()} title={source ? `Clone ${source.quotationNumber}` : "Clone quotation"} size="md">
      <form onSubmit={submit} className="space-y-4" data-testid="clone-form">
        <p className="text-sm text-neutral-600">
          Creates a new draft with a new number from this quotation for <strong className="text-neutral-900">{source?.clientName}</strong>. The original stays exactly as it is.
        </p>

        <Input label="Client name (optional)" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder={source ? `${source.clientName} (Revision)` : ""} className="text-sm" maxLength={160} />

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">What to copy</legend>
          <label className={choice(includeRooms)}>
            <input type="radio" name="clone-scope" checked={includeRooms} onChange={() => setIncludeRooms(true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-semibold text-neutral-900">Rooms and items</span>
              <span className="block text-xs text-neutral-500">Every room with its products and quantities, at today&apos;s catalogue prices.</span>
            </span>
          </label>
          <label className={choice(!includeRooms)}>
            <input type="radio" name="clone-scope" checked={!includeRooms} onChange={() => setIncludeRooms(false)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-semibold text-neutral-900">Header only</span>
              <span className="block text-xs text-neutral-500">Client details, terms and notes. You add the rooms yourself.</span>
            </span>
          </label>
        </fieldset>

        {canChooseOwner && (
          <Select
            label="Owner of the new quotation"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            options={[
              { value: KEEP, label: "Same as the original" },
              { value: MINE, label: "Keep it for myself (no dealer)" },
              ...dealerOptions.map((dealer) => ({ value: dealer.value, label: dealer.label })),
            ]}
          />
        )}

        <p className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Discounts are not copied, history starts fresh, and any product that is no longer available is left out and listed on the new quotation.</span>
        </p>

        <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting} leftIcon={<Copy size={14} />} data-testid="clone-confirm">
            Clone quotation
          </Button>
        </div>
      </form>
    </Modal>
  );
}
