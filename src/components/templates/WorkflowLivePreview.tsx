"use client";

import React, { useState, useMemo } from "react";
import {
  Monitor,
  Tablet,
  Smartphone,
  RotateCcw,
  Layers,
  ArrowRight,
  ArrowLeft,
  Building2,
  Home,
  Cpu,
  Receipt,
  FileCheck2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowStepDefinition } from "@/types/template";
import StepIndicator, { StepIndicatorItem } from "@/components/proposal-builder/StepIndicator";
import DynamicFormStep from "@/components/proposal-builder/DynamicFormStep";

interface WorkflowLivePreviewProps {
  steps: WorkflowStepDefinition[];
  templateName: string;
  activeDesignerStepId?: string;
  onStepSelect?: (stepId: string) => void;
}

type ViewportMode = "desktop" | "tablet" | "mobile";

export default function WorkflowLivePreview({
  steps,
  templateName,
  activeDesignerStepId,
  onStepSelect,
}: WorkflowLivePreviewProps) {
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [simulatedStepId, setSimulatedStepId] = useState<string>(
    activeDesignerStepId || steps[0]?.id || "project_details"
  );
  const [simulatedValues, setSimulatedValues] = useState<Record<string, any>>({
    siteSurveyDate: "2026-11-20",
    clientNotes: "High-priority duplex residence. Client prefers brushed bronze switches.",
    leadArchitect: "Ar. Sanjay Puri Associates",
    projectStage: "under_construction",
    targetHandoverDate: "2027-03-31",
    secondaryEmail: "architect@studiodesign.in",
  });

  // Keep simulated step in sync when designer switches steps if user hasn't explicitly navigated away
  const currentStep = useMemo(() => {
    return steps.find((s) => s.id === simulatedStepId) || steps[0];
  }, [steps, simulatedStepId]);

  const currentIndex = steps.findIndex((s) => s.id === currentStep?.id);
  const canGoBack = currentIndex > 0;
  const canGoNext = currentIndex < steps.length - 1;

  // Build step indicator items
  const stepIndicatorItems: StepIndicatorItem[] = useMemo(() => {
    return steps.map((s, idx) => ({
      id: s.id,
      stepNumber: idx + 1,
      label: s.title,
      description: s.description || (s.builtinModule ? "Core Module" : "Custom Form"),
      type: s.builtinModule ? "builtin" : "custom_form",
    }));
  }, [steps]);

  // Handle navigation
  const handleNext = () => {
    if (canGoNext) {
      const nextStep = steps[currentIndex + 1];
      setSimulatedStepId(nextStep.id);
      if (onStepSelect) onStepSelect(nextStep.id);
    }
  };

  const handleBack = () => {
    if (canGoBack) {
      const prevStep = steps[currentIndex - 1];
      setSimulatedStepId(prevStep.id);
      if (onStepSelect) onStepSelect(prevStep.id);
    }
  };

  const handleStepClick = (stepIdOrNum: string | number) => {
    const target = steps.find((s, idx) => s.id === stepIdOrNum || idx + 1 === stepIdOrNum);
    if (target) {
      setSimulatedStepId(target.id);
      if (onStepSelect) onStepSelect(target.id);
    }
  };

  const handleResetPreview = () => {
    setSimulatedStepId(steps[0]?.id || "");
    setSimulatedValues({});
  };

  // Completed steps up to current index
  const completedStepIds = useMemo(() => {
    return steps.slice(0, currentIndex).map((s) => s.id);
  }, [steps, currentIndex]);

  if (!steps || steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-gray-500 bg-white rounded-2xl border border-gray-200">
        <Layers size={36} className="text-gray-300 mb-2" />
        <p className="text-sm font-semibold">No workflow steps defined</p>
        <p className="text-xs text-gray-400 mt-1">Add steps in the workflow editor to preview.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900/5 rounded-2xl border border-slate-200/80 overflow-hidden">
      {/* PREVIEW TOOLBAR */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-bold text-gray-900 tracking-tight">Interactive Workflow Simulator</span>
          <span className="text-[11px] text-gray-400 font-mono hidden sm:inline">• {templateName}</span>
        </div>

        {/* Viewport switchers */}
        <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setViewport("desktop")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer",
              viewport === "desktop"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
            title="Desktop View (100%)"
          >
            <Monitor size={13} />
            <span className="hidden md:inline">Desktop</span>
          </button>
          <button
            type="button"
            onClick={() => setViewport("tablet")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer",
              viewport === "tablet"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
            title="Tablet View (768px)"
          >
            <Tablet size={13} />
            <span className="hidden md:inline">Tablet</span>
          </button>
          <button
            type="button"
            onClick={() => setViewport("mobile")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer",
              viewport === "mobile"
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-500 hover:text-gray-900"
            )}
            title="Mobile View (375px)"
          >
            <Smartphone size={13} />
            <span className="hidden md:inline">Mobile</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleResetPreview}
          className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-900 font-medium cursor-pointer transition text-[11px]"
          title="Reset simulated inputs"
        >
          <RotateCcw size={12} />
          <span className="hidden sm:inline">Reset</span>
        </button>
      </div>

      {/* VIEWPORT CANVAS CONTAINER */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-100/60 flex justify-center items-start min-h-[580px]">
        <div
          className={cn(
            "w-full transition-all duration-300 ease-out bg-white rounded-2xl border shadow-xs flex flex-col",
            viewport === "desktop" && "max-w-4xl border-gray-200/90",
            viewport === "tablet" && "max-w-[768px] border-gray-300 shadow-md",
            viewport === "mobile" && "max-w-[390px] border-gray-400 rounded-3xl shadow-xl p-1"
          )}
        >
          {/* Mobile bezel decoration */}
          {viewport === "mobile" && (
            <div className="pt-2 pb-1 flex justify-center items-center">
              <div className="w-24 h-4 bg-gray-900 rounded-full flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-800 mr-2" />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-900/60" />
              </div>
            </div>
          )}

          {/* SIMULATED WORKFLOW HEADER WITH STEP INDICATOR */}
          <div className="p-4 md:p-6 border-b border-gray-100 bg-white">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  Step {currentIndex + 1} of {steps.length}
                </span>
                <h2 className="text-lg md:text-xl font-bold text-gray-900 flex items-center gap-2">
                  {currentStep.title}
                  {currentStep.isOptional && (
                    <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      Optional
                    </span>
                  )}
                </h2>
              </div>
              <span className="text-xs text-gray-400 font-medium">
                {currentStep.builtinModule ? "Core Module" : "Configurable Form"}
              </span>
            </div>

            {/* Canonical StepIndicator */}
            <div className="overflow-x-auto py-1">
              <StepIndicator
                currentStep={currentStep.id}
                completedSteps={completedStepIds}
                onStepClick={handleStepClick}
                steps={stepIndicatorItems}
              />
            </div>
          </div>

          {/* STEP CONTENT: DYNAMIC FORM OR BUILT-IN MODULE MOCK */}
          <div className="p-4 md:p-6 flex-1 bg-gray-50/40">
            {currentStep.builtinModule ? (
              <BuiltinModuleMockup
                moduleType={currentStep.builtinModule}
                title={currentStep.title}
                canGoBack={canGoBack}
                canGoNext={canGoNext}
                onBack={handleBack}
                onNext={handleNext}
              />
            ) : (
              <DynamicFormStep
                key={currentStep.id}
                step={currentStep}
                initialValues={simulatedValues}
                onSaveAndContinue={async (newVals) => {
                  setSimulatedValues((prev) => ({ ...prev, ...newVals }));
                  handleNext();
                }}
                onBack={handleBack}
                onSkip={currentStep.isOptional || currentStep.canSkip ? handleNext : undefined}
                isSaving={false}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// BUILT-IN MODULE PREVIEW MOCKUPS
interface BuiltinModuleMockupProps {
  moduleType: string;
  title: string;
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
}

function BuiltinModuleMockup({
  moduleType,
  title,
  canGoBack,
  canGoNext,
  onBack,
  onNext,
}: BuiltinModuleMockupProps) {
  return (
    <div className="space-y-6">
      {/* Module Banner */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            {moduleType === "project_details" && <Building2 size={20} />}
            {moduleType === "space_selection" && <Home size={20} />}
            {moduleType === "product_config" && <Cpu size={20} />}
            {moduleType === "pricing_review" && <Receipt size={20} />}
            {moduleType === "proposal_preview" && <FileCheck2 size={20} />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500">
              Core Whyte Quotation Engine Module • Handled natively by system
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full flex items-center gap-1">
          <Check size={11} /> Live Module
        </span>
      </div>

      {/* Module Mock Visuals */}
      {moduleType === "project_details" && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Simulated Project Details
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="font-semibold text-gray-700 block mb-1">Customer / Client Name</label>
              <input
                type="text"
                readOnly
                value="Dr. Vikramaditya Singhania"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800"
              />
            </div>
            <div>
              <label className="font-semibold text-gray-700 block mb-1">Project Site Location</label>
              <input
                type="text"
                readOnly
                value="Banjara Hills, Hyderabad"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800"
              />
            </div>
            <div>
              <label className="font-semibold text-gray-700 block mb-1">Property Type</label>
              <input
                type="text"
                readOnly
                value="4 BHK Luxury Penthouse"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800"
              />
            </div>
            <div>
              <label className="font-semibold text-gray-700 block mb-1">Primary Contact Email</label>
              <input
                type="text"
                readOnly
                value="vikram.singhania@apexgroup.in"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-800"
              />
            </div>
          </div>
        </div>
      )}

      {moduleType === "space_selection" && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Configured Spaces (Rooms)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { name: "Living & Foyer", area: "650 sq.ft", devices: "12 nodes", tags: "Smart Room" },
              { name: "Master Suite", area: "480 sq.ft", devices: "8 nodes", tags: "Full Automation" },
              { name: "Formal Dining", area: "320 sq.ft", devices: "6 nodes", tags: "Smart Dimming" },
              { name: "Home Theater", area: "400 sq.ft", devices: "10 nodes", tags: "Acoustic & RGB" },
              { name: "Gourmet Kitchen", area: "250 sq.ft", devices: "4 nodes", tags: "Smart Sensors" },
              { name: "Terrace Garden", area: "500 sq.ft", devices: "4 nodes", tags: "Weatherproof" },
            ].map((room) => (
              <div
                key={room.name}
                className="p-3 border border-gray-200 rounded-xl bg-gray-50/60 hover:bg-primary/5 transition"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-900">{room.name}</span>
                  <span className="text-[10px] text-gray-400">{room.area}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>{room.devices}</span>
                  <span className="text-[10px] bg-primary/10 text-primary font-semibold px-1.5 py-0.5 rounded">
                    {room.tags}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {moduleType === "product_config" && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Selected Automation Hardware
          </div>
          <div className="space-y-2 text-xs">
            {[
              {
                sku: "WHYTE-MOD-4N-B",
                title: "Whyte Smart Touch Panel (4-Gang, Matte Black)",
                qty: 14,
                mrp: "₹18,500",
              },
              {
                sku: "WHYTE-DIM-TRIAC",
                title: "Whyte Leading/Trailing Phase Dimmer Module",
                qty: 8,
                mrp: "₹8,200",
              },
              {
                sku: "WHYTE-CURT-M1",
                title: "Ultra-Quiet Heavy Duty Curtain Motor",
                qty: 6,
                mrp: "₹14,900",
              },
              {
                sku: "WHYTE-SEN-PIR360",
                title: "Whyte Ceiling 360° Presence & Lux Sensor",
                qty: 7,
                mrp: "₹5,400",
              },
            ].map((item) => (
              <div
                key={item.sku}
                className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100"
              >
                <div>
                  <div className="font-semibold text-gray-900">{item.title}</div>
                  <div className="text-[10px] text-gray-400 font-mono">{item.sku}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-gray-900">{item.mrp}</div>
                  <div className="text-[11px] text-gray-500">Qty: {item.qty}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {moduleType === "pricing_review" && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 text-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            Commercial Pricing Breakdown
          </div>
          <div className="space-y-1.5 border-b border-gray-100 pb-3">
            <div className="flex justify-between text-gray-600">
              <span>Hardware Subtotal (MRP)</span>
              <span className="font-mono">₹4,42,600.00</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Installation & Commissioning</span>
              <span className="font-mono">₹45,000.00</span>
            </div>
            <div className="flex justify-between text-emerald-600 font-semibold">
              <span>Dealer Discount (15%)</span>
              <span className="font-mono">- ₹73,140.00</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>GST @ 18%</span>
              <span className="font-mono">+ ₹74,602.80</span>
            </div>
          </div>
          <div className="flex justify-between items-center pt-1 text-sm font-bold text-gray-900">
            <span>Grand Total (All-Inclusive)</span>
            <span className="text-base text-primary font-mono">₹4,89,062.80</span>
          </div>
        </div>
      )}

      {moduleType === "proposal_preview" && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center">
            <FileCheck2 size={24} />
          </div>
          <div>
            <h4 className="text-base font-bold text-gray-900">Proposal Ready for Generation</h4>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
              Final step renders formatted client proposal, applies company branding, and produces issued revision PDF.
            </p>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          className={cn(
            "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer",
            canGoBack
              ? "bg-white hover:bg-gray-100 border border-gray-200 text-gray-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
          )}
        >
          <ArrowLeft size={13} />
          <span>Back</span>
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!canGoNext}
          className={cn(
            "inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer",
            canGoNext
              ? "bg-gray-900 hover:bg-gray-800 text-white"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          )}
        >
          <span>{canGoNext ? "Next Step" : "Complete Preview"}</span>
          {canGoNext && <ArrowRight size={13} />}
        </button>
      </div>
    </div>
  );
}
