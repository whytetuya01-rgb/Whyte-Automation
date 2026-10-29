/**
 * Quotation document text: every heading/label, the "Proposal Includes" lines, Next Steps and default validity /
 * terms are company settings whose defaults are exactly the document's long-standing wording. Covers resolution,
 * validation, and static guards that the PDF no longer hard-codes any of that text.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/document-text.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_NEXT_STEPS,
  DEFAULT_PROPOSAL_INCLUDES,
  DOCUMENT_LABEL_DEFAULTS,
  DOCUMENT_LABEL_GROUPS,
  DOCUMENT_LABEL_KEYS,
  DOCUMENT_LABEL_LIMITS,
  resolveProposalContent,
} from "../src/lib/documentSettings";
import { documentSettingsSchema } from "../src/lib/validation/documentSettings";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

const whyte = { slug: "whyte-automations", name: "Whyte Automations" };
const acme = { slug: "acme", name: "Acme Homes" };

function main() {
  // ── defaults are the old wording, for every company ──
  for (const company of [whyte, acme, null]) {
    const content = resolveProposalContent(company);
    assert.deepEqual(content.text, DOCUMENT_LABEL_DEFAULTS);
    assert.deepEqual(content.includes, DEFAULT_PROPOSAL_INCLUDES);
    assert.deepEqual(content.nextSteps, DEFAULT_NEXT_STEPS);
    assert.equal(content.validityDays, 30);
    assert.equal(content.defaultTerms, null);
  }
  assert.equal(DOCUMENT_LABEL_DEFAULTS.coverTitle, "Smart Automation Proposal");
  assert.equal(DOCUMENT_LABEL_DEFAULTS.closingTitle, "Investment & Next Steps");
  assert.deepEqual(DEFAULT_NEXT_STEPS.map((step) => step.title), ["Review", "Confirm", "Align", "Proceed"]);
  assert.equal(new Set(DOCUMENT_LABEL_GROUPS.flatMap((group) => group.keys)).size, DOCUMENT_LABEL_KEYS.length, "every label appears in the editor exactly once");
  pass("with nothing customised every company gets exactly the long-standing wording, lists and 30-day validity");

  // ── customised ──
  const custom = resolveProposalContent({
    ...acme,
    documentSettings: {
      labels: { coverTitle: " Home Automation Quote ", closingTitle: "Pricing & Way Forward", grandTotal: "", preparedFor: null },
      includes: ["Smart switches", "  ", "Installation"],
      nextSteps: [{ title: "Sign", text: "Sign the quotation." }, { title: "", text: "dropped" }],
      defaultValidityDays: 15,
      defaultTerms: "50% advance.",
    },
  });
  assert.equal(custom.text.coverTitle, "Home Automation Quote");
  assert.equal(custom.text.closingTitle, "Pricing & Way Forward");
  assert.equal(custom.text.grandTotal, "Grand Total", "a blank label keeps the default");
  assert.equal(custom.text.preparedFor, "Prepared exclusively for");
  assert.deepEqual(custom.includes, ["Smart switches", "Installation"]);
  assert.deepEqual(custom.nextSteps, [{ title: "Sign", text: "Sign the quotation." }]);
  assert.equal(custom.validityDays, 15);
  assert.equal(custom.defaultTerms, "50% advance.");
  const empty = resolveProposalContent({ ...acme, documentSettings: { includes: [], nextSteps: [] } });
  assert.deepEqual([empty.includes, empty.nextSteps], [[], []], "empty lists mean none (the PDF hides Next Steps)");
  for (const days of [0, -1, 366, 1.5]) {
    assert.equal(resolveProposalContent({ ...acme, documentSettings: { defaultValidityDays: days } }).validityDays, 30, `stored ${days} days falls back to 30`);
  }
  const huge = resolveProposalContent({ ...acme, documentSettings: { labels: { coverTitle: "x".repeat(500) }, includes: Array.from({ length: 20 }, (_, i) => `line ${i}`) } });
  assert.equal(huge.text.coverTitle.length, DOCUMENT_LABEL_LIMITS.coverTitle, "an oversized stored label is cut to its limit");
  assert.equal(huge.includes.length, 6);
  pass("custom labels, lists, validity and terms apply; blanks keep defaults; bad stored values are bounded");

  // ── validation ──
  const ok = documentSettingsSchema.parse({ labels: { coverTitle: " Quote ", grandTotal: "" }, includes: ["A"], nextSteps: [{ title: "Go", text: "Do it." }], defaultValidityDays: 45, defaultTerms: "Line one\nLine two" });
  assert.equal(ok.labels?.coverTitle, "Quote");
  assert.equal(ok.labels?.grandTotal, null);
  const bad: Array<[unknown, string]> = [
    [{ labels: { coverTitle: "x".repeat(41) } }, "40"],
    [{ labels: { estimateNote: "x".repeat(161) } }, "160"],
    [{ labels: { notALabel: "x" } }, ""],
    [{ labels: { closingTitle: "two\nlines" } }, "invalid"],
    [{ includes: ["a", "b", "c", "d", "e", "f", "g"] }, "at most 6"],
    [{ includes: [""] }, "empty"],
    [{ includes: ["x".repeat(121)] }, "120"],
    [{ nextSteps: Array.from({ length: 5 }, () => ({ title: "t", text: "x" })) }, "at most 4"],
    [{ nextSteps: [{ title: "", text: "x" }] }, "title"],
    [{ nextSteps: [{ title: "t", text: "x".repeat(101) }] }, "100"],
    [{ nextSteps: [{ title: "t", text: "x", extra: 1 }] }, ""],
    [{ defaultValidityDays: 0 }, "at least 1"],
    [{ defaultValidityDays: 400 }, "365"],
    [{ defaultValidityDays: 2.5 }, "whole number"],
    [{ defaultValidityDays: "30" }, "number"],
    [{ defaultTerms: "x".repeat(601) }, "600"],
  ];
  for (const [input, fragment] of bad) {
    const result = documentSettingsSchema.safeParse(input);
    assert.equal(result.success, false, JSON.stringify(input).slice(0, 80));
    if (fragment && !result.success) assert.ok(result.error.issues.some((issue) => issue.message.includes(fragment)), `${JSON.stringify(input).slice(0, 60)} -> ${result.error.issues.map((i) => i.message).join(" | ")}`);
  }
  pass("labels, lines, steps, validity and terms are bounded and validated; unknown keys are refused");

  // ── static guards: the PDF reads all of it from the settings ──
  const preview = read("src", "components", "proposal-builder", "StepProposalPreview.tsx");
  for (const literal of [
    "PREPARED EXCLUSIVELY FOR",
    "TOTAL INVESTMENT",
    "Investment &amp; Next Steps",
    "Product Summary &amp; Specifications",
    "ESTIMATED PROJECT INVESTMENT",
    "Valid for 30 days",
    "Selected smart automation products",
    "Review the proposed automation configuration.",
    "Proceed with final order & commissioning.",
    "Taxable amount after discount",
    "Total Investment (Incl. Taxes)",
  ]) {
    assert.ok(!preview.includes(literal), `StepProposalPreview no longer hard-codes "${literal}"`);
  }
  for (const used of ["content.text.coverTitle", "content.text.preparedFor", "content.text.closingTitle", "content.text.grandTotal", "<ProposalIncludes", "<ProposalNextSteps", "proposalValidityText(content", "quotation.terms || content.defaultTerms"]) {
    assert.ok(preview.includes(used) || preview.includes(used.replace("content.text.coverTitle", "title={content.text.coverTitle}")), `the PDF uses ${used}`);
  }
  const editor = read("src", "components", "company", "DocumentContentEditor.tsx");
  assert.ok(/<ProposalIncludes content=\{preview\}/.test(editor) && /<ProposalNextSteps content=\{preview\}/.test(editor) && /<ProposalCoverTitle title=\{preview\.text\.coverTitle\}/.test(editor), "the editor previews with the same components the PDF renders");
  pass("static guards: no fixed headings, lists or validity text left in the PDF; editor preview uses the PDF's own components");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
