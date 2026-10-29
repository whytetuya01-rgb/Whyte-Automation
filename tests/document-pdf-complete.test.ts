/**
 * Requirement #10 completion: nothing company-specific or GST-mislabelled is hard-coded in the quotation document.
 * The 18% line is the company's own charge (product prices already include GST), shown under editable wording; the
 * remaining fixed words (device/devices, Connect with, Page X of Y, About eyebrow, every Project Overview heading)
 * are labels; the header label and watermark are settings; any company can include the Project Overview page; the
 * document's tints follow the company's accent. Amounts are untouched.
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/document-pdf-complete.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_LABEL_DEFAULTS, DOCUMENT_LABEL_GROUPS, DOCUMENT_LABEL_KEYS, resolveProposalContent } from "../src/lib/documentSettings";
import { documentSettingsSchema } from "../src/lib/validation/documentSettings";
import { calculateQuotationGst } from "../src/lib/pricing";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");
const CRLF = new RegExp(String.fromCharCode(13) + String.fromCharCode(10), "g");
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
/** Source without comments, so a guard only looks at what is rendered. */
const code = (...parts: string[]) => read(...parts).replace(CRLF, "\n").replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

function main() {
  // ── the 18% line ──
  assert.equal(DOCUMENT_LABEL_DEFAULTS.taxSummary, "Additional Charges");
  assert.equal(DOCUMENT_LABEL_DEFAULTS.serviceCharge, "Service & Integration Charges");
  assert.equal(DOCUMENT_LABEL_DEFAULTS.pricesIncludeGst, "All product prices are inclusive of GST.");
  assert.equal(DOCUMENT_LABEL_DEFAULTS.netSubtotalNote, "Amount after discount");
  const gst = calculateQuotationGst(20000, 2000);
  assert.deepEqual([gst.netSubtotal, gst.cgstAmount, gst.sgstAmount, gst.grandTotal], [18000, 1620, 1620, 21240], "the amounts are exactly as before");
  const preview = code("src", "components", "proposal-builder", "StepProposalPreview.tsx");
  for (const literal of ["CGST @", "SGST/UTGST", "IGST @", "Tax Summary", "resolvePlaceOfSupply"]) {
    assert.ok(!preview.includes(literal), `the document no longer presents the 18% as GST (${JSON.stringify(literal)})`);
  }
  assert.ok(!/>\s*GST\s*</.test(preview), "no bare GST badge");
  assert.ok(/\{content\.text\.serviceCharge\} \(\{QUOTATION_CGST_PERCENT \+ QUOTATION_SGST_PERCENT\}%\)/.test(preview), "the line shows the company's wording and the rate from the pricing constants");
  assert.ok(/formatCurrency\(igstAmount, \{ decimals: 2 \}\)/.test(preview) && /const igstAmount = cgstAmount \+ sgstAmount;/.test(preview), "the amount is the existing CGST + SGST total");
  pass("the 18% line is shown as the company's own charge (editable wording, rate from the pricing constants, same amount), never as GST");

  // ── no fixed words left ──
  for (const literal of ['? "device" : "devices"', "Specification & Scope", "Your Project Overview", "Authorized Dealer", "Configured Spaces (", "No spaces configured with active products", "Automation Scope", "Specified Automation Tier", "Specified Surface Finish", "Smart switching and touch control"]) {
    assert.ok(!preview.includes(literal), `StepProposalPreview no longer hard-codes ${JSON.stringify(literal)}`);
  }
  const parts = code("src", "components", "proposal", "ProposalDocumentParts.tsx");
  for (const literal of [">Company Profile<", "Connect with {", "Page {pageNumber} of {totalPages}"]) {
    assert.ok(!parts.includes(literal), `ProposalDocumentParts no longer hard-codes ${JSON.stringify(literal)}`);
  }
  for (const key of ["deviceSingular", "devicePlural", "connectWith", "pageLabel", "pageOf", "aboutEyebrow", "overviewEyebrow", "overviewTitle", "scopeLine1", "scopeLine3", "serviceCharge", "pricesIncludeGst"] as const) {
    assert.ok(DOCUMENT_LABEL_KEYS.includes(key), `${key} is a label`);
  }
  assert.equal(new Set(DOCUMENT_LABEL_GROUPS.flatMap((group) => group.keys)).size, DOCUMENT_LABEL_KEYS.length, "every label is in the editor exactly once");
  // Whyte's own picture and Tactus block stay on Whyte's document only; the tints follow the company's accent.
  assert.ok(/content\.isDefaultCompany \? "\/proposal\/whyte\/overview-hero\.webp"/.test(preview), "Whyte's overview picture only on Whyte's document");
  assert.ok(/\{content\.isDefaultCompany && \(\s*<div className="space-y-2\.5 pt-1">/.test(preview), "the Tactus block only on Whyte's document");
  assert.ok(!preview.includes("bg-pink-50/40") && !/from-pink-50 via-white to-slate-100"\s*style=\{\{ minHeight: 200/.test(preview) && !/pink/.test(parts), "the cover strip, overview and About headers use the accent tint");
  pass("device/devices, Connect with, Page X of Y, the About eyebrow and every Project Overview heading are editable labels; Whyte-only parts stay Whyte's");

  // ── header label, watermark, overview page ──
  const whyte = resolveProposalContent({ slug: "whyte-automations", name: "Whyte Automations" });
  const acme = resolveProposalContent({ slug: "acme", name: "Acme Homes", tagline: "Smart homes" });
  assert.deepEqual([whyte.showOverview, whyte.showWatermark, whyte.watermark], [true, true, "WHYTE"], "the default company's standard pages keep the overview and watermark");
  assert.deepEqual([acme.showOverview, acme.showWatermark, acme.headerLabel, acme.watermark], [false, true, "Smart homes", "ACME HOMES"], "another company starts without the overview page");
  const custom = resolveProposalContent({ slug: "acme", name: "Acme Homes", documentSettings: { overviewPage: true, showWatermark: false, headerLabel: "  Acme Smart Living ", watermarkText: "ACME" } });
  assert.deepEqual([custom.showOverview, custom.showWatermark, custom.headerLabel, custom.watermark], [true, false, "Acme Smart Living", "ACME"]);
  const whyteCustom = resolveProposalContent({ slug: "whyte-automations", name: "Whyte Automations", documentSettings: { introPages: "none", overviewPage: false } });
  assert.equal(whyteCustom.showOverview, false, "the default company can drop the overview page once it leaves the standard pages");
  pass("the header label and watermark are editable (watermark can be hidden) and any company can include the Project Overview page");

  // ── validation ──
  assert.equal(documentSettingsSchema.safeParse({ headerLabel: "Acme", watermarkText: "ACME", showWatermark: false, overviewPage: true }).success, true);
  for (const bad of [{ watermarkText: "X".repeat(15) }, { headerLabel: "Y".repeat(41) }, { showWatermark: "no" }, { overviewPage: 1 }, { headerLabel: "two\nlines" }]) {
    assert.equal(documentSettingsSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  pass("the new settings are validated (lengths, single line, booleans)");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
