"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Palette,
  Columns,
  Hash,
  Sliders,
  Check,
  Plus,
  Trash2,
  Copy,
  Star,
  Eye,
  Save,
  ArrowUp,
  ArrowDown,
  Layers,
  Sparkles,
  FileText,
  ShieldCheck,
  History,
  Lock,
  Workflow,
  Monitor,
  Building2,
  Home,
  Cpu,
  Receipt,
  FileCheck2,
} from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import type {
  QuotationTemplate,
  TemplateConfigurableColumns,
  TemplateCustomField,
  TemplateFontFamily,
  WorkflowStepDefinition,
  DocumentLayoutDefinition,
} from "@/types/template";
import {
  DEFAULT_TEMPLATE_SECTIONS,
  DEFAULT_CONFIGURABLE_COLUMNS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_NUMBERING_FORMAT,
  DEFAULT_WORKFLOW_STEPS,
  BLANK_WORKFLOW_STEPS,
  CANONICAL_PROJECT_SECTIONS,
  DEMO_DOCUMENT_LAYOUT,
} from "@/types/template";
import { validateWorkflowDependencies } from "@/lib/templateValidation";
import { SAMPLE_QUOTATION } from "@/lib/sampleQuotationData";
import StepProposalPreview from "@/components/proposal-builder/StepProposalPreview";
import WorkflowStepDesigner from "./WorkflowStepDesigner";
import VisualFormCanvas from "./VisualFormCanvas";
import WorkflowLivePreview from "./WorkflowLivePreview";
import TemplateVersionHistoryModal from "./TemplateVersionHistoryModal";
import VisualDocumentCanvas from "./VisualDocumentCanvas";
import TemplatePromptModal from "./TemplatePromptModal";
import NewTemplateModal from "./NewTemplateModal";
import { useConfirm } from "@/components/providers/ConfirmProvider";

type StudioMode = "workflow" | "document";
type DocumentTab = "canvas" | "layout" | "sections" | "columns" | "custom_fields" | "numbering";
type PreviewPaneMode = "workflow" | "pdf";

const COLUMN_CONFIG: Array<{
  key: keyof TemplateConfigurableColumns;
  label: string;
  description: string;
}> = [
  { key: "showProductImage", label: "Product Thumbnail Image", description: "Display device photo in line items table" },
  { key: "showProductCode", label: "Product SKU / Model Code", description: "Hardware model code e.g. WHYTE-MOD-4N" },
  { key: "showSurfaceFinish", label: "Glass & Bezel Finish", description: "Matte Black, Brushed Bronze, White, etc." },
  { key: "showAutomationTier", label: "Automation Tier", description: "Flagship, Prime, or Essential classification" },
  { key: "showUnitPrice", label: "Unit List Price (₹)", description: "Base item rate per unit before discount" },
  { key: "showTaxPercent", label: "GST Rate (%)", description: "Explicit GST percentage per item row" },
  { key: "showLineTotal", label: "Line Total Amount (₹)", description: "Computed extended amount (qty × rate)" },
  { key: "showItemNotes", label: "Technical Notes / Remarks", description: "Room notes, gang count and dimming channels" },
];

