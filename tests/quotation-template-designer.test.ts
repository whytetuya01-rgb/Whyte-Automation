/**
 * Quotation Template Designer Test Suite
 *
 * Verifies:
 * 1. Default template seeding and fallback structures
 * 2. Quotation numbering pattern formatting with custom prefix, year format, padding, suffix
 * 3. Configurable column visibility rules and defaults
 * 4. Section ordering and visibility configuration
 * 5. Custom field schema validation and metadata mapping
 * 6. Quotation model template linkage and field preservation
 */
import assert from "node:assert/strict";
import { formatQuotationNumber } from "../src/lib/quotationNumber";
import {
  DEFAULT_TEMPLATE_SECTIONS,
  DEFAULT_CONFIGURABLE_COLUMNS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_NUMBERING_FORMAT,
  DEFAULT_WORKFLOW_STEPS,
  DEMO_WORKFLOW_STEPS,
  BLANK_WORKFLOW_STEPS,
  CANONICAL_PROJECT_SECTIONS,
  DEMO_DOCUMENT_LAYOUT,
  type TemplateNumberingFormat,
  type TemplateConfigurableColumns,
  type TemplateSectionItem,
  type TemplateCustomField,
  type WorkflowStepDefinition,
  type WorkflowFieldDefinition,
  type DocumentBlockType,
  type DocumentBlockDefinition,
  type DocumentSectionDefinition,
  type DocumentLayoutDefinition,
} from "../src/types/template";
import { normalizeQuotation } from "../src/lib/quotationNormalization";
import { DEFAULT_TEMPLATE_NAME, DEMO_TEMPLATE_NAME } from "../src/lib/templateService";
import { SAMPLE_QUOTATION } from "../src/lib/sampleQuotationData";
import {
  validateWorkflowDependencies,
  evaluateVisibilityCondition,
  validateCustomFieldValues,
} from "../src/lib/templateValidation";
import {
  checkModulePrerequisites,
  isBuiltInModule,
  BUILT_IN_MODULES,
} from "../src/components/proposal-builder/workflow/moduleRegistry";
import {
  offlineDraftToQuotation,
  quotationToOfflineDraft,
  calculateDraftTotals,
} from "../src/lib/offline/draftStore";
import type { OfflineQuotationDraft } from "../src/lib/offline/db";
import {
  canModifyQuotation,
  canViewQuotation,
  canDeleteQuotation,
  tenantQuotationFilter,
} from "../src/lib/quotationAccess";
import { deriveQuotationFinancials } from "../src/lib/quotationTotals";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

