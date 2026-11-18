import type { BuiltInModuleRef, WorkflowStepDefinition } from "@/types/template";
import type { Quotation } from "@/types";

export interface BuiltInModuleMeta {
  ref: BuiltInModuleRef;
  defaultId: string;
  defaultTitle: string;
  defaultDescription: string;
  requiresQuotation: boolean;
  requiresRooms: boolean;
  requiresItems: boolean;
}

export const BUILT_IN_MODULES: Record<BuiltInModuleRef, BuiltInModuleMeta> = {
  project_details: {
    ref: "project_details",
    defaultId: "project_details",
    defaultTitle: "Project",
    defaultDescription: "Details & Location",
    requiresQuotation: false,
    requiresRooms: false,
    requiresItems: false,
  },
  space_selection: {
    ref: "space_selection",
    defaultId: "space_selection",
    defaultTitle: "Spaces",
    defaultDescription: "Select Rooms",
    requiresQuotation: true,
    requiresRooms: false,
    requiresItems: false,
  },
  product_config: {
    ref: "product_config",
    defaultId: "product_config",
    defaultTitle: "Products",
    defaultDescription: "Configure Devices",
    requiresQuotation: true,
    requiresRooms: true,
    requiresItems: false,
  },
  pricing_review: {
    ref: "pricing_review",
    defaultId: "pricing_review",
    defaultTitle: "Review",
    defaultDescription: "Summary & Pricing",
    requiresQuotation: true,
    requiresRooms: true,
    requiresItems: true,
  },
  proposal_preview: {
    ref: "proposal_preview",
    defaultId: "proposal_preview",
    defaultTitle: "Proposal",
    defaultDescription: "Preview & Export",
    requiresQuotation: true,
    requiresRooms: true,
    requiresItems: true,
  },
};

export function isBuiltInModule(ref: string): ref is BuiltInModuleRef {
  return ref in BUILT_IN_MODULES;
}

export function checkModulePrerequisites(
  moduleRef: BuiltInModuleRef,
  quotation: Quotation | null | undefined,
  activeWorkflowSteps?: WorkflowStepDefinition[]
): { allowed: boolean; reason?: string } {
  const meta = BUILT_IN_MODULES[moduleRef];
  if (!meta) return { allowed: true };

  if (meta.requiresQuotation && !quotation?.id) {
    return { allowed: false, reason: "Please complete the project intake step first." };
  }

  // Only enforce requiresRooms if the workflow template actually incorporates space_selection
  const workflowHasSpaces = activeWorkflowSteps
    ? activeWorkflowSteps.some(
        (s) => s.builtinModule === "space_selection" || s.moduleRef === "space_selection"
      )
    : true;

  if (workflowHasSpaces && meta.requiresRooms) {
    const roomCount = quotation?.rooms?.length ?? 0;
    if (roomCount === 0) {
      return { allowed: false, reason: "Please add at least one space/room." };
    }
  }

  // Only enforce requiresItems if the workflow template incorporates product_config
  const workflowHasProducts = activeWorkflowSteps
    ? activeWorkflowSteps.some(
        (s) => s.builtinModule === "product_config" || s.moduleRef === "product_config"
      )
    : true;

  if (workflowHasProducts && meta.requiresItems) {
    const hasAnyRoomItems = (quotation?.rooms ?? []).some((r) =>
      (r.items ?? []).some((i) => (Number(i.quantity) || 0) > 0)
    );
    const hasAnyRootItems = ((quotation as any)?.items ?? []).some(
      (i: any) => (Number(i.quantity) || 0) > 0 || (Number(i.totalPrice) || 0) > 0
    );
    if (!hasAnyRoomItems && !hasAnyRootItems) {
      return { allowed: false, reason: "Please add at least one product before proceeding." };
    }
  }

  return { allowed: true };
}
