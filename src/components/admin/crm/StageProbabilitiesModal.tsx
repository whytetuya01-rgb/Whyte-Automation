"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { Button } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { CONFIGURABLE_PROBABILITY_STAGES, STAGE_PROBABILITY, type ConfigurableProbabilityStage } from "@/lib/pipelineProbability";
import type { LeadStatus } from "@/types/crm";

const STAGE_LABELS: Record<ConfigurableProbabilityStage, string> = {
  new: "New lead",
  contacted: "Contacted",
  site_visit: "Site visit",
  quoted: "Proposal sent",
  negotiation: "Negotiation",
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  stages: Record<LeadStatus, number>;
  onSaved: () => void;
}

/** Company Owner / Admin: set the default chance of winning a deal at each stage. Forecasting only: no quotation total changes. */
export default function StageProbabilitiesModal({ isOpen, onClose, stages, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(CONFIGURABLE_PROBABILITY_STAGES.map((stage) => [stage, String(stages[stage])])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = (stage: ConfigurableProbabilityStage): number | null => {
    const text = values[stage]?.trim();
    if (!text || !/^\d{1,3}$/.test(text)) return null;
    const n = Number(text);
    return n >= 0 && n <= 100 ? n : null;
  };

  const save = async () => {
    const body: Record<string, number> = {};
    for (const stage of CONFIGURABLE_PROBABILITY_STAGES) {
      const n = parse(stage);
      if (n === null) {
        setError(`${STAGE_LABELS[stage]}: enter a whole number from 0 to 100.`);
        return;
      }
      body[stage] = n;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson.put("/api/crm/stage-probabilities", body);
      notify.success("Stage probabilities saved", "The pipeline forecast now uses these percentages.");
      onSaved();
      onClose();
    } catch (err) {
      notifyApiError(err, "Could not save stage probabilities");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Stage probabilities" size="md">
      <div className="space-y-4" data-testid="stage-probabilities-modal">
        <p className="text-sm text-neutral-600">
          The default chance of winning a deal at each stage. They only weight the pipeline forecast (expected value); they never change a
          quotation total or your actual revenue. A salesperson can still set a different chance on a single lead.
        </p>
        <div className="space-y-2.5">
          {CONFIGURABLE_PROBABILITY_STAGES.map((stage) => (
            <label key={stage} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-neutral-800">{STAGE_LABELS[stage]}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-neutral-400">default {STAGE_PROBABILITY[stage]}%</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  aria-label={`${STAGE_LABELS[stage]} probability`}
                  data-testid={`stage-probability-${stage}`}
                  value={values[stage] ?? ""}
                  onChange={(e) => { setValues((current) => ({ ...current, [stage]: e.target.value })); setError(null); }}
                  className="h-9 w-20 rounded-lg border border-neutral-300 bg-white px-2 text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-sm text-neutral-500">%</span>
              </span>
            </label>
          ))}
          <p className="text-[11px] text-neutral-400">Closed won is always 100% and closed lost always 0%.</p>
        </div>
        {error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" variant="primary" size="sm" onClick={save} disabled={saving} data-testid="stage-probabilities-save">{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
