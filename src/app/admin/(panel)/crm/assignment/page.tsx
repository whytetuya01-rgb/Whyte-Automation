"use client";

import { useState, useEffect, useCallback } from "react";
import CustomDropdown from "@/components/shared/CustomDropdown";
import PageHeader from "@/components/admin/PageHeader";
import {
  Workflow,
  Check,
  Save,
  Users,
  ShieldAlert,
  ArrowRight,
  Plus,
  Trash2,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { AssignmentMode, ISourceMapping, ILeadAssignmentRule } from "@/models/LeadAssignmentRule";

interface SalesRep {
  id: number;
  name: string;
  email: string;
  contactNumber: string | null;
}

interface LeadSourceItem {
  id: string;
  name: string;
}

interface RulesApiResponse {
  rule: ILeadAssignmentRule;
  salesRepresentatives: SalesRep[];
  leadSources: LeadSourceItem[];
  canManage: boolean;
}

export default function LeadAssignmentRulesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canManage, setCanManage] = useState(true);

  // Form State
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<AssignmentMode>("manual");
  const [eligibleSalesIds, setEligibleSalesIds] = useState<number[]>([]);
  const [fallbackSalesId, setFallbackSalesId] = useState<number | null>(null);
  const [sourceMappings, setSourceMappings] = useState<ISourceMapping[]>([]);

  // Reference Data
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSourceItem[]>([]);
  const [counter, setCounter] = useState(0);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson.get<RulesApiResponse>("/api/crm/assignment-rules");
      if (res) {
        setEnabled(res.rule.enabled ?? false);
        setMode(res.rule.mode ?? "manual");
        setEligibleSalesIds(res.rule.eligibleSalesIds ?? []);
        setFallbackSalesId(res.rule.fallbackSalesId ?? null);
        setSourceMappings(res.rule.sourceMappings ?? []);
        setCounter(res.rule.roundRobinCounter ?? 0);
        setSalesReps(res.salesRepresentatives || []);
        setLeadSources(res.leadSources || []);
        setCanManage(res.canManage ?? true);
      }
    } catch (err) {
      notifyApiError(err, "Failed to load lead assignment rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleToggleSalesId = (id: number) => {
    if (!canManage) return;
    setEligibleSalesIds((prev) =>
      prev.includes(id) ? prev.filter((sId) => sId !== id) : [...prev, id]
    );
  };

  const handleSelectAllSales = () => {
    if (!canManage) return;
    setEligibleSalesIds(salesReps.map((s) => s.id));
  };

  const handleClearAllSales = () => {
    if (!canManage) return;
    setEligibleSalesIds([]);
  };

  const handleAddSourceMapping = () => {
    if (!canManage || !leadSources.length || !salesReps.length) return;
    // pick first source not yet mapped
    const usedSourceIds = new Set(sourceMappings.map((m) => m.sourceId));
    const available = leadSources.find((s) => !usedSourceIds.has(s.id));
    if (!available) {
      notify.error("All Sources Mapped", "Every available lead source already has a rule configured.");
      return;
    }
    setSourceMappings((prev) => [
      ...prev,
      { sourceId: available.id, salesId: salesReps[0].id },
    ]);
  };

  const handleUpdateSourceMapping = (
    index: number,
    field: "sourceId" | "salesId",
    value: string | number
  ) => {
    if (!canManage) return;
    setSourceMappings((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? {
              ...item,
              [field]: field === "salesId" ? Number(value) : String(value),
            }
          : item
      )
    );
  };

  const handleRemoveSourceMapping = (index: number) => {
    if (!canManage) return;
    setSourceMappings((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      const payload = {
        enabled,
        mode,
        eligibleSalesIds,
        fallbackSalesId: fallbackSalesId ? Number(fallbackSalesId) : null,
        sourceMappings,
      };

      const res = await apiJson.put<{ rule: ILeadAssignmentRule }>("/api/crm/assignment-rules", payload);
      if (res?.rule) {
        notify.success("Rules Saved", "Automatic lead assignment rules updated successfully.");
        setCounter(res.rule.roundRobinCounter ?? 0);
      }
    } catch (err) {
      notifyApiError(err, "Failed to update lead assignment rules");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl space-y-6 pb-20">
      {/* Top Header */}
      <PageHeader
        title="Automatic Lead Assignment"
        icon={Workflow}
        subtitle="Configure how incoming leads are distributed among your sales representatives. User-selected assignees always take precedence."
        actions={
          canManage ? (
            <Button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2">
              {saving ? <LoadingSpinner size="sm" /> : <Save size={16} />}
              <span>Save Rules</span>
            </Button>
          ) : undefined
        }
      />

      {!canManage && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs sm:text-sm flex items-center gap-2">
          <ShieldAlert size={18} className="text-amber-600 shrink-0" />
          <span>You have read-only access to CRM assignment rules. Contact a Company Owner to modify these settings.</span>
        </div>
      )}

      {/* Main Switch Card */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-neutral-950">
            Enable Automatic Lead Assignment
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            When enabled, incoming leads without an explicit sales owner will automatically be assigned based on your active rule.
          </p>
        </div>

        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canManage}
            onChange={(e) => setEnabled(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          <span className="ml-3 text-xs font-bold uppercase tracking-wider text-neutral-700">
            {enabled ? "Active" : "Disabled"}
          </span>
        </label>
      </div>

      {/* Assignment Modes */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-neutral-950">
            Assignment Distribution Strategy
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Choose the core algorithm used to distribute enquiries across your eligible sales team.
          </p>
        </div>

        <div role="radiogroup" aria-label="Assignment strategy" className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Option 1: Manual */}
          <div
            role="radio"
            aria-checked={mode === "manual"}
            tabIndex={canManage ? 0 : -1}
            data-testid="mode-manual"
            onKeyDown={(e) => { if (canManage && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setMode("manual"); } }}
            onClick={() => canManage && setMode("manual")}
            className={`p-4 rounded-xl border transition-all cursor-pointer text-left relative flex flex-col justify-between ${
              mode === "manual"
                ? "border-accent bg-accent-light/30 shadow-xs ring-1 ring-accent"
                : "border-neutral-200 bg-white hover:border-neutral-300"
            } ${!canManage ? "cursor-not-allowed opacity-80" : ""}`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">
                  Manual Mode
                </span>
                {mode === "manual" && <Check size={16} className="text-accent" />}
              </div>
              <h3 className="text-sm font-bold text-neutral-900 mt-1">No Auto-Assign</h3>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                Leads are left unassigned unless an assignee is explicitly chosen during lead creation.
              </p>
            </div>
          </div>

          {/* Option 2: Round Robin */}
          <div
            role="radio"
            aria-checked={mode === "round_robin"}
            tabIndex={canManage ? 0 : -1}
            data-testid="mode-round_robin"
            onKeyDown={(e) => { if (canManage && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setMode("round_robin"); } }}
            onClick={() => canManage && setMode("round_robin")}
            className={`p-4 rounded-xl border transition-all cursor-pointer text-left relative flex flex-col justify-between ${
              mode === "round_robin"
                ? "border-accent bg-accent-light/30 shadow-xs ring-1 ring-accent"
                : "border-neutral-200 bg-white hover:border-neutral-300"
            } ${!canManage ? "cursor-not-allowed opacity-80" : ""}`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">
                  Round-Robin
                </span>
                {mode === "round_robin" && <Check size={16} className="text-accent" />}
              </div>
              <h3 className="text-sm font-bold text-neutral-900 mt-1">Equal Distribution</h3>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                Rotates sequentially through each eligible salesperson. Race-safe atomic execution ensures perfect balance.
              </p>
            </div>
            {mode === "round_robin" && (
              <div className="mt-3 pt-2.5 border-t border-accent-border/40 text-[11px] text-accent font-semibold flex items-center gap-1">
                <RotateCw size={12} />
                <span>Rotation counter: {counter} leads assigned</span>
              </div>
            )}
          </div>

          {/* Option 3: Least Open Leads */}
          <div
            role="radio"
            aria-checked={mode === "least_open_leads"}
            tabIndex={canManage ? 0 : -1}
            data-testid="mode-least_open_leads"
            onKeyDown={(e) => { if (canManage && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setMode("least_open_leads"); } }}
            onClick={() => canManage && setMode("least_open_leads")}
            className={`p-4 rounded-xl border transition-all cursor-pointer text-left relative flex flex-col justify-between ${
              mode === "least_open_leads"
                ? "border-accent bg-accent-light/30 shadow-xs ring-1 ring-accent"
                : "border-neutral-200 bg-white hover:border-neutral-300"
            } ${!canManage ? "cursor-not-allowed opacity-80" : ""}`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">
                  Workload Balanced
                </span>
                {mode === "least_open_leads" && <Check size={16} className="text-accent" />}
              </div>
              <h3 className="text-sm font-bold text-neutral-900 mt-1">Least Open Leads</h3>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                Directs the next enquiry to the salesperson with the fewest currently active leads in your pipeline.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Eligible Salespeople Pool */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-neutral-950">
                Eligible Sales Pool
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700">
                {eligibleSalesIds.length} of {salesReps.length} selected
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              Only checked representatives will receive automated lead allocations. Inactive users are skipped automatically.
            </p>
          </div>

          {canManage && (
            <div className="flex items-center gap-2 text-xs font-semibold">
              <button
                type="button"
                onClick={handleSelectAllSales}
                className="text-accent hover:underline cursor-pointer"
              >
                Select All
              </button>
              <span className="text-neutral-300">|</span>
              <button
                type="button"
                onClick={handleClearAllSales}
                className="text-neutral-500 hover:text-neutral-800 cursor-pointer"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        {salesReps.length === 0 ? (
          <div className="p-8 text-center bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
            <Users size={28} className="mx-auto text-neutral-400 mb-2" />
            <p className="text-xs font-semibold text-neutral-700">No Sales Executives Found</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Add active users with the &quot;sales_executive&quot; role in Users management first.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {salesReps.map((rep) => {
              const isChecked = eligibleSalesIds.includes(rep.id);
              return (
                <div
                  key={rep.id}
                  role="checkbox"
                  aria-checked={isChecked}
                  aria-label={rep.name}
                  aria-disabled={!canManage}
                  tabIndex={canManage ? 0 : -1}
                  data-testid={`rep-${rep.id}`}
                  onKeyDown={(e) => { if (canManage && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); handleToggleSalesId(rep.id); } }}
                  onClick={() => handleToggleSalesId(rep.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isChecked
                      ? "border-accent-border bg-accent-light/20"
                      : "border-neutral-200 bg-white hover:bg-neutral-50"
                  } ${!canManage ? "cursor-not-allowed opacity-80" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-neutral-900 truncate">{rep.name}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{rep.email}</p>
                  </div>

                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={!canManage}
                    onChange={() => {}}
                    className="h-4 w-4 rounded border-neutral-300 text-accent focus:ring-accent shrink-0 pointer-events-none"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fallback Owner */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-neutral-950">
            Fallback Lead Owner
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Designate a safety representative to receive leads if all pool members become inactive or unassignable.
          </p>
        </div>

        <div className="max-w-md">
          <CustomDropdown
            value={fallbackSalesId === null || fallbackSalesId === undefined ? "" : String(fallbackSalesId)}
            disabled={!canManage}
            onChange={(value) => setFallbackSalesId(value ? Number(value) : null)}
            options={[{ value: "", label: "None (Leave unassigned and flagged)" }, ...salesReps.map((rep) => ({ value: String(rep.id), label: `${rep.name} (${rep.email})` }))]}
            ariaLabel="Fallback lead owner"
            className="block w-full"
            triggerClassName="w-full text-xs sm:text-sm"
          />
        </div>
      </div>

      {/* Lead Source Routing */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-neutral-950">
              Lead Source Routing (Overrides)
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Direct leads from specific channels (e.g. Website, Instagram) straight to dedicated specialists.
            </p>
          </div>

          {canManage && leadSources.length > 0 && salesReps.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddSourceMapping}
              className="self-start sm:self-auto shrink-0 inline-flex items-center gap-1.5"
            >
              <Plus size={14} />
              <span>Add Source Rule</span>
            </Button>
          )}
        </div>

        {sourceMappings.length === 0 ? (
          <div className="py-8 px-4 text-center bg-neutral-50/60 rounded-xl border border-dashed border-neutral-200">
            <p className="text-xs font-semibold text-neutral-600">No source rules configured</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              All sources currently follow the selected assignment strategy above.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sourceMappings.map((mapping, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center gap-2.5 p-3 rounded-xl border border-neutral-200 bg-neutral-50/40"
              >
                {/* Source Selection */}
                <div className="flex-1 min-w-0">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">
                    When Lead Source Is
                  </label>
                  <CustomDropdown
                    value={String(mapping.sourceId)}
                    disabled={!canManage}
                    onChange={(value) => handleUpdateSourceMapping(idx, "sourceId", value)}
                    options={leadSources.map((s) => ({ value: String(s.id), label: s.name }))}
                    placeholder="Choose a source"
                    ariaLabel="When lead source is"
                    className="block w-full"
                    triggerClassName="h-9 w-full rounded-lg px-3 text-xs"
                  />
                </div>

                <div className="hidden sm:flex items-center justify-center pt-5 text-neutral-400">
                  <ArrowRight size={16} />
                </div>

                {/* Sales Rep Selection */}
                <div className="flex-1 min-w-0">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">
                    Route Directly To
                  </label>
                  <CustomDropdown
                    value={String(mapping.salesId)}
                    disabled={!canManage}
                    onChange={(value) => handleUpdateSourceMapping(idx, "salesId", value)}
                    options={salesReps.map((rep) => ({ value: String(rep.id), label: rep.name }))}
                    placeholder="Choose a person"
                    ariaLabel="Route directly to"
                    className="block w-full"
                    triggerClassName="h-9 w-full rounded-lg px-3 text-xs"
                  />
                </div>

                {/* Delete action */}
                {canManage && (
                  <div className="sm:pt-5 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveSourceMapping(idx)}
                      className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                      title="Remove rule"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Sticky Save Bar on Mobile */}
      {canManage && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 p-3 bg-white/95 backdrop-blur-md border-t border-neutral-200 z-30 flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2"
          >
            {saving ? <LoadingSpinner size="sm" /> : <Save size={16} />}
            <span>Save Assignment Rules</span>
          </Button>
        </div>
      )}
    </div>
  );
}

