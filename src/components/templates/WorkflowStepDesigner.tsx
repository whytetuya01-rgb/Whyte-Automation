"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Check,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Layers,
} from "lucide-react";
import type { WorkflowStepDefinition, BuiltInModuleRef } from "@/types/template";
import { CANONICAL_PROJECT_SECTIONS } from "@/types/template";
import { BUILT_IN_MODULES } from "@/components/proposal-builder/workflow/moduleRegistry";
import { validateWorkflowDependencies } from "@/lib/templateValidation";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import TemplatePromptModal from "./TemplatePromptModal";

interface WorkflowStepDesignerProps {
  steps: WorkflowStepDefinition[];
  activeStepId: string;
  onSelectStep: (stepId: string) => void;
  onUpdateSteps: (steps: WorkflowStepDefinition[]) => void;
}

const BUILT_IN_LABELS: Record<string, string> = {
  project_details: "Project Details (Built-in)",
  space_selection: "Space Selection (Built-in)",
  product_config: "Product Configuration (Built-in)",
  pricing_review: "Pricing & Commercials (Built-in)",
  proposal_preview: "Proposal Preview & Export (Built-in)",
};

export default function WorkflowStepDesigner({
  steps,
  activeStepId,
  onSelectStep,
  onUpdateSteps,
}: WorkflowStepDesignerProps) {
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState("");
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);
  const moduleMenuRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  // Close module menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moduleMenuRef.current && !moduleMenuRef.current.contains(event.target as Node)) {
        setModuleMenuOpen(false);
      }
    }
    if (moduleMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [moduleMenuOpen]);

  const handleInsertBuiltinModule = (modRef: BuiltInModuleRef) => {
    setModuleMenuOpen(false);
    if (steps.some((s) => s.builtinModule === modRef)) {
      toast.error(`The "${BUILT_IN_LABELS[modRef] || modRef}" module is already present in this workflow.`);
      return;
    }

    const meta = BUILT_IN_MODULES[modRef];
    const newStep: WorkflowStepDefinition = {
      id: meta.defaultId,
      title: meta.defaultTitle,
      subtitle: meta.defaultDescription,
      moduleType: "builtin",
      builtinModule: modRef,
      sortOrder: steps.length + 1,
      isOptional: false,
      canSkip: false,
      sections: modRef === "project_details" ? JSON.parse(JSON.stringify(CANONICAL_PROJECT_SECTIONS)) : undefined,
    };

    // Insert before proposal_preview if present, otherwise at end
    const previewIdx = steps.findIndex((s) => s.builtinModule === "proposal_preview");
    const insertIdx = previewIdx !== -1 && modRef !== "proposal_preview" ? previewIdx : steps.length;

    const nextSteps = [...steps];
    nextSteps.splice(insertIdx, 0, newStep);
    nextSteps.forEach((s, idx) => (s.sortOrder = idx + 1));

    const validation = validateWorkflowDependencies(nextSteps);
    if (!validation.isValid) {
      toast.error(`Cannot insert module here: ${validation.errors.join("; ")}`);
      return;
    }

    onUpdateSteps(nextSteps);
    onSelectStep(newStep.id);
    toast.success(`Inserted "${meta.defaultTitle}" module!`);
  };

  const handleAddCustomStep = () => {
    setPromptModalOpen(true);
  };

  const executeAddStep = (title: string) => {
    const slug = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 24);

    const newStepId = `step_${slug || "custom"}_${Date.now().toString(36).slice(-4)}`;

    const newStep: WorkflowStepDefinition = {
      id: newStepId,
      title: title.trim(),
      description: "Custom quotation creation step",
      moduleType: "custom_form",
      sortOrder: steps.length + 1,
      isOptional: false,
      canSkip: false,
      sections: [
        {
          id: "sec_" + Date.now().toString(36),
          title: "General Information",
          description: "Fill in the required information",
          layout: "two_column",
          spacing: "normal",
          sortOrder: 1,
          fields: [
            {
              id: "fld_" + Date.now().toString(36),
              key: `${slug}_notes`,
              label: `${title.trim()} Notes`,
              type: "text",
              placeholder: `Enter notes...`,
              required: false,
              layout: { width: "full" },
            },
          ],
        },
      ],
    };

    // Insert custom step before proposal_preview or at current selection position
    const previewIdx = steps.findIndex((s) => s.builtinModule === "proposal_preview");
    const insertIdx = previewIdx !== -1 ? previewIdx : steps.length;

    const nextSteps = [...steps];
    nextSteps.splice(insertIdx, 0, newStep);
    nextSteps.forEach((s, idx) => (s.sortOrder = idx + 1));

    // Validate workflow before applying
    const validation = validateWorkflowDependencies(nextSteps);
    if (!validation.isValid) {
      toast.error(`Cannot add step here: ${validation.errors.join("; ")}`);
      return;
    }

    onUpdateSteps(nextSteps);
    onSelectStep(newStep.id);
    toast.success(`Step "${title.trim()}" added!`);
  };

  const handleMoveStep = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= steps.length) return;

    const nextSteps = [...steps];
    const temp = nextSteps[index];
    nextSteps[index] = nextSteps[targetIdx];
    nextSteps[targetIdx] = temp;
    nextSteps.forEach((s, idx) => (s.sortOrder = idx + 1));

    // Check dependency validity
    const validation = validateWorkflowDependencies(nextSteps);
    if (!validation.isValid) {
      toast.error(`Cannot reorder steps: ${validation.errors.join("; ")}`);
      return;
    }

    onUpdateSteps(nextSteps);
  };

  const handleDeleteStep = async (stepId: string) => {
    const target = steps.find((s) => s.id === stepId);
    if (!target) return;

    if (steps.length <= 1) {
      toast.error("A workflow must have at least one step.");
      return;
    }

    const nextSteps = steps.filter((s) => s.id !== stepId);
    nextSteps.forEach((s, idx) => (s.sortOrder = idx + 1));

    // Check dependency validity before prompting
    const validation = validateWorkflowDependencies(nextSteps);
    if (!validation.isValid) {
      toast.error(`Cannot remove step "${target.title}": ${validation.errors.join("; ")}`);
      return;
    }

    const ok = await confirm({
      title: `Delete Step "${target.title}"?`,
      message: `Are you sure you want to delete step "${target.title}"?`,
      detail:
        target.moduleType === "builtin"
          ? "This will remove this built-in module from this workflow template. Historical quotations remain unaffected."
          : "This will remove the step and all its configured form fields from the workflow.",
      confirmText: "Delete Step",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    onUpdateSteps(nextSteps);

    // If deleted step was active, select the first step
    if (activeStepId === stepId && nextSteps.length > 0) {
      onSelectStep(nextSteps[0].id);
    }
    toast.success(`Step "${target.title}" removed.`);
  };

  const handleDuplicateStep = (step: WorkflowStepDefinition) => {
    const dup: WorkflowStepDefinition = {
      ...JSON.parse(JSON.stringify(step)),
      id: `${step.id}_copy_${Date.now().toString(36).slice(-4)}`,
      title: `${step.title} (Copy)`,
      moduleType: "custom_form", // Duplicates are always custom forms
      builtinModule: undefined,
    };

    // Give sections and fields unique IDs and keys
    dup.sections = (dup.sections || []).map((sec, sIdx) => ({
      ...sec,
      id: `sec_${Date.now().toString(36)}_${sIdx}`,
      fields: sec.fields.map((f, fIdx) => ({
        ...f,
        id: `fld_${Date.now().toString(36)}_${sIdx}_${fIdx}`,
        key: `${f.key}_copy`,
      })),
    }));

    const nextSteps = [...steps, dup];
    nextSteps.forEach((s, idx) => (s.sortOrder = idx + 1));

    onUpdateSteps(nextSteps);
    onSelectStep(dup.id);
  };

  const handleSaveTitle = (stepId: string) => {
    if (!tempTitle.trim()) {
      setEditingTitleId(null);
      return;
    }
    const nextSteps = steps.map((s) => (s.id === stepId ? { ...s, title: tempTitle.trim() } : s));
    onUpdateSteps(nextSteps);
    setEditingTitleId(null);
  };

  const handleToggleOptional = (stepId: string) => {
    const nextSteps = steps.map((s) => {
      if (s.id !== stepId) return s;
      const nextOpt = !s.isOptional;
      return { ...s, isOptional: nextOpt, canSkip: nextOpt };
    });
    onUpdateSteps(nextSteps);
  };

  return (
    <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-xs space-y-4">
      {/* Top Header */}
      <div className="pb-3 border-b border-gray-100 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
              Workflow Steps
            </h3>
            <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-gray-100 text-gray-700">
              {steps.length}
            </span>
          </div>
          <span className="text-[11px] text-gray-400">Click to select step</span>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleAddCustomStep}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-xl transition cursor-pointer shadow-2xs"
          >
            <Plus size={13} />
            <span>Add Step</span>
          </button>

          <div className="relative" ref={moduleMenuRef}>
            <button
              type="button"
              onClick={() => setModuleMenuOpen((prev) => !prev)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 text-xs font-semibold rounded-xl transition cursor-pointer shadow-2xs"
            >
              <Layers size={13} className="text-primary" />
              <span>Insert Module</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>

            {moduleMenuOpen && (
              <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1 text-xs animate-fadeIn">
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50">
                  <span className="font-bold text-[10px] uppercase tracking-wider text-gray-500 block">
                    Reusable Business Modules
                  </span>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Select a built-in module to insert into this workflow.
                  </p>
                </div>
                {(
                  [
                    "project_details",
                    "space_selection",
                    "product_config",
                    "pricing_review",
                    "proposal_preview",
                  ] as BuiltInModuleRef[]
                ).map((modRef) => {
                  const meta = BUILT_IN_MODULES[modRef];
                  const isPresent = steps.some((s) => s.builtinModule === modRef);
                  return (
                    <button
                      key={modRef}
                      type="button"
                      disabled={isPresent}
                      onClick={() => handleInsertBuiltinModule(modRef)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition cursor-pointer ${
                        isPresent ? "opacity-40 cursor-not-allowed" : "text-gray-800"
                      }`}
                    >
                      <div>
                        <span className="font-bold block text-xs">{meta.defaultTitle}</span>
                        <span className="text-[10px] text-gray-400 block">{meta.defaultDescription}</span>
                      </div>
                      {isPresent && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                          Added
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-2">
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isBuiltIn = step.moduleType === "builtin" || Boolean(step.builtinModule);

          return (
            <div
              key={step.id}
              onClick={() => onSelectStep(step.id)}
              className={`group flex items-center justify-between p-3 rounded-xl border-2 transition cursor-pointer ${
                isActive
                  ? "border-primary bg-primary/5 shadow-xs ring-2 ring-primary/20"
                  : "border-gray-200 hover:border-gray-300 bg-white"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {/* Step Number Circle */}
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 select-none ${
                    isActive ? "bg-primary text-white" : "bg-gray-100 text-gray-600 group-hover:bg-gray-200"
                  }`}
                >
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {editingTitleId === step.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={tempTitle}
                          onChange={(e) => setTempTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveTitle(step.id);
                            if (e.key === "Escape") setEditingTitleId(null);
                          }}
                          className="px-2 py-0.5 text-xs font-bold bg-white border border-primary rounded-md focus:outline-hidden"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveTitle(step.id)}
                          className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                        >
                          <Check size={12} />
                        </button>
                      </div>
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingTitleId(step.id);
                          setTempTitle(step.title);
                        }}
                        className="text-xs font-bold text-gray-900 truncate hover:text-primary transition"
                        title="Double-click to rename"
                      >
                        {step.title}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 mt-0.5">
                    {isBuiltIn ? (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                        <Layers size={9} className="text-gray-500" /> Module
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                        Custom Form
                      </span>
                    )}

                    {step.isOptional && (
                      <span className="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        Optional
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Step Controls */}
              <div
                className="flex items-center gap-0.5 shrink-0 ml-2"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Reorder Buttons */}
                <button
                  type="button"
                  onClick={() => handleMoveStep(index, "up")}
                  disabled={index === 0}
                  className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-20 transition cursor-pointer"
                  title="Move step up"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveStep(index, "down")}
                  disabled={index === steps.length - 1}
                  className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-20 transition cursor-pointer"
                  title="Move step down"
                >
                  <ArrowDown size={12} />
                </button>

                {/* Duplicate (for custom steps) */}
                {!isBuiltIn && (
                  <button
                    type="button"
                    onClick={() => handleDuplicateStep(step)}
                    className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition cursor-pointer"
                    title="Duplicate step"
                  >
                    <Copy size={12} />
                  </button>
                )}

                {/* Delete button (available for any step as long as workflow dependencies are satisfied) */}
                <button
                  type="button"
                  onClick={() => handleDeleteStep(step.id)}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition cursor-pointer"
                  title="Delete step"
                >
                  <Trash2 size={12} />
                </button>

                <ChevronRight size={13} className={isActive ? "text-primary" : "text-gray-300"} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ADD STEP PROMPT MODAL */}
      <TemplatePromptModal
        isOpen={promptModalOpen}
        title="Add Custom Workflow Step"
        description="Add a new custom form or questionnaire step into your quotation journey."
        inputLabel="Step Title"
        placeholder="e.g. Site Survey, Engineering Checklist, Handover Protocol"
        defaultValue="Site Survey"
        confirmText="Add Step"
        icon="plus"
        onConfirm={executeAddStep}
        onClose={() => setPromptModalOpen(false)}
      />
    </div>
  );
}
