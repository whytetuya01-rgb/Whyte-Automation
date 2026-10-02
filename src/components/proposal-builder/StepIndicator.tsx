"use client";

import { Check } from "lucide-react";

export type ProposalStep = 1 | 2 | 3 | 4 | 5;

interface Props {
  currentStep: ProposalStep;
  completedSteps: ProposalStep[];
  onStepClick: (step: ProposalStep) => void;
  canNavigateToStep?: (step: ProposalStep) => boolean;
}

const STEPS = [
  { step: 1 as ProposalStep, label: "Project", description: "Details & Location" },
  { step: 2 as ProposalStep, label: "Spaces", description: "Select Rooms" },
  { step: 3 as ProposalStep, label: "Products", description: "Configure Devices" },
  { step: 4 as ProposalStep, label: "Review", description: "Summary & Pricing" },
  { step: 5 as ProposalStep, label: "Proposal", description: "Preview & Export" },
];

export default function StepIndicator({
  currentStep,
  completedSteps,
  onStepClick,
  canNavigateToStep = () => true,
}: Props) {
  return (
    <nav aria-label="Proposal Builder Progress" className="w-full">
      <div className="bg-white rounded-2xl border border-gray-100 p-2.5 sm:p-4 shadow-xs">
        <ol className="flex items-center justify-between relative">
          {/* Connector Line behind steps */}
          <div className="absolute top-1/2 left-4 right-4 -translate-y-1/2 h-0.5 bg-gray-100 -z-0" />

          {STEPS.map((s, idx) => {
            const isCompleted = completedSteps.includes(s.step) && currentStep > s.step;
            const isCurrent = currentStep === s.step;
            const isClickable = canNavigateToStep(s.step);

            return (
              <li
                key={s.step}
                className="relative z-10 flex flex-col items-center group cursor-pointer"
                onClick={() => {
                  if (isClickable) onStepClick(s.step);
                }}
              >
                {/* Step Circle */}
                <div
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm transition-all duration-200 select-none ${
                    isCurrent
                      ? "bg-gray-950 text-white shadow-md ring-4 ring-accent/25 border-2 border-accent scale-105"
                      : isCompleted
                      ? "bg-gray-950 text-white hover:bg-gray-800"
                      : isClickable
                      ? "bg-white border-2 border-gray-200 text-gray-500 hover:border-gray-950 hover:text-gray-950"
                      : "bg-white border-2 border-gray-100 text-gray-300 cursor-not-allowed"
                  }`}
                >
                  {isCompleted ? (
                    <Check size={15} strokeWidth={2.5} className="text-accent" />
                  ) : (
                    <span>{s.step}</span>
                  )}
                </div>

                {/* Step Label */}
                <div className="mt-2 text-center">
                  <p
                    className={`text-[11px] sm:text-xs font-bold tracking-tight transition-colors ${
                      isCurrent
                        ? "text-accent font-black"
                        : isCompleted
                        ? "text-gray-800"
                        : "text-gray-400"
                    }`}
                  >
                    {s.label}
                  </p>
                  <p className="hidden md:block text-[10px] text-gray-400 font-normal">
                    {s.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