export default function TemplateDesignerStudio() {
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const confirm = useConfirm();

  // Prompt modal state for user input (replacing window.prompt)
  const [promptModal, setPromptModal] = useState<{
    isOpen: boolean;
    title: string;
    description?: string;
    inputLabel?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    icon?: "sparkles" | "layers" | "plus" | "warning";
    onConfirm: (val: string) => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    onConfirm: () => {},
  });

  // New Template Starter Modal state
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);

  // Form draft state for currently selected template
  const [draft, setDraft] = useState<QuotationTemplate | null>(null);

  // Active step ID in workflow designer
  const [activeStepId, setActiveStepId] = useState<string>("step_project");

  // Load templates from API
  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/templates");
      if (!res.ok) throw new Error("Failed to load templates");
      const json = await res.json();
      const list: QuotationTemplate[] = json?.data || [];
      setTemplates(list);

      if (list.length > 0) {
        // Keep current selection or select default
        const current =
          list.find((t) => t.id === selectedTemplateId) ||
          list.find((t) => t.isDefault) ||
          list[0];
        setSelectedTemplateId(current.id);
        setDraft(JSON.parse(JSON.stringify(current)));
      }
    } catch (err: any) {
      toast.error(err.message || "Could not load templates");
    } finally {
      setLoading(false);
    }
  }, [selectedTemplateId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // When switching selected template
  const handleSelectTemplate = async (tmpl: QuotationTemplate) => {
    if (isDirty) {
      const ok = await confirm({
        title: "Unsaved Changes",
        message: "You have unsaved changes in the current template.",
        detail: "Switching templates now will discard your unsaved draft edits.",
        confirmText: "Discard & Switch",
        cancelText: "Keep Editing",
        variant: "danger",
      });
      if (!ok) return;
    }
    setSelectedTemplateId(tmpl.id);
    setDraft(JSON.parse(JSON.stringify(tmpl)));
    setIsDirty(false);
  };

  // Mutate draft helper
  const updateDraft = (updater: (prev: QuotationTemplate) => QuotationTemplate) => {
    if (!draft) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      setIsDirty(true);
      return next;
    });
  };

  // Workflow steps memo
  const currentWorkflowSteps: WorkflowStepDefinition[] = useMemo(() => {
    if (draft?.workflow?.steps && draft.workflow.steps.length > 0) {
      return draft.workflow.steps;
    }
    return DEFAULT_WORKFLOW_STEPS;
  }, [draft?.workflow?.steps]);

  // Keep activeStepId valid
  useEffect(() => {
    if (currentWorkflowSteps.length > 0) {
      const exists = currentWorkflowSteps.some((s) => s.id === activeStepId);
      if (!exists) {
        setActiveStepId(currentWorkflowSteps[0].id);
      }
    }
  }, [currentWorkflowSteps, activeStepId]);

  const activeStep = useMemo(() => {
    return (
      currentWorkflowSteps.find((s) => s.id === activeStepId) ||
      currentWorkflowSteps[0] ||
      DEFAULT_WORKFLOW_STEPS[0]
    );
  }, [currentWorkflowSteps, activeStepId]);

  // Update workflow steps from step designer
  const handleUpdateWorkflowSteps = useCallback(
    (newSteps: WorkflowStepDefinition[]) => {
      setDraft((prev) => {
        if (!prev) return prev;
        setIsDirty(true);
        return {
          ...prev,
          workflow: {
            ...prev.workflow,
            steps: newSteps,
          },
        };
      });
    },
    []
  );

  // Update active step from visual form canvas
  const handleUpdateActiveStep = useCallback(
    (updatedStep: WorkflowStepDefinition) => {
      handleUpdateWorkflowSteps(
        currentWorkflowSteps.map((s) => (s.id === updatedStep.id ? updatedStep : s))
      );
    },
    [currentWorkflowSteps, handleUpdateWorkflowSteps]
  );

  // Document Layout memo
  const currentDocumentLayout: DocumentLayoutDefinition = useMemo(() => {
    if (draft?.documentLayout && draft.documentLayout.sections) {
      return draft.documentLayout;
    }
    return DEMO_DOCUMENT_LAYOUT;
  }, [draft]);

  const handleUpdateDocumentLayout = useCallback(
    (newLayout: DocumentLayoutDefinition) => {
      setDraft((prev) => {
        if (!prev) return prev;
        setIsDirty(true);
        return {
          ...prev,
          documentLayout: newLayout,
        };
      });
    },
    []
  );

  // Available custom fields extracted from workflow steps and metadata for block data binding
  const availableCustomFields = useMemo(() => {
    const list: Array<{ key: string; label: string; type: string }> = [];
    const seen = new Set<string>();

    // 1. From workflow steps (custom form sections and fields)
    currentWorkflowSteps.forEach((step) => {
      step.sections?.forEach((sec) => {
        sec.fields?.forEach((f) => {
          if (!seen.has(f.key)) {
            seen.add(f.key);
            list.push({ key: f.key, label: f.label, type: f.type || "text" });
          }
        });
      });
    });

    // 2. From template metadata custom fields
    draft?.customFields?.forEach((f) => {
      if (!seen.has(f.key)) {
        seen.add(f.key);
        list.push({ key: f.key, label: f.label, type: f.type || "text" });
      }
    });

    // 3. Fallback standard demo fields
    const standardFields = [
      { key: "leadArchitect", label: "Lead Architect / Consultant", type: "text" },
      { key: "projectStage", label: "Project Execution Stage", type: "select" },
      { key: "targetHandoverDate", label: "Target Site Handover Date", type: "date" },
      { key: "secondaryEmail", label: "Alternate Site Coordinator Email", type: "email" },
      { key: "siteFloorPlan", label: "Architectural Floor Plan Drawing", type: "image" },
    ];
    standardFields.forEach((sf) => {
      if (!seen.has(sf.key)) {
        seen.add(sf.key);
        list.push(sf);
      }
    });

    return list;
  }, [currentWorkflowSteps, draft?.customFields]);

  // Open starter modal for new template
  const handleCreateNewTemplate = () => {
    setShowNewTemplateModal(true);
  };

  const handleExecuteCreateTemplate = async (name: string, starterType: "whyte" | "blank") => {
    setIsCreatingTemplate(true);
    try {
      const initialSteps = starterType === "blank" ? BLANK_WORKFLOW_STEPS : DEFAULT_WORKFLOW_STEPS;
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: starterType === "blank" ? "Custom blank quotation workflow." : "Standard Whyte automation quotation workflow.",
          isDefault: false,
          workflow: { steps: initialSteps },
          numberingFormat: { ...DEFAULT_NUMBERING_FORMAT },
          layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
          configurableColumns: { ...DEFAULT_CONFIGURABLE_COLUMNS },
          sectionOrder: [...DEFAULT_TEMPLATE_SECTIONS],
          customFields: [],
          documentLayout: null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to create template");
      }

      const json = await res.json();
      const created: QuotationTemplate = json.data;
      toast.success(`Template "${created.name}" created!`);
      setShowNewTemplateModal(false);
      await fetchTemplates();
      setSelectedTemplateId(created.id);
      setDraft(JSON.parse(JSON.stringify(created)));
      setIsDirty(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to create template");
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  // Duplicate current template
  const handleDuplicateTemplate = () => {
    if (!draft) return;
    setPromptModal({
      isOpen: true,
      title: "Duplicate Workflow Template",
      description: `Create an independent copy of "${draft.name}".`,
      inputLabel: "New Template Name",
      placeholder: "Template name...",
      defaultValue: `${draft.name} (Copy)`,
      confirmText: "Duplicate",
      icon: "layers",
      onConfirm: async (name: string) => {
        try {
          const res = await fetch("/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...draft,
              name: name.trim(),
              isDefault: false,
              workflow: { steps: currentWorkflowSteps },
              documentLayout: draft.documentLayout ?? currentDocumentLayout,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message || "Failed to duplicate template");
          }

          const json = await res.json();
          const created: QuotationTemplate = json.data;
          toast.success(`Template duplicated as "${created.name}"`);
          await fetchTemplates();
          setSelectedTemplateId(created.id);
          setDraft(JSON.parse(JSON.stringify(created)));
          setIsDirty(false);
        } catch (err: any) {
          toast.error(err.message || "Failed to duplicate template");
        }
      },
    });
  };

  // Set current template as default
  const handleSetDefault = async () => {
    if (!draft) return;
    try {
      const res = await fetch(`/api/templates/${draft.id}/set-default`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to set default template");
      toast.success(`"${draft.name}" is now the default template.`);
      await fetchTemplates();
      updateDraft((d) => ({ ...d, isDefault: true }));
    } catch (err: any) {
      toast.error(err.message || "Could not set default template");
    }
  };

  // Delete current template
  const handleDeleteTemplate = async () => {
    if (!draft) return;
    if (templates.length <= 1) {
      toast.error("You cannot delete the only remaining template.");
      return;
    }
    const ok = await confirm({
      title: `Delete Template "${draft.name}"?`,
      message: `Are you sure you want to delete template "${draft.name}"?`,
      detail:
        "This will remove the template from the designer. Existing quotations bound to published snapshots will remain unaffected.",
      confirmText: "Delete Template",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/templates/${draft.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to delete template");
      }
      toast.success("Template deleted successfully");
      setIsDirty(false);
      await fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete template");
    }
  };

  // Save changes (PUT)
  const handleSave = async (): Promise<boolean> => {
    if (!draft) return false;

    // Validate workflow dependencies before saving
    const valResult = validateWorkflowDependencies(currentWorkflowSteps);
    if (!valResult.isValid) {
      toast.error(`Cannot save: ${valResult.errors.join("; ")}`);
      return false;
    }

    setSaving(true);
    const toastId = toast.loading("Saving draft changes...");

    try {
      const payload = {
        ...draft,
        workflow: {
          steps: currentWorkflowSteps,
        },
        documentLayout: draft.documentLayout ?? currentDocumentLayout,
      };

      const res = await fetch(`/api/templates/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to save template");
      }

      const json = await res.json();
      const updated: QuotationTemplate = json.data;
      toast.success("Draft saved successfully!", { id: toastId });
      setIsDirty(false);
      await fetchTemplates();
      setDraft(JSON.parse(JSON.stringify(updated)));
      return true;
    } catch (err: any) {
      toast.error(err.message || "Failed to save template", { id: toastId });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Publish new immutable version (POST /publish)
  const handlePublishVersion = async () => {
    if (!draft) return;

    // 1. Dependency validation
    const valResult = validateWorkflowDependencies(currentWorkflowSteps);
    if (!valResult.isValid) {
      toast.error(`Cannot publish: ${valResult.errors.join("; ")}`);
      return;
    }

    // 2. Save working draft if dirty
    if (isDirty) {
      const saved = await handleSave();
      if (!saved) return;
    }

    const nextVer = (draft.version ?? 0) + 1;
    const ok = await confirm({
      title: `Publish Version ${nextVer}?`,
      message: `Publish current workflow & proposal layout definition as Version ${nextVer}?`,
      detail:
        "This creates an immutable snapshot. Future quotations will use this version, while historical quotations remain safely bound to their original snapshots.",
      confirmText: `Publish Version ${nextVer}`,
      cancelText: "Cancel",
      variant: "primary",
    });
    if (!ok) return;

    setPublishing(true);
    const toastId = toast.loading("Publishing immutable version...");

    try {
      const res = await fetch(`/api/templates/${draft.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to publish template version");
      }

      const json = await res.json();
      const snapshot = json.data;
      toast.success(`🎉 Version ${snapshot.version} published successfully!`, { id: toastId });
      setIsDirty(false);
      await fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Failed to publish version", { id: toastId });
    } finally {
      setPublishing(false);
    }
  };

  // Move section up/down in document ordering
  const moveSection = (index: number, direction: "up" | "down") => {
    if (!draft) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= draft.sectionOrder.length) return;

    updateDraft((prev) => {
      const list = [...prev.sectionOrder];
      const temp = list[index];
      list[index] = list[newIndex];
      list[newIndex] = temp;
      return { ...prev, sectionOrder: list };
    });
  };

  // Toggle document section enabled
  const toggleSection = (id: string) => {
    updateDraft((prev) => ({
      ...prev,
      sectionOrder: prev.sectionOrder.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    }));
  };

  // Add document custom field
  const handleAddCustomField = () => {
    setPromptModal({
      isOpen: true,
      title: "Add Document Custom Field",
      description: "Define a metadata field to display on final proposal documents.",
      inputLabel: "Field Label",
      placeholder: "e.g. Lead Architect, Site Supervisor",
      defaultValue: "",
      confirmText: "Add Field",
      icon: "plus",
      onConfirm: (label: string) => {
        const key = label
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");

        const newField: TemplateCustomField = {
          id: "f_" + Date.now().toString(36),
          key: key || "customField",
          label: label.trim(),
          type: "text",
          defaultValue: "",
          placeholder: `Enter ${label.trim()}...`,
          required: false,
          section: "metadata",
        };

        updateDraft((prev) => ({
          ...prev,
          customFields: [...prev.customFields, newField],
        }));
      },
    });
  };

  // Delete document custom field
  const handleDeleteCustomField = (id: string) => {
    updateDraft((prev) => ({
      ...prev,
      customFields: prev.customFields.filter((f) => f.id !== id),
    }));
  };

  // Simulated quotation numbering preview
  const sampleQuotationNumber = useMemo(() => {
    if (!draft) return "QT-2026-0001";
    const { prefix, separator, includeYear, yearFormat, digitCount, suffix } =
      draft.numberingFormat;
    const year = yearFormat === "YY" ? "26" : "2026";
    const padSeq = "0001".padStart(digitCount, "0").slice(-digitCount);

    const parts: string[] = [];
    if (prefix) parts.push(prefix);
    if (includeYear) parts.push(year);
    parts.push(padSeq);
    if (suffix) parts.push(suffix);

    return parts.join(separator || "-");
  }, [draft]);

  const previewQuotation = useMemo(() => {
    return {
      ...SAMPLE_QUOTATION,
      quotationNumber: sampleQuotationNumber,
      templateId: draft?.id ?? null,
      customFieldValues: {
        ...SAMPLE_QUOTATION.customFieldValues,
        leadArchitect: "Studio Lotus Architects (Ar. Ananya Sen)",
        projectStage: "Pre-Wiring & Conduit Installation",
        targetHandoverDate: "2026-12-15",
        secondaryEmail: "coordinator.sharma@example.com",
        siteFloorPlan: "/images/sample-floor-plan.png",
      },
    };
  }, [sampleQuotationNumber, draft]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-gray-500">
        <div className="w-8 h-8 border-3 border-gray-900 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-medium">Loading Quotation Templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. TOP BAR: TEMPLATE SELECTOR, ACTIONS & PUBLISH STATUS */}
      <div className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Active Template:
          </label>
          <div className="flex items-center gap-2">
            <select
              value={selectedTemplateId || ""}
              onChange={(e) => {
                const found = templates.find((t) => t.id === e.target.value);
                if (found) handleSelectTemplate(found);
              }}
              className="px-3 py-2 bg-gray-50 hover:bg-gray-100/80 border border-gray-300 rounded-xl text-sm font-semibold text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-gray-900 transition"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.isDefault ? "★ (Default)" : ""} {t.version ? `[v${t.version}]` : ""}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleCreateNewTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-xl transition cursor-pointer shadow-2xs"
            >
              <Plus size={14} />
              <span>New Template</span>
            </button>

            <button
              type="button"
              onClick={handleDuplicateTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition cursor-pointer"
              title="Duplicate current template"
            >
              <Copy size={13} />
              <span>Duplicate</span>
            </button>
          </div>

          {/* Version status badge */}
          {draft && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border",
                  draft.isPublished
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-amber-50 text-amber-800 border-amber-200"
                )}
              >
                <Lock size={11} />
                <span>v{draft.version ?? 1}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  ({draft.isPublished ? "Published" : "Draft Changes"})
                </span>
              </span>

              <button
                type="button"
                onClick={() => setShowVersionModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg border border-gray-200 cursor-pointer transition"
              >
                <History size={12} />
                <span>History</span>
              </button>
            </div>
          )}

          {draft?.isDefault ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold rounded-lg">
              <Star size={12} className="fill-amber-500 text-amber-500" /> Default for new quotations
            </span>
          ) : (
            <button
              type="button"
              onClick={handleSetDefault}
              className="text-xs text-gray-600 hover:text-gray-900 font-medium underline underline-offset-4 cursor-pointer"
            >
              Make default
            </button>
          )}
        </div>

        {/* Right Action buttons: Delete, Save Draft, Publish */}
        <div className="flex items-center gap-2">
          {draft && !draft.isDefault && templates.length > 1 && (
            <button
              type="button"
              onClick={handleDeleteTemplate}
              className="inline-flex items-center gap-1 px-3 py-2 text-rose-600 hover:bg-rose-50 text-xs font-medium rounded-xl transition cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Delete</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer",
              isDirty
                ? "bg-slate-900 hover:bg-slate-800 text-white"
                : "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
            )}
          >
            <Save size={14} />
            <span>{saving ? "Saving..." : isDirty ? "Save Draft" : "Draft Saved"}</span>
          </button>

          <button
            type="button"
            onClick={handlePublishVersion}
            disabled={publishing}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
            title="Publish current draft as an immutable version"
          >
            <Sparkles size={14} />
            <span>{publishing ? "Publishing..." : "Publish Version"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSimulator((prev) => !prev)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer border",
              showSimulator
                ? "bg-primary text-white border-primary"
                : "bg-white text-gray-700 hover:text-gray-900 border-gray-200 hover:bg-gray-50"
            )}
            title="Interactive quotation workflow simulator"
          >
            <Monitor size={14} />
            <span>{showSimulator ? "Exit Simulator" : "Live Simulator"}</span>
          </button>
        </div>
      </div>

      {/* 2. FULL-SCREEN INTERACTIVE SIMULATOR (ON DEMAND) */}
      {draft && showSimulator && (
        <div className="space-y-4 animate-fadeIn">
          <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                <Monitor size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-gray-900">
                    Live Quotation Workflow Simulator
                  </h2>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Interactive Preview
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Simulating how sales reps will experience &quot;{draft.name}&quot; across {currentWorkflowSteps.length} configured steps.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSimulator(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs"
            >
              <span>← Return to Step Editor</span>
            </button>
          </div>

          <div className="bg-white border border-gray-200/80 rounded-2xl shadow-xs overflow-hidden p-6">
            <WorkflowLivePreview
              steps={currentWorkflowSteps}
              templateName={draft.name}
              activeDesignerStepId={activeStepId}
              onStepSelect={(id) => setActiveStepId(id)}
            />
          </div>
        </div>
      )}

      {/* 3. MASTER-DETAIL WORKFLOW & FORM DESIGNER */}
      {draft && !showSimulator && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT 4 COLS: STEPS LIST & MANAGER */}
          <div className="lg:col-span-4 sticky top-6">
            <WorkflowStepDesigner
              steps={currentWorkflowSteps}
              activeStepId={activeStepId}
              onSelectStep={(id) => setActiveStepId(id)}
              onUpdateSteps={handleUpdateWorkflowSteps}
            />
          </div>

          {/* RIGHT 8 COLS: ACTIVE STEP CANVAS & FIELDS */}
          <div className="lg:col-span-8 space-y-4">
            {/* Active Step Header Bar */}
            <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  {currentWorkflowSteps.findIndex((s) => s.id === activeStep.id) + 1}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-gray-900">{activeStep.title}</h2>
                    {activeStep.builtinModule ? (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-gray-100 text-gray-700">
                        Built-in Module
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-primary/10 text-primary">
                        Custom Form
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {activeStep.description || activeStep.subtitle || "Configure form fields and sections for this step"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-xl cursor-pointer hover:bg-gray-100 transition">
                  <input
                    type="checkbox"
                    checked={Boolean(activeStep.isOptional)}
                    onChange={(e) => {
                      const isOpt = e.target.checked;
                      handleUpdateActiveStep({
                        ...activeStep,
                        isOptional: isOpt,
                        canSkip: isOpt,
                      });
                    }}
                    className="rounded text-primary focus:ring-primary"
                  />
                  <span>Optional Step</span>
                </label>
              </div>
            </div>

            {/* Form Canvas or Builtin Module Guide Card */}
            {activeStep.builtinModule && (!activeStep.sections || activeStep.sections.length === 0) ? (
              <BuiltinStepGuideCard
                moduleType={activeStep.builtinModule}
                title={activeStep.title}
                onOpenPreview={() => setShowSimulator(true)}
                onCustomizeFields={() => {
                  if (activeStep.builtinModule === "project_details") {
                    handleUpdateActiveStep({
                      ...activeStep,
                      sections: JSON.parse(JSON.stringify(CANONICAL_PROJECT_SECTIONS)),
                    });
                  } else {
                    handleUpdateActiveStep({
                      ...activeStep,
                      sections: [
                        {
                          id: "sec_" + Date.now().toString(36),
                          title: activeStep.title + " Additional Specifications",
                          description: "Custom specifications and fields for this step",
                          layout: "two_column",
                          spacing: "normal",
                          sortOrder: 1,
                          fields: [],
                        },
                      ],
                    });
                  }
                }}
              />
            ) : (
              <VisualFormCanvas
                key={activeStep.id}
                step={
                  activeStep.builtinModule === "project_details" && (!activeStep.sections || activeStep.sections.length === 0)
                    ? { ...activeStep, sections: JSON.parse(JSON.stringify(CANONICAL_PROJECT_SECTIONS)) }
                    : activeStep
                }
                onUpdateStep={handleUpdateActiveStep}
              />
            )}
          </div>
        </div>
      )}

      {/* VERSION HISTORY MODAL */}
      {draft && (
        <TemplateVersionHistoryModal
          template={draft}
          isOpen={showVersionModal}
          onClose={() => setShowVersionModal(false)}
          onPublishNewVersion={handlePublishVersion}
          isPublishing={publishing}
        />
      )}

      {/* PROMPT INPUT MODAL */}
      <TemplatePromptModal
        isOpen={promptModal.isOpen}
        title={promptModal.title}
        description={promptModal.description}
        inputLabel={promptModal.inputLabel}
        placeholder={promptModal.placeholder}
        defaultValue={promptModal.defaultValue}
        confirmText={promptModal.confirmText}
        icon={promptModal.icon}
        onConfirm={promptModal.onConfirm}
        onClose={() => setPromptModal((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* NEW TEMPLATE STARTER MODAL */}
      <NewTemplateModal
        isOpen={showNewTemplateModal}
        onClose={() => setShowNewTemplateModal(false)}
        onCreate={handleExecuteCreateTemplate}
        isCreating={isCreatingTemplate}
      />
    </div>
  );
}

// BUILT-IN STEP GUIDE CARD FOR CENTER COLUMN
interface BuiltinStepGuideCardProps {
  moduleType: string;
  title: string;
  onOpenPreview: () => void;
  onCustomizeFields?: () => void;
}

function BuiltinStepGuideCard({
  moduleType,
  title,
  onOpenPreview,
  onCustomizeFields,
}: BuiltinStepGuideCardProps) {
  const meta: Record<
    string,
    {
      description: string;
      rules: string;
      icon: React.ComponentType<{ size?: number; className?: string }>;
    }
  > = {
    project_details: {
      description:
        "Captures customer identity, billing address, site location, architect reference, property configuration, and currency specifications.",
      rules:
        "Must be the first core module in the quotation journey. Custom form steps can be placed before or after this module.",
      icon: Building2,
    },
    space_selection: {
      description:
        "Manages rooms and spaces (Living Room, Master Suite, Foyer, Balcony, etc.), area sq.ft., and smart room templates.",
      rules:
        "Requires Project Details to be completed. Populates rooms for device assignment.",
      icon: Home,
    },
    product_config: {
      description:
        "Core device configuration matrix. Assigns smart switches, drivers, sensors, and curtain motors per space with real-time pricing and variant selection.",
      rules:
        "Depends on Space Selection. Feeds device bills-of-materials directly into the commercial calculation engine.",
      icon: Cpu,
    },
    pricing_review: {
      description:
        "Calculates hardware totals, installation charges, dealer margins, custom discounts, and GST (18%) breakdowns.",
      rules:
        "Depends on Product Configuration. Enforces minimum floor pricing and authorized discount ceilings.",
      icon: Receipt,
    },
    proposal_preview: {
      description:
        "Generates final quotation PDF, renders company branding, terms & conditions, bank details, and locks revision snapshots upon issuing.",
      rules:
        "Must be the final step in the quotation workflow sequence.",
      icon: FileCheck2,
    },
  };

  const currentMeta = meta[moduleType] || {
    description: "Core Whyte Quotation system module.",
    rules: "Managed by the system calculation engine.",
    icon: Building2,
  };

  const IconComp = currentMeta.icon;

  return (
    <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-xs space-y-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            <IconComp size={24} />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              Core System Module
            </span>
            <h3 className="text-base font-bold text-gray-900">{title}</h3>
          </div>
        </div>

        <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg flex items-center gap-1">
          <Check size={12} /> System Managed
        </span>
      </div>

      <div className="space-y-3 text-xs text-gray-600">
        <p className="leading-relaxed">{currentMeta.description}</p>
        <div className="p-3.5 bg-blue-50/60 border border-blue-200/80 rounded-xl space-y-1 text-blue-900">
          <span className="font-bold flex items-center gap-1 text-[11px] uppercase tracking-wider">
            <ShieldCheck size={13} className="text-blue-600" /> Sequence & Dependency Rules
          </span>
          <p className="text-[11px] text-blue-800 leading-relaxed">{currentMeta.rules}</p>
        </div>
      </div>

      <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          <span className="font-bold text-gray-900 block">Configure or Preview Step</span>
          <span className="text-gray-500 text-[11px]">
            Add custom form fields to this step or test interactive simulation.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onCustomizeFields && (
            <button
              type="button"
              onClick={onCustomizeFields}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white text-xs font-semibold rounded-lg transition cursor-pointer shadow-xs"
            >
              <Plus size={12} />
              <span>Configure Form Fields</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenPreview}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
          >
            <Monitor size={12} />
            <span>Open Simulator</span>
          </button>
        </div>
      </div>
    </div>
  );
}
