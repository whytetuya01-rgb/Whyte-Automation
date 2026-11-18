"use client";

import { Check } from "lucide-react";

export type ProposalStep = number | string;

export interface StepIndicatorItem {
  id: string;
  stepNumber: number;
  label: string;
  description?: string;
  type?: "built_in_module" | "custom_form" | "builtin";
}

interface Props {
  currentStep: ProposalStep;
  completedSteps: ProposalStep[];
  onStepClick: (step: ProposalStep) => void;
  canNavigateToStep?: (step: ProposalStep) => boolean;
  steps?: StepIndicatorItem[];
}

const DEFAULT_STEPS: StepIndicatorItem[] = [
  { id: "project_details", stepNumber: 1, label: "Project", description: "Details & Location" },
  { id: "space_selection", stepNumber: 2, label: "Spaces", description: "Select Rooms" },
  { id: "product_config", stepNumber: 3, label: "Products", description: "Configure Devices" },
  { id: "pricing_review", stepNumber: 4, label: "Review", description: "Summary & Pricing" },
  { id: "proposal_preview", stepNumber: 5, label: "Proposal", description: "Preview & Export" },
];

export default function StepIndicator({
  currentStep,
  completedSteps,
  onStepClick,
  canNavigateToStep = () => true,
  steps,
}: Props) {
  const displaySteps = steps && steps.length > 0 ? steps : DEFAULT_STEPS;

  const currentStepMeta =
    displaySteps.find(
      (s) =>
        s.id === currentStep ||
        s.stepNumber === currentStep ||
        String(s.stepNumber) === String(currentStep)
    ) ?? displaySteps[0];

  const currentStepNumber = currentStepMeta.stepNumber;

  return (
    <nav aria-label="Proposal Builder Progress" className="w-full">
      <div className="bg-white rounded-2xl border border-gray-100 p-2 sm:p-4 shadow-2xs">
        <ol className="flex items-center justify-between relative px-1 sm:px-2">
          {/* Connector Line behind steps */}
          <div className="absolute top-[14px] sm:top-5 left-6 right-6 -translate-y-1/2 h-0.5 bg-gray-100 -z-0" />

          {displaySteps.map((s) => {
            const isCurrent =
              s.id === currentStep ||
              s.stepNumber === currentStep ||
              String(s.stepNumber) === String(currentStep);

            const isExplicitlyCompleted =
              completedSteps.includes(s.id) ||
              completedSteps.includes(s.stepNumber) ||
              completedSteps.includes(String(s.stepNumber));

            const isCompleted = isExplicitlyCompleted && currentStepNumber > s.stepNumber;
            const isClickable = canNavigateToStep(s.id) || canNavigateToStep(s.stepNumber);

            return (
              <li
                key={s.id}
                className="relative z-10 flex flex-col items-center group cursor-pointer min-w-[44px] xs:min-w-[52px] sm:min-w-0"
                onClick={() => {
                  if (isClickable) onStepClick(s.id);
                }}
              >
                {/* Step Circle */}
                <div
                  className={`w-7 h-7 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-[11px] sm:text-sm transition-all duration-200 select-none ${
                    isCurrent
                      ? "bg-gray-950 text-white shadow-md ring-3 sm:ring-4 ring-accent/25 border-2 border-accent scale-105"
                      : isCompleted
                      ? "bg-gray-950 text-white hover:bg-gray-800"
                      : isClickable
                      ? "bg-white border-2 border-gray-200 text-gray-500 hover:border-gray-950 hover:text-gray-950"
                      : "bg-white border-2 border-gray-100 text-gray-300 cursor-not-allowed"
                  }`}
                >
                  {isCompleted ? (
                    <Check size={14} strokeWidth={2.5} className="text-accent sm:w-[15px] sm:h-[15px]" />
                  ) : (
                    <span>{s.stepNumber}</span>
                  )}
                </div>

                {/* Step Label */}
                <div className="mt-1.5 sm:mt-2 text-center max-w-[56px] xs:max-w-[68px] sm:max-w-none">
                  <p
                    className={`text-[10px] sm:text-xs font-bold tracking-tight transition-colors truncate sm:overflow-visible ${
                      isCurrent
                        ? "text-accent font-black"
                        : isCompleted
                        ? "text-gray-800"
                        : "text-gray-400"
                    }`}
                  >
                    {s.label}
                  </p>
                  {s.description && (
                    <p className="hidden md:block text-[10px] text-gray-400 font-normal">
                      {s.description}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Mobile current step indicator pill */}
        <div className="sm:hidden mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500 px-1">
          <span className="font-mono text-[10px] uppercase tracking-wider font-semibold">
            Step {currentStepNumber} of {displaySteps.length}
          </span>
          <span className="font-semibold text-gray-900 truncate ml-2">
            {currentStepMeta.label}: {currentStepMeta.description || ""}
          </span>
        </div>
      </div>
    </nav>
  );
}
