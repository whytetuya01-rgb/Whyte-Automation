"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/shared/Modal";
import { Button, Input, RadioGroup, Select, Switch } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { TAX_CODE_HINTS, TAX_LIMITS, formatGstRate, isValidTaxCode, type HsnSacCode, type TaxCodeKind } from "@/lib/taxSettings";

interface Props {
  /** null = closed; "new" = add a code; an entry = edit it. */
  target: HsnSacCode | "new" | null;
  gstRates: number[];
  defaultGstRate: number;
  onClose: () => void;
  onSaved: () => void;
}

interface Draft {
  kind: TaxCodeKind;
  code: string;
  description: string;
  gstRate: number;
  isActive: boolean;
}

/** Add or edit one HSN/SAC code. The code and its kind are fixed once added (products refer to the code). */
export default function HsnCodeModal({ target, gstRates, defaultGstRate, onClose, onSaved }: Props) {
  const editing = target !== null && target !== "new" ? target : null;
  const [draft, setDraft] = useState<Draft>({ kind: "hsn", code: "", description: "", gstRate: defaultGstRate, isActive: true });
  const [codeError, setCodeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target === null) return;
    setDraft(
      editing
        ? { kind: editing.kind, code: editing.code, description: editing.description ?? "", gstRate: editing.gstRate, isActive: editing.isActive }
        : { kind: "hsn", code: "", description: "", gstRate: defaultGstRate, isActive: true }
    );
    setCodeError(null);
  }, [target, editing, defaultGstRate]);

  const rateOptions = [...new Set([...gstRates, ...(editing ? [editing.gstRate] : [])])]
    .sort((a, b) => a - b)
    .map((rate) => ({ value: String(rate), label: formatGstRate(rate), disabled: !gstRates.includes(rate) }));

  const save = async () => {
    const code = draft.code.trim();
    if (!editing && !isValidTaxCode(draft.kind, code)) {
      setCodeError(`${draft.kind === "sac" ? "A SAC" : "An HSN"} code is ${TAX_CODE_HINTS[draft.kind]}.`);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiJson.patch(`/api/catalog/tax-settings/hsn-codes/${encodeURIComponent(editing.code)}`, {
          description: draft.description,
          gstRate: draft.gstRate,
          isActive: draft.isActive,
        });
        notify.success("Code updated", `${editing.code} saved.`);
      } else {
        await apiJson.post("/api/catalog/tax-settings/hsn-codes", { kind: draft.kind, code, description: draft.description, gstRate: draft.gstRate, isActive: draft.isActive });
        notify.success("Code added", `${code} can now be picked on products.`);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      notifyApiError(err, editing ? "Unable to update the code" : "Unable to add the code", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={target !== null} onClose={onClose} title={editing ? `Edit ${editing.kind.toUpperCase()} ${editing.code}` : "Add HSN/SAC code"} size="lg">
      <form
        className="space-y-5"
        data-testid="hsn-code-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <RadioGroup
          label="Type"
          name="hsn-kind"
          orientation="horizontal"
          value={draft.kind}
          onChange={(value) => {
            setDraft({ ...draft, kind: value as TaxCodeKind });
            setCodeError(null);
          }}
          options={[
            { value: "hsn", label: "HSN", description: "Goods", disabled: Boolean(editing) },
            { value: "sac", label: "SAC", description: "Services", disabled: Boolean(editing) },
          ]}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Code"
            value={draft.code}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            disabled={Boolean(editing) || saving}
            onChange={(e) => {
              setDraft({ ...draft, code: e.target.value.replace(/\D/g, "") });
              setCodeError(null);
            }}
            placeholder={draft.kind === "sac" ? "998713" : "8536"}
            helperText={editing ? "The code cannot change once added." : TAX_CODE_HINTS[draft.kind]}
            error={codeError ?? undefined}
            data-testid="hsn-code-input"
          />
          <Select
            label="GST rate"
            value={String(draft.gstRate)}
            onChange={(e) => setDraft({ ...draft, gstRate: Number(e.target.value) })}
            options={rateOptions}
            disabled={saving}
            helperText="Pre-selected when a product picks this code."
            ariaLabel="GST rate for this code"
          />
        </div>

        <Input
          label="Description"
          value={draft.description}
          maxLength={TAX_LIMITS.description}
          disabled={saving}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder={draft.kind === "sac" ? "e.g. Installation services" : "e.g. Electrical switches and sockets"}
          data-testid="hsn-description-input"
        />

        <Switch
          checked={draft.isActive}
          onChange={(checked) => setDraft({ ...draft, isActive: checked })}
          label="Active"
          description="Inactive codes stay on the products that already use them but cannot be newly picked."
          disabled={saving}
        />

        <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} data-testid="hsn-code-save">
            {editing ? "Save code" : "Add code"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
