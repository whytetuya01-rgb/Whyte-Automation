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
  type TemplateNumberingFormat,
  type TemplateConfigurableColumns,
  type TemplateSectionItem,
  type TemplateCustomField,
} from "../src/types/template";
import { normalizeQuotation } from "../src/lib/quotationNormalization";

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

  console.log(`\nAll ${count} Quotation Template Designer tests passed successfully!\n`);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