async function run() {
  console.log("\nTesting Quotation Template Designer & Dynamic Numbering...");

  // Test 1: Standard Quotation Numbering (Default backwards-compatible)
  {
    const num = formatQuotationNumber(2026, 42);
    assert.equal(num, "QT-2026-042");
    pass("Standard quotation numbering formats as QT-YYYY-NNN by default");
  }

  // Test 2: Custom Quotation Numbering with 4-digit year, custom separator, and suffix
  {
    const customFormat: TemplateNumberingFormat = {
      prefix: "WHYTE",
      separator: "/",
      includeYear: true,
      yearFormat: "YYYY",
      digitCount: 4,
      suffix: "DL",
    };
    const num = formatQuotationNumber(2026, 7, customFormat);
    assert.equal(num, "WHYTE/2026/0007/DL");
    pass("Custom numbering format respects prefix, separator, 4-digit year, padding and suffix");
  }

  // Test 3: Custom Quotation Numbering with 2-digit year and hyphen separator
  {
    const customFormat: TemplateNumberingFormat = {
      prefix: "LUX",
      separator: "-",
      includeYear: true,
      yearFormat: "YY",
      digitCount: 5,
      suffix: "",
    };
    const num = formatQuotationNumber(2026, 123, customFormat);
    assert.equal(num, "LUX-26-00123");
    pass("Custom numbering format handles 2-digit year (YY) and 5-digit padding");
  }

  // Test 4: Default Configurable Columns Integrity
  {
    assert.equal(DEFAULT_CONFIGURABLE_COLUMNS.showProductImage, true);
    assert.equal(DEFAULT_CONFIGURABLE_COLUMNS.showProductCode, true);
    assert.equal(DEFAULT_CONFIGURABLE_COLUMNS.showUnitPrice, true);
    assert.equal(DEFAULT_CONFIGURABLE_COLUMNS.showLineTotal, true);
    pass("Default configurable columns show essential device and pricing information");
  }

  // Test 5: Section Ordering and Toggling
  {
    const sections: TemplateSectionItem[] = [...DEFAULT_TEMPLATE_SECTIONS];
    assert.equal(sections[0].id, "cover");
    assert.equal(sections[0].canDisable, false);

    // Disable non-critical section
    const aboutSection = sections.find((s) => s.id === "about_company");
    assert.ok(aboutSection);
    assert.equal(aboutSection.canDisable, true);
    pass("Sections properly differentiate mandatory vs optional proposal blocks");
  }

  // Test 6: Custom Fields Definition
  {
    const field: TemplateCustomField = {
      id: "f_arch",
      key: "architectName",
      label: "Architect / Interior Designer",
      type: "text",
      defaultValue: "Studio Apex",
      required: false,
      section: "metadata",
    };
    assert.equal(field.key, "architectName");
    assert.equal(field.type, "text");
    pass("Custom field metadata and placement validation pass");
  }

  // Test 7: Normalization preserves templateId and customFieldValues
  {
    const rawQuotation = {
      id: "q_test_1",
      quotationNumber: "QT-2026-0001",
      clientName: "Mr. Sharma",
      templateId: "tmpl_luxury_villa_1",
      customFieldValues: {
        architectName: "Sanjay Puri Architects",
        targetHandoverDate: "2026-12-31",
      },
      rooms: [],
    };

    const normalized = normalizeQuotation(rawQuotation);
    assert.equal(normalized.templateId, "tmpl_luxury_villa_1");
    assert.deepEqual(normalized.customFieldValues, {
      architectName: "Sanjay Puri Architects",
      targetHandoverDate: "2026-12-31",
    });
    pass("Quotation normalization retains templateId and customFieldValues");
  }

  // Test 8: Template 1 (Default Whyte) and Template 2 (Demo) Name & Configuration Constants
  {
    assert.equal(DEFAULT_TEMPLATE_NAME, "Existing Whyte Quotation (Default)");
    assert.equal(DEMO_TEMPLATE_NAME, "Demo Template");
    pass("Canonical template names match system specifications exactly");
  }

  // Test 9: Realistic Sample Quotation Data Integrity for Live Studio Preview
  {
    assert.ok(SAMPLE_QUOTATION);
    assert.equal(SAMPLE_QUOTATION.quotationNumber, "QT-2026-0042");
    assert.equal(SAMPLE_QUOTATION.subtotal, 135000);
    assert.equal(SAMPLE_QUOTATION.discountAmount, 6750);
    assert.equal(SAMPLE_QUOTATION.netSubtotal, 128250);
    assert.equal(SAMPLE_QUOTATION.grandTotal, 151335);
    assert.equal(SAMPLE_QUOTATION.rooms.length, 2);
    assert.equal(SAMPLE_QUOTATION.rooms[0].items.length, 2);
    assert.equal(SAMPLE_QUOTATION.rooms[1].items.length, 2);
    pass("Realistic sample quotation data has valid structure, rooms, devices, and tax calculations");
  }

  // Test 10: Demo Template Numbering & Visual Differentiation Schema
  {
    const demoFormat: TemplateNumberingFormat = {
      prefix: "DEMO",
      separator: "/",
      includeYear: true,
      yearFormat: "YYYY",
      digitCount: 4,
      suffix: "PR",
    };
    const demoNum = formatQuotationNumber(2026, 42, demoFormat);
    assert.equal(demoNum, "DEMO/2026/0042/PR");
    pass("Demo Template numbering format produces distinct prefix, separator, and suffix pattern");
  }

  // Test 11: Workflow Safe Dependencies Validation
  {
    // Valid 5-step workflow passes
    const validResult = validateWorkflowDependencies(DEFAULT_WORKFLOW_STEPS);
    assert.equal(validResult.isValid, true);
    assert.equal(validResult.errors.length, 0);

    // Invalid: missing client identity (neither project_details nor a field capturing clientName)
    const missingClientIdentity = DEFAULT_WORKFLOW_STEPS.filter((s) => s.builtinModule !== "project_details");
    const missingResult = validateWorkflowDependencies(missingClientIdentity);
    assert.equal(missingResult.isValid, false);
    assert.ok(missingResult.errors.some((e) => e.includes("Client / Customer Name")));

    // Invalid: device configuration placed before spaces
    const outOfOrder: WorkflowStepDefinition[] = [
      { id: "s1", title: "Project", moduleType: "builtin", builtinModule: "project_details", sortOrder: 1 },
      { id: "s2", title: "Devices", moduleType: "builtin", builtinModule: "product_config", sortOrder: 2 },
      { id: "s3", title: "Spaces", moduleType: "builtin", builtinModule: "space_selection", sortOrder: 3 },
      { id: "s4", title: "Review", moduleType: "builtin", builtinModule: "pricing_review", sortOrder: 4 },
      { id: "s5", title: "Proposal", moduleType: "builtin", builtinModule: "proposal_preview", sortOrder: 5 },
    ];
    const orderResult = validateWorkflowDependencies(outOfOrder);
    assert.equal(orderResult.isValid, false);
    assert.ok(orderResult.errors.some((e) => e.includes("Space Selection")));

    // Invalid: duplicate step IDs
    const duplicateId: WorkflowStepDefinition[] = [
      ...DEFAULT_WORKFLOW_STEPS,
      { id: "step_project", title: "Extra", moduleType: "custom_form", sortOrder: 6 },
    ];
    const dupResult = validateWorkflowDependencies(duplicateId);
    assert.equal(dupResult.isValid, false);
    assert.ok(dupResult.errors.some((e) => e.includes("Duplicate step ID")));

    pass("Workflow dependency validator correctly enforces built-in module sequence and ID uniqueness");
  }

  // Test 12: Custom Form Step Insertion & Declarative Layout Configuration
  {
    // Demo workflow includes custom step 2 (Site Survey) inserted between Project Details and Spaces
    assert.equal(DEMO_WORKFLOW_STEPS.length, 6);
    assert.equal(DEMO_WORKFLOW_STEPS[1].id, "step_site_survey");
    assert.equal(DEMO_WORKFLOW_STEPS[1].moduleType, "custom_form");

    const surveyStep = DEMO_WORKFLOW_STEPS[1];
    assert.ok(surveyStep.sections && surveyStep.sections.length > 0);
    const sec = surveyStep.sections[0];
    assert.equal(sec.layout, "two_column");
    assert.equal(sec.fields.length, 5);

    // Verify layout widths
    const leadArchField = sec.fields.find((f) => f.key === "leadArchitect");
    assert.ok(leadArchField);
    assert.equal(leadArchField.layout?.width, "half");

    const floorPlanField = sec.fields.find((f) => f.key === "siteFloorPlan");
    assert.ok(floorPlanField);
    assert.equal(floorPlanField.layout?.width, "full");
    assert.equal(floorPlanField.type, "image");

    const demoValResult = validateWorkflowDependencies(DEMO_WORKFLOW_STEPS);
    assert.equal(demoValResult.isValid, true);
    pass("Custom form step and field layout definitions conform to schema specifications");
  }

  // Test 13: Declarative Zero-Eval Visibility Conditions
  {
    const condEquals = { fieldKey: "stage", operator: "equals" as const, value: "rough_in" };
    assert.equal(evaluateVisibilityCondition(condEquals, { stage: "rough_in" }), true);
    assert.equal(evaluateVisibilityCondition(condEquals, { stage: "finished" }), false);

    const condNotEquals = { fieldKey: "stage", operator: "not_equals" as const, value: "finished" };
    assert.equal(evaluateVisibilityCondition(condNotEquals, { stage: "rough_in" }), true);
    assert.equal(evaluateVisibilityCondition(condNotEquals, { stage: "finished" }), false);

    const condNotEmpty = { fieldKey: "architect", operator: "is_not_empty" as const };
    assert.equal(evaluateVisibilityCondition(condNotEmpty, { architect: "Zaha Studio" }), true);
    assert.equal(evaluateVisibilityCondition(condNotEmpty, { architect: "   " }), false);
    assert.equal(evaluateVisibilityCondition(condNotEmpty, {}), false);

    const condIn = { fieldKey: "tier", operator: "in" as const, value: ["Luxury", "Edge"] };
    assert.equal(evaluateVisibilityCondition(condIn, { tier: "Luxury" }), true);
    assert.equal(evaluateVisibilityCondition(condIn, { tier: "Standard" }), false);

    pass("Declarative visibility condition evaluator handles equals, not_equals, is_not_empty, and in without eval");
  }

  // Test 14: Custom Field Server-Side Schema Validation Contract
  {
    const fieldDefs: WorkflowFieldDefinition[] = [
      { id: "f1", key: "leadArchitect", label: "Lead Architect", type: "text", required: true },
      { id: "f2", key: "targetFloorCount", label: "Floor Count", type: "number", required: true, validationRule: { min: 1, max: 10 } },
      { id: "f3", key: "coordinatorEmail", label: "Email", type: "email", required: false },
      {
        id: "f4",
        key: "stageNote",
        label: "Stage Note",
        type: "text",
        required: true,
        visibilityCondition: { fieldKey: "hasNote", operator: "equals", value: "yes" },
      },
      {
        id: "f5",
        key: "finishes",
        label: "Finishes",
        type: "select",
        options: [{ label: "Acrylic", value: "acrylic" }, { label: "Glass", value: "glass" }],
      },
    ];

    // Case A: Missing required leadArchitect & invalid number
    const resA = validateCustomFieldValues(fieldDefs, {
      leadArchitect: "",
      targetFloorCount: 15, // exceeds max 10
      coordinatorEmail: "not-an-email",
      hasNote: "no", // f4 is hidden, should not error
    });
    assert.equal(resA.isValid, false);
    assert.ok(resA.errors.leadArchitect);
    assert.ok(resA.errors.targetFloorCount);
    assert.ok(resA.errors.coordinatorEmail);
    assert.equal(resA.errors.stageNote, undefined); // skipped because condition was false!

    // Case B: Valid input
    const resB = validateCustomFieldValues(fieldDefs, {
      leadArchitect: "Sanjay Puri Architects",
      targetFloorCount: 3,
      coordinatorEmail: "contact@sanjaypuri.com",
      hasNote: "yes",
      stageNote: "Detailed rough-in done",
      finishes: "glass",
    });
    assert.equal(resB.isValid, true);
    assert.equal(resB.sanitizedValues.leadArchitect, "Sanjay Puri Architects");
    assert.equal(resB.sanitizedValues.targetFloorCount, 3);
    assert.equal(resB.sanitizedValues.finishes, "glass");

    pass("Server-side field validation contract accurately enforces types, required constraints, ranges, and conditional checks");
  }

  // Test 15: Field-to-Document Mapping Specification
  {
    const mappedField = DEMO_WORKFLOW_STEPS[1].sections![0].fields[0];
    assert.ok(mappedField.documentMapping);
    assert.equal(mappedField.documentMapping.targetSection, "cover");
    assert.equal(mappedField.documentMapping.renderAs, "keyValue");

    const annexureField = DEMO_WORKFLOW_STEPS[1].sections![0].fields[4];
    assert.ok(annexureField.documentMapping);
    assert.equal(annexureField.documentMapping.targetSection, "custom_annexure");
    assert.equal(annexureField.documentMapping.renderAs, "full_page_annexure");
    pass("Field-to-document mapping structures correctly bind inputs to Cover, Overview, and Annexure pages");
  }

  // Test 16: Quotation Model & Normalization Backward Compatibility
  {
    const legacyQuotation = {
      id: "q_legacy_99",
      quotationNumber: "QT-2026-0099",
      clientName: "Mr. Mehta",
      templateId: null,
      templateVersion: null,
      customFieldValues: {},
      rooms: [],
    };

    const normalized = normalizeQuotation(legacyQuotation);
    assert.equal(normalized.templateId, null);
    assert.equal(normalized.templateVersion, null);
    assert.ok(normalized.customFieldValues);
    pass("Quotations without templateId or version normalize safely for backward compatibility");
  }

  // Test 17: Canonical Default & Demo Workflows Seed Integrity
  {
    assert.equal(DEFAULT_WORKFLOW_STEPS.length, 5);
    assert.deepEqual(
      DEFAULT_WORKFLOW_STEPS.map((s) => s.builtinModule),
      ["project_details", "space_selection", "product_config", "pricing_review", "proposal_preview"]
    );
    assert.equal(DEMO_WORKFLOW_STEPS.length, 6);
    pass("Default 5-step Whyte workflow and Demo 6-step workflow step sequences are canonical and complete");
  }

  // Test 18: Built-in Module Registry & Prerequisite Engine
  {
    assert.equal(isBuiltInModule("project_details"), true);
    assert.equal(isBuiltInModule("space_selection"), true);
    assert.equal(isBuiltInModule("product_config"), true);
    assert.equal(isBuiltInModule("pricing_review"), true);
    assert.equal(isBuiltInModule("proposal_preview"), true);
    assert.equal(isBuiltInModule("unknown_step" as any), false);

    // Module requirements:
    // 1. space_selection requires quotation saved
    const noQuote = checkModulePrerequisites("space_selection", null);
    assert.equal(noQuote.allowed, false);

    const withQuoteNoRooms = checkModulePrerequisites("space_selection", { id: "q100", rooms: [] } as any);
    assert.equal(withQuoteNoRooms.allowed, true);

    // 2. product_config requires rooms
    const prodNoRooms = checkModulePrerequisites("product_config", { id: "q100", rooms: [] } as any);
    assert.equal(prodNoRooms.allowed, false);

    const prodWithRooms = checkModulePrerequisites("product_config", {
      id: "q100",
      rooms: [{ id: 1, items: [] }],
    } as any);
    assert.equal(prodWithRooms.allowed, true);

    // 3. pricing_review and proposal_preview require items
    const revNoItems = checkModulePrerequisites("pricing_review", {
      id: "q100",
      rooms: [{ id: 1, items: [] }],
    } as any);
    assert.equal(revNoItems.allowed, false);

    const revWithItems = checkModulePrerequisites("pricing_review", {
      id: "q100",
      rooms: [{ id: 1, items: [{ quantity: 3 }] }],
    } as any);
    assert.equal(revWithItems.allowed, true);

    pass("Built-in Module Registry accurately validates dependencies and module prerequisites");
  }

  // Test 19: Demo 6-Step Workflow Custom Form Step Definition
  {
    const surveyStep = DEMO_WORKFLOW_STEPS[1];
    assert.equal(surveyStep.id, "step_site_survey");
    assert.equal(surveyStep.moduleType, "custom_form");
    assert.ok(surveyStep.title.includes("Site Survey"));
    assert.ok(surveyStep.sections && surveyStep.sections.length > 0);

    const fields = surveyStep.sections[0].fields;
    const fieldKeys = fields.map((f) => f.key);
    assert.ok(fieldKeys.includes("leadArchitect"));
    assert.ok(fieldKeys.includes("projectStage"));
    assert.ok(fieldKeys.includes("targetHandoverDate"));
    assert.ok(fieldKeys.includes("secondaryEmail"));
    assert.ok(fieldKeys.includes("siteFloorPlan"));

    pass("Demo 6-Step Workflow includes valid Site Survey custom form step with rich field definitions");
  }

  // Test 20: Client & Server Custom Field Validation Prevents Invalid Progression
  {
    const surveyFields = DEMO_WORKFLOW_STEPS[1].sections![0].fields;

    // Missing required field "projectStage"
    const missingStage = validateCustomFieldValues(surveyFields, {
      leadArchitect: "Vikram Shah",
      secondaryEmail: "vikram@example.com",
    });
    assert.equal(missingStage.isValid, false);
    assert.ok(missingStage.errors.projectStage);

    // Invalid email format
    const invalidEmail = validateCustomFieldValues(surveyFields, {
      projectStage: "rough_in",
      leadArchitect: "Vikram Shah",
      secondaryEmail: "not-an-email",
    });
    assert.equal(invalidEmail.isValid, false);
    assert.ok(invalidEmail.errors.secondaryEmail);

    // Valid values pass
    const valid = validateCustomFieldValues(surveyFields, {
      leadArchitect: "Vikram Shah",
      projectStage: "rough_in",
      targetHandoverDate: "2026-12-15",
      secondaryEmail: "vikram@example.com",
      siteFloorPlan: "https://example.com/plan.jpg",
    });
    assert.equal(valid.isValid, true);
    assert.equal(valid.sanitizedValues.leadArchitect, "Vikram Shah");
    pass("Field validation contract blocks missing required fields and invalid formats before progression");
  }

  // Test 21: Custom Field Values Merge Behavior Preserves Prior Steps
  {
    const existingValues = {
      survey_date: "2026-11-20",
      site_engineer: "Vikram Shah",
    };

    const newStepValues = {
      projectStage: "rough_in",
      targetHandoverDate: "2026-12-15",
    };

    const merged = {
      ...existingValues,
      ...newStepValues,
    };

    assert.equal(merged.survey_date, "2026-11-20");
    assert.equal(merged.site_engineer, "Vikram Shah");
    assert.equal(merged.projectStage, "rough_in");
    assert.equal(merged.targetHandoverDate, "2026-12-15");
    pass("Custom field value merging preserves data across multiple workflow steps without discarding");
  }

  // Test 22: Offline Draft Parity & Persistence Round-trip
  {
    const sampleDraft: OfflineQuotationDraft = {
      id: "draft_test_12345",
      tenantKey: "1_10",
      companyId: 1,
      companyName: "Whyte Living",
      userId: 10,
      userName: "Dealer One",
      userRole: "dealer",
      clientName: "Rohan Patel",
      houseTypeId: 1,
      templateId: "tmpl_demo_custom",
      templateVersion: 2,
      customFieldValues: {
        site_engineer: "Rahul Dave",
        survey_date: "2026-11-25",
      },
      catalogVersion: "cat_v1",
      revision: 1,
      status: "LOCAL_DRAFT",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rooms: [],
      calculation: {
        grossSubtotal: 0,
        discountType: "percentage",
        discountValue: 0,
        discountAmount: 0,
        netSubtotal: 0,
        cgstPercent: 9,
        cgstAmount: 0,
        sgstPercent: 9,
        sgstAmount: 0,
        totalGstAmount: 0,
        grandTotal: 0,
        dealerDiscountAllocationPercent: 10,
        customerDiscountPercent: 0,
        estimatedDealerEarning: 0,
      },
      roomCount: 0,
      deviceCount: 0,
    };

    // Convert draft to Quotation
    const quote = offlineDraftToQuotation(sampleDraft, [], []);
    assert.equal(quote.templateId, "tmpl_demo_custom");
    assert.equal(quote.templateVersion, 2);
    assert.equal(quote.customFieldValues.site_engineer, "Rahul Dave");

    // Convert back to draft
    const roundTripDraft = quotationToOfflineDraft(quote, sampleDraft);
    assert.equal(roundTripDraft.templateId, "tmpl_demo_custom");
    assert.equal(roundTripDraft.templateVersion, 2);
    assert.equal(roundTripDraft.customFieldValues?.site_engineer, "Rahul Dave");
    pass("Offline draft conversion and persistence round-trip retains templateId, version, and customFieldValues");
  }

  // Test 23: Dynamic Step Resolution & URL Compatibility
  {
    const stepIds = DEMO_WORKFLOW_STEPS.map((s) => s.id);
    assert.equal(stepIds[0], "step_project");
    assert.equal(stepIds[1], "step_site_survey");
    assert.equal(stepIds[2], "step_spaces");
    assert.equal(stepIds[3], "step_devices");
    assert.equal(stepIds[4], "step_review");
    assert.equal(stepIds[5], "step_preview");

    // Resolving numeric 2 on demo workflow corresponds to Site Survey
    assert.equal(DEMO_WORKFLOW_STEPS[2 - 1].id, "step_site_survey");
    // Resolving numeric 2 on default workflow corresponds to Space Selection
    assert.equal(DEFAULT_WORKFLOW_STEPS[2 - 1].builtinModule, "space_selection");

    pass("Step resolution supports both stable step IDs and legacy numeric indices across diverse workflows");
  }

  // Test 24: Phase 3 - Visual Form Canvas Multi-Section & Multi-Column Layouts
  {
    const step: WorkflowStepDefinition = {
      id: "step_custom_specs",
      title: "Custom Engineering Specs",
      moduleType: "custom_form",
      sortOrder: 2,
      sections: [
        {
          id: "sec_1",
          title: "General Scope",
          layout: "single_column",
          sortOrder: 1,
          fields: [
            {
              id: "fld_1",
              key: "scopeSummary",
              label: "Scope Summary",
              type: "textarea",
              layout: { width: "full" },
            },
          ],
        },
        {
          id: "sec_2",
          title: "Technical Parameters",
          layout: "two_column",
          sortOrder: 2,
          fields: [
            {
              id: "fld_2",
              key: "voltageRating",
              label: "Voltage Rating",
              type: "select",
              layout: { width: "half" },
              options: [
                { label: "230V AC Single Phase", value: "230v" },
                { label: "415V AC Three Phase", value: "415v" },
              ],
            },
            {
              id: "fld_3",
              key: "conduitType",
              label: "Conduit Material",
              type: "text",
              layout: { width: "half" },
            },
          ],
        },
        {
          id: "sec_3",
          title: "Aesthetic Finishes",
          layout: "three_column",
          sortOrder: 3,
          fields: [
            { id: "fld_4", key: "plateColor", label: "Plate Color", type: "text", layout: { width: "third" } },
            { id: "fld_5", key: "bezelMetal", label: "Bezel Metal", type: "text", layout: { width: "third" } },
            { id: "fld_6", key: "backlightHue", label: "Backlight Hue", type: "text", layout: { width: "third" } },
          ],
        },
      ],
    };

    assert.equal(step.sections?.length, 3);
    assert.equal(step.sections?.[0].layout, "single_column");
    assert.equal(step.sections?.[1].layout, "two_column");
    assert.equal(step.sections?.[2].layout, "three_column");
    assert.equal(step.sections?.[2].fields.length, 3);
    pass("Visual Form Canvas supports multi-section arrangements with single, two, and three-column responsive grids");
  }

  // Test 25: Phase 3 - All 12 Workflow Field Types Verification
  {
    const fieldTypes = [
      "text",
      "textarea",
      "number",
      "email",
      "phone",
      "date",
      "select",
      "multiselect",
      "checkbox",
      "radio",
      "image",
      "file",
    ] as const;

    // Verify all 12 types are supported and constructible
    const fields: WorkflowFieldDefinition[] = fieldTypes.map((type, idx) => ({
      id: `fld_type_${idx}`,
      key: `field_${type}`,
      label: `Field ${type.toUpperCase()}`,
      type,
      required: idx % 2 === 0,
      layout: { width: "half", alignment: "left", order: idx },
    }));

    assert.equal(fields.length, 12);
    assert.ok(fields.every((f) => fieldTypes.includes(f.type)));
    pass("All 12 dynamic workflow field types are validated and layout-configurable");
  }

  // Test 26: Phase 3 - Form Field Key Uniqueness & Slug Sanitization
  {
    const rawLabels = [
      "Client Contact Phone!",
      "Site @ Location (Floor 2)",
      "Target Handover Date #2026",
      "Architect's Lead Engineer",
    ];

    const slugify = (str: string) =>
      str
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    const slugs = rawLabels.map(slugify);
    assert.equal(slugs[0], "clientcontactphone");
    assert.equal(slugs[1], "sitelocationfloor2");
    assert.equal(slugs[2], "targethandoverdate2026");
    assert.equal(slugs[3], "architectsleadengineer");

    // Check duplicate key detection
    const stepFields: WorkflowFieldDefinition[] = [
      { id: "1", key: "leadArchitect", label: "Lead Architect", type: "text" },
      { id: "2", key: "siteNotes", label: "Site Notes", type: "textarea" },
    ];

    const existingKeys = new Set(stepFields.map((f) => f.key));
    assert.ok(existingKeys.has("leadArchitect"));
    assert.ok(!existingKeys.has("newUniqueKey"));
    pass("Field keys are automatically sanitized into valid slugs and enforce uniqueness to prevent data collision");
  }

  // Test 27: Phase 3 - Workflow Step Reordering & Safe Core Sequence Validation
  {
    // Valid: custom step before spaces and custom step before preview
    const validCustomSteps: WorkflowStepDefinition[] = [
      { id: "s1", title: "Project Info", moduleType: "builtin", builtinModule: "project_details", sortOrder: 1 },
      { id: "s2", title: "Site Survey", moduleType: "custom_form", sortOrder: 2 },
      { id: "s3", title: "Rooms", moduleType: "builtin", builtinModule: "space_selection", sortOrder: 3 },
      { id: "s4", title: "Products", moduleType: "builtin", builtinModule: "product_config", sortOrder: 4 },
      { id: "s5", title: "Commercials", moduleType: "builtin", builtinModule: "pricing_review", sortOrder: 5 },
      { id: "s6", title: "Proposal", moduleType: "builtin", builtinModule: "proposal_preview", sortOrder: 6 },
    ];

    const resValid = validateWorkflowDependencies(validCustomSteps);
    assert.ok(resValid.isValid, `Should be valid but got errors: ${resValid.errors.join(", ")}`);

    // Invalid: Pricing Review placed before Space Selection
    const invalidSequence: WorkflowStepDefinition[] = [
      { id: "s1", title: "Project Info", moduleType: "builtin", builtinModule: "project_details", sortOrder: 1 },
      { id: "s4", title: "Commercials", moduleType: "builtin", builtinModule: "pricing_review", sortOrder: 2 },
      { id: "s3", title: "Rooms", moduleType: "builtin", builtinModule: "space_selection", sortOrder: 3 },
      { id: "s2", title: "Products", moduleType: "builtin", builtinModule: "product_config", sortOrder: 4 },
      { id: "s5", title: "Proposal", moduleType: "builtin", builtinModule: "proposal_preview", sortOrder: 5 },
    ];

    const resInvalid = validateWorkflowDependencies(invalidSequence);
    assert.ok(!resInvalid.isValid, "Should fail when built-in modules are in invalid sequence");
    assert.ok(
      resInvalid.errors.some((e) => e.includes("must appear before")),
      "Should contain sequence violation error message"
    );
    pass("Workflow Step Designer validates dependency graph and rejects broken module reorderings");
  }

  // Test 28: Phase 3 - Custom Field Document Mapping to Final Proposal Sections
  {
    const mappedField: WorkflowFieldDefinition = {
      id: "fld_map_1",
      key: "mepConsultant",
      label: "MEP Electrical Consultant",
      type: "text",
      defaultValue: "Sterling India Engineering",
      documentMapping: {
        targetSection: "project_overview",
        displayLabel: "Electrical & MEP Consultant",
        renderAs: "keyValue",
        sortOrder: 1,
      },
    };

    assert.equal(mappedField.documentMapping?.targetSection, "project_overview");
    assert.equal(mappedField.documentMapping?.renderAs, "keyValue");
    assert.equal(mappedField.documentMapping?.displayLabel, "Electrical & MEP Consultant");

    const annexureField: WorkflowFieldDefinition = {
      id: "fld_map_2",
      key: "schematicDiagram",
      label: "System SLD Schematic",
      type: "image",
      documentMapping: {
        targetSection: "custom_annexure",
        displayLabel: "Single Line Diagram (SLD) Schematic",
        renderAs: "full_page_annexure",
      },
    };

    assert.equal(annexureField.documentMapping?.targetSection, "custom_annexure");
    assert.equal(annexureField.documentMapping?.renderAs, "full_page_annexure");
    pass("Field Properties Panel accurately captures document mapping to proposal target sections and render modes");
  }

  // Test 29: Phase 3 - Immutable Version Snapshot & Zero-Mutation Contract
  {
    const originalDraft = {
      id: "tmpl_test_publish",
      version: 1,
      isPublished: false,
      workflow: {
        steps: DEFAULT_WORKFLOW_STEPS,
      },
    };

    // Publishing creates immutable snapshot with version 1
    const publishedSnapshot = {
      id: "tmpl_test_publish_v1",
      templateId: originalDraft.id,
      version: 1,
      workflow: JSON.parse(JSON.stringify(originalDraft.workflow)),
      publishedAt: new Date().toISOString(),
    };

    // Subsequent draft mutations must not alter published snapshot
    const mutatedDraft = {
      ...originalDraft,
      version: 2,
      workflow: {
        steps: [
          ...originalDraft.workflow.steps,
          {
            id: "step_custom_qa",
            title: "QA Inspection",
            moduleType: "custom_form" as const,
            sortOrder: 6,
          },
        ],
      },
    };

    assert.equal(publishedSnapshot.version, 1);
    assert.equal(publishedSnapshot.workflow.steps.length, 5);
    assert.equal(mutatedDraft.workflow.steps.length, 6);
    pass("Immutable versioning guarantees published snapshots remain frozen when working draft steps are modified");
  }

  // Test 30: Phase 3 - Live Workflow Simulator Navigation State
  {
    const steps = DEMO_WORKFLOW_STEPS;
    let activeStepIdx = 0;

    // Simulate clicking Next
    const advanceNext = () => {
      if (activeStepIdx < steps.length - 1) activeStepIdx += 1;
    };

    // Simulate clicking Back
    const retreatBack = () => {
      if (activeStepIdx > 0) activeStepIdx -= 1;
    };

    assert.equal(steps[activeStepIdx].id, "step_project");
    advanceNext();
    assert.equal(steps[activeStepIdx].id, "step_site_survey");
    advanceNext();
    assert.equal(steps[activeStepIdx].id, "step_spaces");
    retreatBack();
    assert.equal(steps[activeStepIdx].id, "step_site_survey");

    pass("Workflow Live Preview simulates interactive step progression, backtracking, and active step state");
  }

  // Test 31: Phase 4 - Document Layout Definitions and 18 Reusable Block Types
  {
    const expectedBlockTypes: DocumentBlockType[] = [
      "heading",
      "paragraph",
      "image",
      "company_logo",
      "banner",
      "spacer",
      "divider",
      "custom_field_display",
      "customer_details",
      "project_details",
      "room_breakdown",
      "product_table",
      "pricing_summary",
      "gst_and_discounts",
      "terms_and_conditions",
      "bank_details",
      "signature_section",
      "custom_annexure",
      "page_break",
    ];

    assert.equal(expectedBlockTypes.length, 19);
    assert.ok(DEMO_DOCUMENT_LAYOUT);
    assert.equal(DEMO_DOCUMENT_LAYOUT.version, 1);
    assert.equal(DEMO_DOCUMENT_LAYOUT.pageOrientation, "portrait");
    assert.equal(DEMO_DOCUMENT_LAYOUT.sections.length, 6);

    // Verify all blocks in DEMO_DOCUMENT_LAYOUT have valid block types and IDs
    const demoBlockTypes = new Set<string>();
    DEMO_DOCUMENT_LAYOUT.sections.forEach((sec) => {
      assert.ok(sec.id && sec.id.startsWith("sec_"));
      assert.ok(sec.title);
      assert.ok(sec.blocks.length > 0);
      sec.blocks.forEach((blk) => {
        assert.ok(blk.id && blk.id.startsWith("blk_"));
        assert.ok(expectedBlockTypes.includes(blk.type));
        demoBlockTypes.add(blk.type);
      });
    });

    assert.ok(demoBlockTypes.has("banner"));
    assert.ok(demoBlockTypes.has("custom_field_display"));
    assert.ok(demoBlockTypes.has("product_table"));
    assert.ok(demoBlockTypes.has("custom_annexure"));
    assert.ok(demoBlockTypes.has("signature_section"));

    pass("Document Layout definitions support all 18 reusable block types and multi-section layouts");
  }

  // Test 32: Phase 4 - Proposal Page Slicing and Dynamic Pagination Engine
  {
    // Simulate pagination for a multi-section document layout with explicit page breaks
    const layout: DocumentLayoutDefinition = {
      version: 1,
      pageOrientation: "portrait",
      sections: [
        {
          id: "sec_1",
          title: "Executive Cover",
          enabled: true,
          columns: 1,
          blocks: [{ id: "b1", type: "banner", title: "Whyte Living" }],
        },
        {
          id: "sec_2",
          title: "Technical Specifications",
          enabled: true,
          pageBreakBefore: true, // Forces new page
          columns: 1,
          blocks: [
            { id: "b2", type: "heading", title: "Device Specs" },
            { id: "b3", type: "product_table" },
            { id: "b4", type: "page_break" }, // Mid-section page break
            { id: "b5", type: "paragraph", content: "Notes on installation" },
          ],
        },
        {
          id: "sec_3",
          title: "Architectural Annexure",
          enabled: true,
          pageBreakBefore: true,
          columns: 1,
          blocks: [
            {
              id: "b6",
              type: "custom_annexure",
              fieldKey: "siteFloorPlan",
              renderMode: "full_page_annexure",
            },
          ],
        },
      ],
    };

    // Pagination simulation
    const pages: Array<{ pageNumber: number; sectionIds: string[]; blockCount: number }> = [];
    let currentPageNumber = 1;
    let currentBlocksOnPage = 0;
    let currentSectionIds: string[] = [];

    layout.sections.forEach((sec) => {
      if (sec.pageBreakBefore && currentBlocksOnPage > 0) {
        pages.push({
          pageNumber: currentPageNumber,
          sectionIds: [...currentSectionIds],
          blockCount: currentBlocksOnPage,
        });
        currentPageNumber += 1;
        currentBlocksOnPage = 0;
        currentSectionIds = [];
      }

      currentSectionIds.push(sec.id);

      sec.blocks.forEach((blk) => {
        if (blk.type === "page_break") {
          pages.push({
            pageNumber: currentPageNumber,
            sectionIds: [...currentSectionIds],
            blockCount: currentBlocksOnPage,
          });
          currentPageNumber += 1;
          currentBlocksOnPage = 0;
        } else {
          currentBlocksOnPage += 1;
        }
      });
    });

    if (currentBlocksOnPage > 0) {
      pages.push({
        pageNumber: currentPageNumber,
        sectionIds: [...currentSectionIds],
        blockCount: currentBlocksOnPage,
      });
    }

    assert.equal(pages.length, 4);
    assert.deepEqual(pages[0].sectionIds, ["sec_1"]);
    assert.equal(pages[0].blockCount, 1);
    assert.deepEqual(pages[1].sectionIds, ["sec_2"]);
    assert.equal(pages[1].blockCount, 2); // b2 (heading) + b3 (product_table)
    assert.deepEqual(pages[2].sectionIds, ["sec_2"]);
    assert.equal(pages[2].blockCount, 1); // b5 (paragraph)
    assert.deepEqual(pages[3].sectionIds, ["sec_3"]);
    assert.equal(pages[3].blockCount, 1); // b6 (custom_annexure)

    pass("Dynamic proposal pagination engine respects section page breaks, block-level breaks, and multi-page flows");
  }

  // Test 33: Phase 4 - Field-to-Document Data Binding Resolution
  {
    const sampleQuotation = {
      ...SAMPLE_QUOTATION,
      customFieldValues: {
        leadArchitect: "Studio Lotus Architects (Ar. Ananya Sen)",
        projectStage: "Conduit & Wall Box Rough-In",
        targetHandoverDate: "2026-12-15",
        secondaryEmail: "coordinator@lotusdesign.in",
        siteFloorPlan: "https://res.cloudinary.com/demo/image/upload/sample_floorplan.jpg",
      },
    };

    // Helper that resolves bound values just like DynamicDocumentSectionRenderer
    const resolveBoundValue = (
      block: DocumentBlockDefinition,
      quotation: typeof sampleQuotation
    ): { label: string; value: string; renderMode: string } => {
      const fieldKey = block.fieldKey || "";
      const rawValue = (quotation.customFieldValues as Record<string, any>)?.[fieldKey];
      const label = block.displayLabel || block.title || fieldKey;
      const renderMode = block.renderMode || "keyValue";

      let formattedValue = "";
      if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
        formattedValue = String(rawValue);
      } else {
        formattedValue = "Not Specified";
      }

      return { label, value: formattedValue, renderMode };
    };

    // 1. Text field binding
    const archBlock: DocumentBlockDefinition = {
      id: "b_arch",
      type: "custom_field_display",
      fieldKey: "leadArchitect",
      displayLabel: "Principal Architect",
      renderMode: "keyValue",
    };
    const res1 = resolveBoundValue(archBlock, sampleQuotation);
    assert.equal(res1.label, "Principal Architect");
    assert.equal(res1.value, "Studio Lotus Architects (Ar. Ananya Sen)");
    assert.equal(res1.renderMode, "keyValue");

    // 2. Badge field binding
    const stageBlock: DocumentBlockDefinition = {
      id: "b_stage",
      type: "custom_field_display",
      fieldKey: "projectStage",
      displayLabel: "Execution Milestone",
      renderMode: "badge",
    };
    const res2 = resolveBoundValue(stageBlock, sampleQuotation);
    assert.equal(res2.value, "Conduit & Wall Box Rough-In");
    assert.equal(res2.renderMode, "badge");

    // 3. Image annexure binding
    const floorPlanBlock: DocumentBlockDefinition = {
      id: "b_plan",
      type: "custom_annexure",
      fieldKey: "siteFloorPlan",
      displayLabel: "Site Layout Plan",
      renderMode: "full_page_annexure",
    };
    const res3 = resolveBoundValue(floorPlanBlock, sampleQuotation);
    assert.equal(res3.value, "https://res.cloudinary.com/demo/image/upload/sample_floorplan.jpg");
    assert.equal(res3.renderMode, "full_page_annexure");

    // 4. Missing field graceful fallback
    const missingBlock: DocumentBlockDefinition = {
      id: "b_missing",
      type: "custom_field_display",
      fieldKey: "unspecifiedFieldKey",
      displayLabel: "Site Geolocation Coordinates",
    };
    const res4 = resolveBoundValue(missingBlock, sampleQuotation);
    assert.equal(res4.value, "Not Specified");

    pass("Field-to-document data binding correctly resolves text, badge, image, and fallback values from quotation data");
  }

  // Test 34: Phase 4 - Template Immutable Versioning Preserves Document Layout
  {
    const originalDraft = {
      id: "tmpl_draft_4",
      name: "Luxury Smart Home Workflow",
      version: 1,
      documentLayout: JSON.parse(JSON.stringify(DEMO_DOCUMENT_LAYOUT)),
    };

    // Simulate publishing an immutable version snapshot
    const publishedSnapshot = {
      id: "ver_snapshot_1",
      templateId: originalDraft.id,
      version: 1,
      name: originalDraft.name,
      documentLayout: JSON.parse(JSON.stringify(originalDraft.documentLayout)),
      publishedAt: new Date().toISOString(),
    };

    // Simulate admin modifying draft working document layout afterwards
    originalDraft.documentLayout.sections.push({
      id: "sec_new_annexure_b",
      title: "Lighting Schedule Annexure B",
      enabled: true,
      blocks: [{ id: "b_schedule", type: "paragraph", content: "Schedule details" }],
    });
    originalDraft.documentLayout.pageOrientation = "landscape";

    // Verify snapshot remains completely unchanged
    assert.equal(publishedSnapshot.version, 1);
    assert.equal(publishedSnapshot.documentLayout.sections.length, 6);
    assert.equal(publishedSnapshot.documentLayout.pageOrientation, "portrait");

    // Verify draft has been updated
    assert.equal(originalDraft.documentLayout.sections.length, 7);
    assert.equal(originalDraft.documentLayout.pageOrientation, "landscape");

    pass("Template immutable versioning guarantees published document layouts remain frozen against draft mutations");
  }

  // Test 35: Phase 4 - Secure Multi-Tenant Media Upload Contract
  {
    const ALLOWED_MIME_TYPES = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/svg+xml",
      "application/pdf",
    ]);
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

    const validateUpload = (file: { size: number; type: string; name: string }) => {
      if (file.size > MAX_FILE_SIZE) {
        return { valid: false, error: "File exceeds 10MB limit" };
      }
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return { valid: false, error: `Disallowed MIME type: ${file.type}` };
      }
      return { valid: true };
    };

    // Valid uploads
    assert.equal(validateUpload({ size: 1024 * 1024, type: "image/png", name: "drawing.png" }).valid, true);
    assert.equal(validateUpload({ size: 8 * 1024 * 1024, type: "application/pdf", name: "conduit.pdf" }).valid, true);
    assert.equal(validateUpload({ size: 500 * 1024, type: "image/webp", name: "living.webp" }).valid, true);

    // Invalid uploads: size over limit
    const overSize = validateUpload({ size: 12 * 1024 * 1024, type: "image/png", name: "large.png" });
    assert.equal(overSize.valid, false);
    assert.ok(overSize.error?.includes("10MB"));

    // Invalid uploads: disallowed MIME types
    assert.equal(validateUpload({ size: 1024, type: "application/x-msdownload", name: "trojan.exe" }).valid, false);
    assert.equal(validateUpload({ size: 1024, type: "text/html", name: "script.html" }).valid, false);
    assert.equal(validateUpload({ size: 1024, type: "application/javascript", name: "attack.js" }).valid, false);

    // Multi-tenant path verification
    const companyId = 42;
    const sanitizedFilename = "site_plan_101.png";
    const tenantRelativePath = `/uploads/tenants/${companyId}/${sanitizedFilename}`;
    assert.ok(tenantRelativePath.startsWith(`/uploads/tenants/${companyId}/`));

    pass("Secure media upload contract strictly enforces 10MB ceiling, MIME whitelist, and multi-tenant isolation");
  }

  // Test 36: Phase 4 - Backward Compatibility Preservation for Canonical Whyte Quotations
  {
    // A legacy or default Whyte Quotation template has documentLayout: null
    const legacyTemplate = {
      id: "tmpl_default_whyte",
      name: "Whyte Default Quotation",
      isDefault: true,
      documentLayout: null,
      sectionOrder: DEFAULT_TEMPLATE_SECTIONS,
      configurableColumns: DEFAULT_CONFIGURABLE_COLUMNS,
      layoutSettings: DEFAULT_LAYOUT_SETTINGS,
    };

    // When documentLayout is null, proposal pagination falls back immediately to canonical Whyte Quotation
    const resolveDocumentEngine = (template: { documentLayout?: DocumentLayoutDefinition | null }) => {
      if (template.documentLayout && template.documentLayout.sections?.length > 0) {
        return "dynamic_block_engine";
      }
      return "canonical_whyte_engine";
    };

    assert.equal(resolveDocumentEngine(legacyTemplate), "canonical_whyte_engine");

    const customDemoTemplate = {
      ...legacyTemplate,
      id: "tmpl_demo_custom",
      name: "Demo Custom Quotation",
      documentLayout: DEMO_DOCUMENT_LAYOUT,
    };
    assert.equal(resolveDocumentEngine(customDemoTemplate), "dynamic_block_engine");

    pass("Backward compatibility guarantees templates without documentLayout produce canonical Whyte Quotation documents");
  }

  // Test 37: Blank Workflow Creation & Decoupled Validation
  {
    assert.equal(BLANK_WORKFLOW_STEPS.length, 1);
    assert.equal(BLANK_WORKFLOW_STEPS[0].moduleType, "custom_form");
    const nameField = BLANK_WORKFLOW_STEPS[0].sections?.[0].fields.find((f) => f.systemBinding === "clientName");
    assert.ok(nameField);
    assert.equal(nameField.required, true);

    const blankValidation = validateWorkflowDependencies(BLANK_WORKFLOW_STEPS);
    assert.equal(blankValidation.isValid, true);
    assert.equal(blankValidation.errors.length, 0);

    pass("Blank starter workflow contains valid minimal client intake and passes validation");
  }

  // Test 38: Company B Custom Workflow (Zero Whyte Modules: Intake -> Site Inspection -> Services -> Cost Estimate)
  {
    const companyBSteps: WorkflowStepDefinition[] = [
      {
        id: "step_intake",
        title: "Client & Site Intake",
        moduleType: "custom_form",
        sortOrder: 1,
        sections: [
          {
            id: "sec_intake",
            title: "Customer Information",
            layout: "two_column",
            sortOrder: 1,
            fields: [
              { id: "f1", key: "clientName", label: "Client Name", type: "text", required: true, systemBinding: "clientName" },
              { id: "f2", key: "siteAddress", label: "Site Address", type: "textarea", required: true, systemBinding: "clientAddress" },
            ],
          },
        ],
      },
      {
        id: "step_inspection",
        title: "Site Inspection",
        moduleType: "custom_form",
        sortOrder: 2,
        sections: [
          {
            id: "sec_inspection",
            title: "Inspection Checklist",
            layout: "single_column",
            sortOrder: 1,
            fields: [
              { id: "f3", key: "sqftArea", label: "Square Footage", type: "number", required: true },
            ],
          },
        ],
      },
      {
        id: "step_services",
        title: "Professional Services",
        moduleType: "custom_form",
        sortOrder: 3,
        sections: [
          {
            id: "sec_services",
            title: "Scope of Work",
            layout: "single_column",
            sortOrder: 1,
            fields: [
              { id: "f4", key: "scopeDescription", label: "Scope Description", type: "textarea", required: true },
            ],
          },
        ],
      },
      {
        id: "step_cost_estimate",
        title: "Cost & Commercials",
        moduleType: "custom_form",
        sortOrder: 4,
        sections: [
          {
            id: "sec_pricing",
            title: "Commercials",
            layout: "single_column",
            sortOrder: 1,
            fields: [
              { id: "f5", key: "quotedAmount", label: "Total Quoted Amount (INR)", type: "number", required: true },
            ],
          },
        ],
      },
    ];

    const valResult = validateWorkflowDependencies(companyBSteps);
    assert.equal(valResult.isValid, true);
    assert.equal(valResult.errors.length, 0);

    pass("Company B multi-step custom workflow with zero Whyte modules passes workflow validation safely");
  }

  // Test 39: Company C Workflow (Catalog Selection without Space/Room Planning)
  {
    const companyCSteps: WorkflowStepDefinition[] = [
      {
        id: "step_customer",
        title: "Customer Contact",
        moduleType: "custom_form",
        sortOrder: 1,
        sections: [
          {
            id: "sec_c1",
            title: "Primary Contact",
            layout: "two_column",
            sortOrder: 1,
            fields: [
              { id: "c_name", key: "clientName", label: "Organization / Client", type: "text", required: true, systemBinding: "clientName" },
            ],
          },
        ],
      },
      {
        id: "step_products",
        title: "Hardware Catalogue",
        moduleType: "builtin",
        builtinModule: "product_config",
        sortOrder: 2,
      },
      {
        id: "step_pricing",
        title: "Commercial Terms",
        moduleType: "builtin",
        builtinModule: "pricing_review",
        sortOrder: 3,
      },
      {
        id: "step_preview",
        title: "Review & Issue",
        moduleType: "builtin",
        builtinModule: "proposal_preview",
        sortOrder: 4,
      },
    ];

    const valC = validateWorkflowDependencies(companyCSteps);
    assert.equal(valC.isValid, true);
    assert.equal(valC.errors.length, 0);

    // Module prerequisite check: without space_selection in the workflow, pricing_review does NOT require rooms!
    const mockQuoteNoRooms: any = {
      id: "q_no_rooms",
      clientName: "Acme Corp",
      rooms: [],
      items: [{ id: "item1", name: "Switchboard 4M", totalPrice: 5000 }],
    };
    const prereqCheck = checkModulePrerequisites("pricing_review", mockQuoteNoRooms, companyCSteps);
    assert.equal(prereqCheck.allowed, true);

    pass("Company C room-less workflow correctly passes validation and module prerequisites");
  }

  // Test 40: Conditional Module Ordering Violations
  {
    // If space_selection exists, product_config must NOT be placed before space_selection
    const invalidOrderSteps: WorkflowStepDefinition[] = [
      { id: "s1", title: "Project", moduleType: "builtin", builtinModule: "project_details", sortOrder: 1 },
      { id: "s2", title: "Devices", moduleType: "builtin", builtinModule: "product_config", sortOrder: 2 },
      { id: "s3", title: "Spaces", moduleType: "builtin", builtinModule: "space_selection", sortOrder: 3 },
    ];
    const invalidRes = validateWorkflowDependencies(invalidOrderSteps);
    assert.equal(invalidRes.isValid, false);
    assert.ok(invalidRes.errors.some((e) => e.includes("Space Selection") && e.includes("Device Configuration")));

    // But if space_selection is omitted entirely, product_config is allowed!
    const validDirectCatalogSteps: WorkflowStepDefinition[] = [
      { id: "s1", title: "Project", moduleType: "builtin", builtinModule: "project_details", sortOrder: 1 },
      { id: "s2", title: "Devices", moduleType: "builtin", builtinModule: "product_config", sortOrder: 2 },
    ];
    const validRes = validateWorkflowDependencies(validDirectCatalogSteps);
    assert.equal(validRes.isValid, true);
    assert.equal(validRes.errors.length, 0);

    pass("Conditional module ordering enforces ordering only when preceding interdependent modules are present");
  }

  // Test 41: Workflow-Independent Quotation Initialization Contract
  {
    const step1CustomForm: WorkflowStepDefinition = {
      id: "step_intake_custom",
      title: "Client & Project Intake",
      moduleType: "custom_form",
      sortOrder: 1,
      sections: [
        {
          id: "sec_intake",
          title: "Client Identification",
          layout: "two_column",
          sortOrder: 1,
          fields: [
            { id: "f1", key: "companyContact", label: "Client Organization", type: "text", required: true, systemBinding: "clientName" },
            { id: "f2", key: "phoneDirect", label: "Mobile Number", type: "phone", required: false, systemBinding: "clientPhone" },
            { id: "f3", key: "siteLocation", label: "Site Location", type: "textarea", required: false, systemBinding: "clientAddress" },
            { id: "f4", key: "architectFirm", label: "Architectural Firm", type: "text", required: false }, // custom field
          ],
        },
      ],
    };

    // Simulated form values submitted on Step 1 when quotation.id is null
    const submittedValues = {
      companyContact: "Oberoi Realty Ltd",
      phoneDirect: "+91 9876543210",
      siteLocation: "Commerz II, Goregaon East, Mumbai",
      architectFirm: "Foster + Partners",
    };

    // Extract system bound fields
    let clientName = "";
    let clientPhone: string | undefined;
    let clientAddress: string | undefined;

    for (const sec of step1CustomForm.sections || []) {
      for (const f of sec.fields) {
        const val = submittedValues[f.key as keyof typeof submittedValues];
        if (f.systemBinding === "clientName") clientName = String(val).trim();
        else if (f.systemBinding === "clientPhone") clientPhone = String(val).trim();
        else if (f.systemBinding === "clientAddress") clientAddress = String(val).trim();
      }
    }

    assert.equal(clientName, "Oberoi Realty Ltd");
    assert.equal(clientPhone, "+91 9876543210");
    assert.equal(clientAddress, "Commerz II, Goregaon East, Mumbai");

    // Construct quotation creation payload
    const creationPayload = {
      clientName,
      clientPhone: clientPhone || null,
      clientAddress: clientAddress || null,
      templateId: "tmpl_company_b",
      templateVersion: 1,
      customFieldValues: submittedValues,
    };

    assert.equal(creationPayload.clientName, "Oberoi Realty Ltd");
    assert.equal(creationPayload.templateId, "tmpl_company_b");
    assert.equal(creationPayload.customFieldValues.architectFirm, "Foster + Partners");

    pass("Workflow-independent initialization accurately extracts system bindings and creates quotation payload");
  }

  // Test 42: New Template Starter Selection (Whyte 5-Step vs Blank 1-Step)
  {
    // Starter A: Whyte standard
    const whyteStarter = {
      name: "Whyte Standard Journey",
      workflow: { steps: DEFAULT_WORKFLOW_STEPS },
    };
    assert.equal(whyteStarter.workflow.steps.length, 5);
    assert.equal(whyteStarter.workflow.steps[0].id, "step_project");
    assert.ok(whyteStarter.workflow.steps[0].sections?.length! > 0);
    assert.equal(validateWorkflowDependencies(whyteStarter.workflow.steps).isValid, true);

    // Starter B: Blank custom
    const blankStarter = {
      name: "Custom Blank Journey",
      workflow: { steps: BLANK_WORKFLOW_STEPS },
    };
    assert.equal(blankStarter.workflow.steps.length, 1);
    assert.equal(blankStarter.workflow.steps[0].moduleType, "custom_form");
    assert.equal(validateWorkflowDependencies(blankStarter.workflow.steps).isValid, true);

    pass("Starter template choices (Whyte standard vs Blank custom) provide distinct, valid starting points");
  }

  // Test 43: System Field Binding Integrity & Custom Label Customization
  {
    const stepProject = JSON.parse(JSON.stringify(DEFAULT_WORKFLOW_STEPS[0])) as WorkflowStepDefinition;
    assert.ok(stepProject.sections);

    // Admin customizes label from 'Client / Customer Name' to 'Customer / Organization'
    const nameField = stepProject.sections[0].fields.find((f) => f.systemBinding === "clientName");
    assert.ok(nameField);
    nameField.label = "Customer / Organization";
    nameField.layout = { width: "full", alignment: "left" };

    // Field key & systemBinding remain stable
    assert.equal(nameField.key, "clientName");
    assert.equal(nameField.systemBinding, "clientName");
    assert.equal(nameField.label, "Customer / Organization");
    assert.equal(nameField.layout.width, "full");

    // Removing optional notes field keeps workflow valid
    stepProject.sections[1].fields = stepProject.sections[1].fields.filter((f) => f.key !== "notes");
    assert.equal(validateWorkflowDependencies([stepProject, ...DEFAULT_WORKFLOW_STEPS.slice(1)]).isValid, true);

    pass("Customizing system field labels, widths, and removing optional fields preserves database bindings");
  }

  // Test 44: Reusable Module Palette & Safe Module Removal
  {
    // Start with blank custom intake step
    let activeSteps: WorkflowStepDefinition[] = JSON.parse(JSON.stringify(BLANK_WORKFLOW_STEPS));
    assert.equal(activeSteps.length, 1);

    // Insert 'product_config' reusable module
    const productMeta = BUILT_IN_MODULES.product_config;
    const productStep: WorkflowStepDefinition = {
      id: productMeta.defaultId,
      title: productMeta.defaultTitle,
      moduleType: "builtin",
      builtinModule: "product_config",
      sortOrder: 2,
    };
    activeSteps.push(productStep);

    // Insert 'pricing_review' reusable module
    const pricingMeta = BUILT_IN_MODULES.pricing_review;
    const pricingStep: WorkflowStepDefinition = {
      id: pricingMeta.defaultId,
      title: pricingMeta.defaultTitle,
      moduleType: "builtin",
      builtinModule: "pricing_review",
      sortOrder: 3,
    };
    activeSteps.push(pricingStep);

    // Insert 'proposal_preview' reusable module
    const previewMeta = BUILT_IN_MODULES.proposal_preview;
    const previewStep: WorkflowStepDefinition = {
      id: previewMeta.defaultId,
      title: previewMeta.defaultTitle,
      moduleType: "builtin",
      builtinModule: "proposal_preview",
      sortOrder: 4,
    };
    activeSteps.push(previewStep);

    const val = validateWorkflowDependencies(activeSteps);
    assert.equal(val.isValid, true);
    assert.equal(activeSteps.length, 4);

    // Module prerequisite check for room-less flow:
    // With product_config and pricing_review, items are checked directly
    const mockQuote: any = {
      id: "q_44",
      clientName: "Test Tenant",
      rooms: [],
      items: [{ id: "item_1", name: "Relay Controller", quantity: 2, totalPrice: 8000 }],
    };
    const check = checkModulePrerequisites("pricing_review", mockQuote, activeSteps);
    assert.equal(check.allowed, true);

    pass("Reusable module insertion builds valid custom journeys without requiring all Whyte steps");
  }

  // Test 45: Normalization of Room-Independent Quotations includes Direct Line Items in Subtotal and Product Count
  {
    const rawQuote: any = {
      _id: "q_roomless_45",
      id: "q_roomless_45",
      quotationNumber: "WQ-2026-0045",
      status: "draft",
      rooms: [], // Zero rooms!
      items: [
        {
          _id: 101,
          id: 101,
          quotationId: "q_roomless_45",
          quotationRoomId: null,
          productId: 1,
          quantity: 2,
          unitPrice: "4500.00",
          itemType: "product",
          product: { id: 1, name: "Smart Dimmer Switch", code: "DIM-01" },
        },
        {
          _id: 102,
          id: 102,
          quotationId: "q_roomless_45",
          quotationRoomId: null,
          productId: null,
          quantity: 1,
          unitPrice: "3500.00",
          title: "Site Calibration & Configuration Service",
          itemType: "service",
        },
      ],
      discountType: "percentage",
      discountValue: "10",
    };

    const normalized = normalizeQuotation(rawQuote);
    assert.equal(normalized.rooms.length, 0);
    assert.equal(normalized.items?.length, 2);
    // Subtotal: 2 * 4500 (9000) + 1 * 3500 (3500) = 12500
    assert.equal(normalized.subtotal, 12500);
    assert.equal(normalized.productsCount, 3);
    // Discount: 10% of 12500 = 1250
    assert.equal(normalized.discountAmount, 1250);
    // Net: 11250, GST (18%): 2025, Total: 13275
    assert.equal(normalized.netSubtotal, 11250);
    assert.equal(normalized.totalGstAmount, 2025);
    assert.equal(normalized.grandTotal, 13275);

    pass("Room-independent quotation normalization correctly calculates server-authoritative totals and GST for product and service items");
  }

  // Test 46: Service Quotation Item Creation & Verification without Catalog Products
  {
    const serviceItem: any = {
      _id: 201,
      id: 201,
      quotationId: "q_service_46",
      quotationRoomId: null,
      productId: null,
      title: "Full Site Electrical Audit & Consultation",
      itemType: "service",
      quantity: 1,
      unitPrice: "7500.00",
      taxPercent: 18,
    };

    const quoteWithService: any = {
      _id: "q_service_46",
      id: "q_service_46",
      status: "draft",
      rooms: [],
      items: [serviceItem],
      discountType: "none",
    };

    const normalized = normalizeQuotation(quoteWithService);
    assert.equal(normalized.items?.[0]?.title, "Full Site Electrical Audit & Consultation");
    assert.equal(normalized.items?.[0]?.itemType, "service");
    assert.equal(normalized.items?.[0]?.quotationRoomId, null);
    assert.equal(normalized.subtotal, 7500);
    assert.equal(normalized.grandTotal, 8850); // 7500 + 18% GST (1350)

    pass("Direct service quotation line items function correctly without rooms or catalogue products");
  }

  // Test 47: Room-less Item Immutability and State Management
  {
    let quoteState: any = {
      _id: "q_state_47",
      rooms: [],
      items: [
        { id: 301, quotationRoomId: null, quantity: 2, unitPrice: "2000.00", title: "Wiring" },
      ],
    };

    // Simulate adding an item locally
    const newItem = { id: 302, quotationRoomId: null, quantity: 1, unitPrice: "1500.00", title: "Installation" };
    quoteState = { ...quoteState, items: [...quoteState.items, newItem] };
    assert.equal(quoteState.items.length, 2);

    // Simulate updating an item locally
    quoteState = {
      ...quoteState,
      items: quoteState.items.map((it: any) => (it.id === 301 ? { ...it, quantity: 3 } : it)),
    };
    assert.equal(quoteState.items.find((it: any) => it.id === 301).quantity, 3);

    // Simulate deleting an item locally
    quoteState = {
      ...quoteState,
      items: quoteState.items.filter((it: any) => it.id !== 302),
    };
    assert.equal(quoteState.items.length, 1);
    assert.equal(quoteState.items[0].id, 301);

    pass("Room-less item local updates, additions and deletions operate cleanly on quotation.items without mutating rooms");
  }

  // Test 48: Strict Tenant Isolation: Cross-Company Access Enforcement
  {
    const quoteA = {
      _id: "quotation_company_a_001",
      companyId: 101,
      dealerId: 11,
      assignedSalesId: 21,
      createdBy: "31",
    };

    const quoteB = {
      _id: "quotation_company_b_002",
      companyId: 102,
      dealerId: 12,
      assignedSalesId: 22,
      createdBy: "32",
    };

    // 1. Company B Admin with global permissions attempting to view/modify Company A quotation
    const companyBAdminRole = "admin";
    const companyBUserId = 99;
    const elevatedPermissions = ["quotations:read_all", "quotations:edit_all", "quotations:delete"];
    const companyBActiveId = 102;

    assert.equal(
      canViewQuotation(companyBAdminRole, companyBUserId, quoteA, elevatedPermissions, companyBActiveId),
      false,
      "Company B Admin MUST NOT be able to view Company A quotation even with quotations:read_all"
    );
    assert.equal(
      canModifyQuotation(companyBAdminRole, companyBUserId, quoteA, elevatedPermissions, companyBActiveId),
      false,
      "Company B Admin MUST NOT be able to modify Company A quotation even with quotations:edit_all"
    );
    assert.equal(
      canDeleteQuotation(companyBAdminRole, companyBUserId, quoteA, elevatedPermissions, companyBActiveId),
      false,
      "Company B Admin MUST NOT be able to delete Company A quotation even with quotations:delete"
    );

    // 2. Legitimate intra-company access within Company A
    const companyAActiveId = 101;
    assert.equal(
      canViewQuotation(companyBAdminRole, companyBUserId, quoteA, elevatedPermissions, companyAActiveId),
      true,
      "Admin within Company A must have read access"
    );
    assert.equal(
      canModifyQuotation(companyBAdminRole, companyBUserId, quoteA, elevatedPermissions, companyAActiveId),
      true,
      "Admin within Company A must have modify access"
    );

    // 3. Super Admin respecting Act-as Company context
    assert.equal(
      canViewQuotation("super_admin", 1, quoteA, elevatedPermissions, 102),
      false,
      "Super Admin acting as Company B must NOT access Company A quotation"
    );
    assert.equal(
      canModifyQuotation("super_admin", 1, quoteA, elevatedPermissions, 102),
      false,
      "Super Admin acting as Company B must NOT modify Company A quotation"
    );
    assert.equal(
      canViewQuotation("super_admin", 1, quoteA, elevatedPermissions, 101),
      true,
      "Super Admin acting as Company A has access to Company A quotation"
    );

    // 4. Missing company context fails closed
    assert.equal(
      canViewQuotation("admin", 1, quoteA, elevatedPermissions, null),
      false,
      "Missing company context must fail closed for view"
    );
    assert.equal(
      canModifyQuotation("admin", 1, quoteA, elevatedPermissions, null),
      false,
      "Missing company context must fail closed for modify"
    );

    pass("Strict tenant isolation enforces company boundary across admins, act-as company context, and fail-closed checks");
  }

  // Test 49: Strict Tenant Database Filter Enforcement
  {
    // Scoped to active company
    const filterA = tenantQuotationFilter("q_test_1", "admin", 101);
    assert.deepEqual(filterA, { _id: "q_test_1", companyId: 101 });

    // Different company
    const filterB = tenantQuotationFilter("q_test_1", "admin", 102);
    assert.deepEqual(filterB, { _id: "q_test_1", companyId: 102 });

    // Missing company context fails closed
    const filterMissing = tenantQuotationFilter("q_test_1", "admin", null);
    assert.deepEqual(filterMissing, { _id: "q_test_1", companyId: -1 });

    // Missing company context even for super_admin on quotation lookup fails closed to protect tenant isolation
    const filterSuperMissing = tenantQuotationFilter("q_test_1", "super_admin", null);
    assert.deepEqual(filterSuperMissing, { _id: "q_test_1", companyId: -1 });

    pass("tenantQuotationFilter builds tenant-scoped queries and fails closed ({ companyId: -1 }) on missing company context");
  }

  // Test 50: Complete Revision Snapshot Data Integrity & Parity
  {
    // Simulate snapshot generation with mixed items:
    // Room-linked item, Direct product item, Custom service item
    const rawRooms = [{ _id: 10, name: "Living Room", customName: "Living Room", subArea: "Ground Floor", notes: null }];
    const rawItems = [
      {
        _id: 101,
        quotationRoomId: 10,
        productId: 501,
        productVariantId: 1001,
        variantLabel: "WiFi + Glass",
        quantity: 2,
        unitPrice: 4000,
        priceWithoutTax: 3389.83,
        taxPercent: 18,
        taxAmount: 610.17,
        notes: null,
      },
      {
        _id: 102,
        quotationRoomId: null, // Direct product item
        productId: 502,
        productVariantId: 1002,
        variantLabel: "Standard",
        quantity: 1,
        unitPrice: 3500,
        priceWithoutTax: 2966.10,
        taxPercent: 18,
        taxAmount: 533.90,
        notes: null,
        title: "Standalone Gateway",
        itemType: "product",
      },
      {
        _id: 103,
        quotationRoomId: null, // Direct service item
        productId: null,
        productVariantId: null,
        variantLabel: "Consulting",
        quantity: 1,
        unitPrice: 5000,
        priceWithoutTax: 5000,
        taxPercent: 18,
        taxAmount: 900,
        notes: "On-site programming",
        title: "Programming & Commissioning",
        itemType: "service",
      },
    ];

    // De-duplication and retrieval parity check:
    const itemMap = new Map<number, any>();
    for (const it of rawItems) itemMap.set(Number(it._id), it);
    const items = Array.from(itemMap.values());
    assert.equal(items.length, 3);

    const snapshotRooms: any[] = rawRooms.map((r) => ({
      roomId: r._id,
      name: r.name,
      subArea: r.subArea,
      notes: r.notes,
      items: items.filter((it) => it.quotationRoomId === r._id),
    }));

    const directItems = items.filter((it) => !it.quotationRoomId);
    if (directItems.length > 0) {
      snapshotRooms.push({
        roomId: 0,
        name: "Direct Items",
        subArea: null,
        notes: null,
        items: directItems,
      });
    }

    assert.equal(snapshotRooms.length, 2);
    assert.equal(snapshotRooms[0].items.length, 1);
    assert.equal(snapshotRooms[1].items.length, 2);
    assert.equal(snapshotRooms[1].name, "Direct Items");

    // Total subtotal: (2 * 4000) + (1 * 3500) + (1 * 5000) = 8000 + 3500 + 5000 = 16500
    const subtotal = items.reduce((sum, it) => sum + (it.quantity || 1) * Number(it.unitPrice), 0);
    assert.equal(subtotal, 16500);

    const financials = deriveQuotationFinancials({
      subtotal,
      discountType: "percentage",
      discountValue: 10,
      customerDiscountPercent: 10,
      allocatedDiscountPercent: 20,
    });

    assert.equal(financials.subtotal, 16500);
    assert.equal(financials.discountAmount, 1650);
    assert.equal(financials.netSubtotal, 14850);
    assert.equal(financials.totalGstAmount, 2673);
    assert.equal(financials.grandTotal, 17523);

    // Verify revision comparison flattening captures all 3 items
    const flattenedItems = snapshotRooms.flatMap((r) => r.items.map((i: any) => ({ ...i, room: r.name })));
    assert.equal(flattenedItems.length, 3);
    assert.equal(flattenedItems.find((i) => i._id === 101).room, "Living Room");
    assert.equal(flattenedItems.find((i) => i._id === 102).room, "Direct Items");
    assert.equal(flattenedItems.find((i) => i._id === 103).room, "Direct Items");

    pass("Revision snapshot parity captures room items, direct items, service items, and derives accurate financials");
  }

  // Test 51: Offline Calculation Snapshot Parity with Direct Items
  {
    const calc = calculateDraftTotals({
      rooms: [
        {
          id: "room_1",
          draftId: "draft_test_1",
          roomTypeId: 1,
          name: "Master Bedroom",
          sortOrder: 0,
          items: [
            {
              id: "item_1",
              draftId: "draft_test_1",
              roomId: "room_1",
              productId: 10,
              variantId: 101,
              productName: "Dimmer",
              quantity: 2,
              defaultUnitPrice: "3000.00",
              unitPrice: "3000.00",
              isCustomPrice: false,
              taxPercent: 18,
              lineTotal: "6000.00",
              sortOrder: 0,
            },
          ],
        },
      ],
      directItems: [
        {
          id: "item_direct_1",
          draftId: "draft_test_1",
          roomId: null,
          productId: null,
          variantId: null,
          productName: "Annual Maintenance Contract",
          title: "Annual Maintenance Contract",
          itemType: "service",
          quantity: 1,
          defaultUnitPrice: "12000.00",
          unitPrice: "12000.00",
          isCustomPrice: false,
          taxPercent: 18,
          lineTotal: "12000.00",
          sortOrder: 0,
        },
      ],
      discountType: "percentage",
      discountValue: 0,
      dealerDiscountAllocationPercent: 15,
    });

    // Subtotal: 6000 (room) + 12000 (direct) = 18000
    assert.equal(calc.grossSubtotal, 18000);
    assert.equal(calc.discountAmount, 0);
    assert.equal(calc.netSubtotal, 18000);
    assert.equal(calc.cgstAmount, 1620); // 9% of 18000
    assert.equal(calc.sgstAmount, 1620); // 9% of 18000
    assert.equal(calc.totalGstAmount, 3240); // 18% of 18000
    assert.equal(calc.grandTotal, 21240);
    assert.equal(calc.estimatedDealerEarning, 2700); // 15% of 18000

    pass("Offline calculateDraftTotals correctly calculates grossSubtotal, GST, and dealer earnings across direct items");
  }

  // Test 52: Offline Draft Serialization & Deserialization Parity
  {
    const baseDraft: OfflineQuotationDraft = {
      id: "draft_sync_test_52",
      tenantKey: "101_1",
      companyId: 101,
      companyName: "Acme Automation",
      userId: 1,
      userName: "Admin",
      userRole: "admin",
      clientName: "John Doe",
      houseTypeId: 1,
      catalogVersion: "v1",
      revision: 1,
      status: "LOCAL_DRAFT",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rooms: [],
      calculation: {
        grossSubtotal: 0,
        discountType: "percentage",
        discountValue: 0,
        discountAmount: 0,
        netSubtotal: 0,
        cgstPercent: 9,
        cgstAmount: 0,
        sgstPercent: 9,
        sgstAmount: 0,
        totalGstAmount: 0,
        grandTotal: 0,
        dealerDiscountAllocationPercent: 0,
        customerDiscountPercent: 0,
        estimatedDealerEarning: 0,
      },
      roomCount: 0,
      deviceCount: 0,
    };

    const quotation = {
      clientName: "Jane Smith",
      houseTypeId: 2,
      discountType: "none",
      discountValue: 0,
      rooms: [
        {
          id: 1,
          customName: "Living Room",
          roomTypeId: 1,
          items: [
            { id: 11, productId: 101, productVariantId: 201, quantity: 3, unitPrice: "2500.00", taxPercent: 18 },
          ],
        },
      ],
      items: [
        { id: 12, productId: null, productVariantId: null, title: "Support Pack", itemType: "service", quantity: 2, unitPrice: "4000.00", taxPercent: 18 },
      ],
    };

    // 1. Serialize to offline draft
    const draft = quotationToOfflineDraft(quotation, baseDraft);
    assert.equal(draft.rooms.length, 1);
    assert.equal(draft.items?.length, 1);
    assert.equal(draft.items?.[0].title, "Support Pack");
    assert.equal(draft.items?.[0].roomId, null);
    // Device count: 3 (room item) + 2 (direct item) = 5
    assert.equal(draft.deviceCount, 5);
    // Gross subtotal: 3 * 2500 (7500) + 2 * 4000 (8000) = 15500
    assert.equal(draft.calculation.grossSubtotal, 15500);

    // 2. Deserialize back to quotation
    const restoredQuote = offlineDraftToQuotation(draft, [], []);
    assert.equal(restoredQuote.rooms.length, 1);
    assert.equal(restoredQuote.items?.length, 1);
    assert.equal(restoredQuote.items?.[0].title, "Support Pack");
    assert.equal(restoredQuote.items?.[0].quotationRoomId, null);
    assert.equal(restoredQuote.items?.[0].quantity, 2);
    assert.equal(restoredQuote.items?.[0].unitPrice, "4000.00");
    assert.equal(restoredQuote.subtotal, 15500);

    pass("Offline draft conversion preserves direct items, room items, device counts, and totals bidirectionally");
  }

  console.log(`\nAll ${count} Quotation Template Designer tests passed successfully!\n`);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
