"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type { Quotation } from "@/types";
import type {
  QuotationTemplate,
  WorkflowStepDefinition,
} from "@/types/template";
import { DEFAULT_WORKFLOW_STEPS } from "@/types/template";
import type { StepIndicatorItem, ProposalStep } from "../StepIndicator";
import { checkModulePrerequisites } from "./moduleRegistry";

interface UseWorkflowEngineProps {
  quotation: Quotation | null;
  initialTemplate?: QuotationTemplate | null;
  initialStepParam?: string | number | null;
  onNavigateUrl?: (stepId: string, stepNumber: number) => void;
  isOfflineDraft?: boolean;
}

export function useWorkflowEngine({
  quotation,
  initialTemplate = null,
  initialStepParam = null,
  onNavigateUrl,
  isOfflineDraft = false,
}: UseWorkflowEngineProps) {
  // Loaded template state
  const [template, setTemplate] = useState<QuotationTemplate | null>(initialTemplate);
  const [isTemplateLoading, setIsTemplateLoading] = useState(false);

  // If initialTemplate changes from outside, adopt it
  useEffect(() => {
    if (initialTemplate) {
      setTemplate(initialTemplate);
    }
  }, [initialTemplate]);

  // Load template dynamically when quotation has a templateId, URL query param, or fetch company default
  useEffect(() => {
    if (isOfflineDraft) return;

    let searchTemplateId: string | null = null;
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      searchTemplateId = sp.get("templateId");
    }

    const targetTemplateId = quotation?.templateId || searchTemplateId;

    if (!targetTemplateId) {
      // If no template is loaded yet, fetch tenant's default company template
      if (!template) {
        let isCancelled = false;
        fetch("/api/templates")
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (isCancelled) return;
            const list: QuotationTemplate[] = json?.data || [];
            const def = list.find((t) => t.isDefault) || list[0];
            if (def) setTemplate(def);
          })
          .catch(() => {});

        return () => {
          isCancelled = true;
        };
      }
      return;
    }

    // If already loaded with matching id, do nothing
    if (template?.id === targetTemplateId) return;

    let isCancelled = false;
    setIsTemplateLoading(true);

    fetch(`/api/templates/${targetTemplateId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (isCancelled) return;
        if (json?.data) {
          setTemplate(json.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) setIsTemplateLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [quotation?.templateId, template?.id, template, isOfflineDraft]);

  // Active workflow steps from resolved template or default canonical 5 steps
  const workflowSteps: WorkflowStepDefinition[] = useMemo(() => {
    if (template?.workflow?.steps && Array.isArray(template.workflow.steps) && template.workflow.steps.length > 0) {
      return template.workflow.steps;
    }
    return DEFAULT_WORKFLOW_STEPS;
  }, [template?.workflow?.steps]);

  // Map to StepIndicatorItem for UI rendering
  const stepIndicatorItems: StepIndicatorItem[] = useMemo(() => {
    return workflowSteps.map((s, idx) => ({
      id: s.id,
      stepNumber: idx + 1,
      label: s.title,
      description: s.subtitle || s.description || undefined,
      type: s.type || s.moduleType,
    }));
  }, [workflowSteps]);

  // Resolve current active step
  const resolveStepIndex = useCallback(
    (param: string | number | null | undefined): number => {
      if (param === null || param === undefined) return 0;

      const paramStr = String(param).trim();

      // Check match by step ID
      const idIdx = workflowSteps.findIndex((s) => s.id === paramStr);
      if (idIdx !== -1) return idIdx;

      // Check match by 1-based step number
      const num = parseInt(paramStr, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= workflowSteps.length) {
        return num - 1;
      }

      // Check match by moduleRef
      const modIdx = workflowSteps.findIndex(
        (s) => s.type === "built_in_module" && s.moduleRef === paramStr
      );
      if (modIdx !== -1) return modIdx;

      return 0;
    },
    [workflowSteps]
  );

  const [currentStepIndex, setCurrentStepIndex] = useState<number>(() => {
    return resolveStepIndex(initialStepParam);
  });

  // Keep currentStepIndex valid if workflowSteps change
  useEffect(() => {
    if (currentStepIndex >= workflowSteps.length) {
      setCurrentStepIndex(Math.max(0, workflowSteps.length - 1));
    }
  }, [workflowSteps.length, currentStepIndex]);

  const currentStep = workflowSteps[currentStepIndex] || workflowSteps[0];
  const currentStepId = currentStep?.id || "project_details";
  const currentStepNumber = currentStepIndex + 1;

  // A quotation has items once at least one room contains a line-item with positive quantity
  const hasAnyItems = useMemo(
    () =>
      (quotation?.rooms ?? []).some((r) =>
        (r.items ?? []).some((i) => (Number(i.quantity) || 0) > 0)
      ),
    [quotation]
  );

  // Check whether a user is allowed to navigate to a specific step
  const canNavigateToStep = useCallback(
    (stepIdentifier: ProposalStep): boolean => {
      const targetIdx = resolveStepIndex(stepIdentifier);
      if (targetIdx === 0) return true; // Step 1 is always accessible

      const targetStep = workflowSteps[targetIdx];
      if (!targetStep) return false;

      // Project must be created before navigating forward
      if (!quotation?.id) return false;

      // For built-in modules, check module prerequisites dynamically against active steps
      if (targetStep.type === "built_in_module" && targetStep.moduleRef) {
        const { allowed } = checkModulePrerequisites(targetStep.moduleRef, quotation, workflowSteps);
        if (!allowed) return false;
      }

      // For custom form steps between/after modules:
      // Can access if quotation exists and prior built-in prerequisites are satisfied
      return true;
    },
    [resolveStepIndex, workflowSteps, quotation]
  );

  // Track completed steps
  const completedStepIds = useMemo(() => {
    const list: string[] = [];
    if (quotation?.clientName) list.push("project_details");
    if ((quotation?.rooms?.length ?? 0) > 0) list.push("space_selection");
    if (hasAnyItems) list.push("product_config");
    if (hasAnyItems) list.push("pricing_review");

    // Also mark custom form steps completed if all required fields are filled
    const customValues = quotation?.customFieldValues || {};
    for (const s of workflowSteps) {
      if (s.type === "custom_form") {
        const allFields = (s.sections || []).flatMap((sec) => sec.fields || []);
        const requiredFields = allFields.filter((f) => f.required);
        const isComplete = requiredFields.every((f) => {
          const val = customValues[f.key];
          return val !== undefined && val !== null && val !== "";
        });
        if (isComplete) {
          list.push(s.id);
        }
      }
    }

    return list;
  }, [quotation, hasAnyItems, workflowSteps]);

  // Navigate to step by ID or index
  const navigateToStep = useCallback(
    (stepIdentifier: ProposalStep) => {
      const targetIdx = resolveStepIndex(stepIdentifier);
      if (targetIdx < 0 || targetIdx >= workflowSteps.length) return;

      const targetStep = workflowSteps[targetIdx];
      setCurrentStepIndex(targetIdx);

      if (onNavigateUrl) {
        onNavigateUrl(targetStep.id, targetIdx + 1);
      }
    },
    [resolveStepIndex, workflowSteps, onNavigateUrl]
  );

  const goToNextStep = useCallback(() => {
    if (currentStepIndex < workflowSteps.length - 1) {
      navigateToStep(workflowSteps[currentStepIndex + 1].id);
    }
  }, [currentStepIndex, workflowSteps, navigateToStep]);

  const goToPrevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      navigateToStep(workflowSteps[currentStepIndex - 1].id);
    }
  }, [currentStepIndex, workflowSteps, navigateToStep]);

  return {
    template,
    setTemplate,
    workflowSteps,
    stepIndicatorItems,
    currentStep,
    currentStepId,
    currentStepIndex,
    currentStepNumber,
    completedStepIds,
    canNavigateToStep,
    navigateToStep,
    goToNextStep,
    goToPrevStep,
    isFirstStep: currentStepIndex === 0,
    isLastStep: currentStepIndex === workflowSteps.length - 1,
    isTemplateLoading,
  };
}
