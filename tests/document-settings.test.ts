/**
 * Quotation document content settings: how a company's document content is resolved (the default company keeps
 * its existing text, every other company starts neutral), the validation schema, and static guards that nothing
 * company-specific stays hard-coded in the PDF, the footer or the social links.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/document-settings.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSocialUrl, resolveProposalContent, resolveSocialLinks, safeHttpsUrl, slugForFileName, WHYTE_SOCIAL_URLS } from "../src/lib/documentSettings";
import { documentSettingsSchema } from "../src/lib/validation/documentSettings";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

const whyte = { slug: "whyte-automations", name: "Whyte Automations", phone: "9898234336", email: "info@whyte.example", address: "Gandhinagar", tagline: null, logoUrl: null };
const acme = { slug: "acme-homes", name: "Acme Homes Pvt. Ltd.", phone: "+91 90000 11111", email: "hello@acme.example", address: "12 Main Street\nAhmedabad", tagline: "Homes that think", logoUrl: "https://res.cloudinary.com/x/acme.png" };

function main() {
  // ── resolution: the default company keeps its existing document text ──
  const w = resolveProposalContent(whyte);
  assert.equal(w.isDefaultCompany, true);
  assert.equal(w.legalName, "Whyte Automations Private Limited");
  assert.equal(w.phone, "+91 98982 34336 / +91 98989 26336");
  assert.equal(w.email, "sales@whyte.co.in");
  assert.equal(w.website?.url, "https://whyte.co.in/");
  assert.equal(w.footerText, "www.whyte.co.in");
  assert.equal(w.automationType, "Whyte Smart Living Ecosystem");
  assert.equal(w.headerLabel, "Smart Living Ecosystems");
  assert.equal(w.watermark, "WHYTE");
  assert.equal(w.introPages, "standard");
  assert.deepEqual(w.socialLinks.map((l) => l.url), [WHYTE_SOCIAL_URLS.linkedin, WHYTE_SOCIAL_URLS.instagram, WHYTE_SOCIAL_URLS.youtube, WHYTE_SOCIAL_URLS.facebook]);
  assert.equal(w.fileName("QT-2026-001"), "QT-2026-001_Whyte_Automation.pdf");
  pass("the default company's document is exactly what it has always been until it customises");

  // ── resolution: any other company is neutral and uses its own data ──
  const a = resolveProposalContent(acme);
  assert.equal(a.isDefaultCompany, false);
  assert.equal(a.brandName, "Acme Homes Pvt. Ltd.");
  assert.equal(a.legalName, "Acme Homes Pvt. Ltd.");
  assert.equal(a.phone, "+91 90000 11111");
  assert.equal(a.email, "hello@acme.example");
  assert.equal(a.addressLine, "12 Main Street, Ahmedabad");
  assert.equal(a.tagline, "Homes that think");
  assert.equal(a.website, null);
  assert.equal(a.footerText, null);
  assert.equal(a.socialLinks.length, 0, "no Whyte social links on another company's document");
  assert.equal(a.introPages, "none", "no Whyte marketing pages for another company");
  assert.equal(a.about, null);
  assert.equal(a.automationType, "Smart Home Automation");
  assert.equal(a.watermark, "ACME HOMES PVT");
  assert.equal(a.logoUrl, "https://res.cloudinary.com/x/acme.png");
  assert.equal(a.fileName("QT-2026-007"), "QT-2026-007_Acme_Homes_Pvt_Ltd.pdf");
  const blob = JSON.stringify({ ...a, fileName: undefined });
  assert.ok(!/whyte/i.test(blob), "nothing of Whyte's appears in another company's resolved content");
  pass("a new company starts neutral: its own profile data, no Whyte text, links, pages or file name");

  // ── customised settings ──
  const custom = resolveProposalContent({
    ...acme,
    documentSettings: {
      legalName: "Acme Homes Private Limited",
      website: "https://www.acme.example/",
      footerText: "acme.example",
      automationType: "Acme Smart Living",
      socialLinks: { linkedin: "https://www.linkedin.com/company/acme", instagram: "javascript:alert(1)", youtube: "https://evil.example/x", facebook: null },
      introPages: "custom",
      aboutTitle: "Who is Acme",
      aboutBody: "We build smart homes.",
      aboutHighlights: [{ title: "Warranty", text: "5 years" }, { title: "", text: "dropped" }],
    },
  });
  assert.equal(custom.legalName, "Acme Homes Private Limited");
  assert.deepEqual(custom.website, { url: "https://www.acme.example/", label: "www.acme.example" });
  assert.equal(custom.footerText, "acme.example");
  assert.equal(custom.automationType, "Acme Smart Living");
  assert.deepEqual(custom.socialLinks.map((l) => l.id), ["linkedin"], "unsafe and wrong-network links are never rendered");
  assert.equal(custom.introPages, "custom");
  assert.deepEqual(custom.about, { title: "Who is Acme", body: "We build smart homes.", highlights: [{ title: "Warranty", text: "5 years" }] });
  pass("custom settings are applied; unsafe or wrong-network social links and incomplete highlights are dropped");

  assert.equal(resolveProposalContent({ ...acme, documentSettings: { introPages: "standard" } }).introPages, "none", "another company can never use the Whyte intro pages, even if the field is set");
  assert.equal(resolveProposalContent({ ...acme, documentSettings: { introPages: "custom", aboutBody: null } }).introPages, "none", "a custom intro page with no text is not shown");
  const whyteCustom = resolveProposalContent({ ...whyte, documentSettings: { socialLinks: { linkedin: "https://www.linkedin.com/company/other" }, website: null } });
  assert.deepEqual(whyteCustom.socialLinks.map((l) => l.id).sort(), ["facebook", "instagram", "linkedin", "youtube"], "links the default company left unset keep their defaults");
  assert.equal(whyteCustom.socialLinks.find((l) => l.id === "linkedin")?.url, "https://www.linkedin.com/company/other");
  assert.equal(whyteCustom.website, null, "an explicitly cleared website stays cleared");
  assert.equal(whyteCustom.email, "info@whyte.example", "once customised, the default company uses its profile contact details");
  pass("standard pages are default-company only; explicit blanks stay blank; unset fields keep the default company's defaults");

  assert.equal(safeHttpsUrl("http://a.example"), null);
  assert.equal(safeHttpsUrl("data:text/html,x"), null);
  assert.equal(safeHttpsUrl(" https://a.example/x "), "https://a.example/x");
  assert.equal(isSocialUrl("youtube", "https://youtu.be/abc"), true);
  assert.equal(isSocialUrl("linkedin", "https://notlinkedin.com/x"), false);
  assert.equal(isSocialUrl("linkedin", "https://evil.example/linkedin.com"), false);
  assert.equal(resolveSocialLinks(undefined, "X", false).length, 0);
  assert.equal(slugForFileName("  Ünï Co. & Sons!! "), "Uni_Co_Sons");
  pass("URL helpers accept only https, and only the right host for each network");

  // ── validation schema ──
  const ok = documentSettingsSchema.parse({ legalName: "  Acme  ", website: "https://acme.example", footerText: "", socialLinks: { linkedin: "https://www.linkedin.com/company/acme", facebook: "" }, introPages: "custom", aboutHighlights: [{ title: "A", text: "B" }] });
  assert.equal(ok.legalName, "Acme");
  assert.equal(ok.footerText, null, "blank means cleared (null)");
  assert.equal(ok.socialLinks?.facebook, null);
  const bad: Array<[unknown, string]> = [
    [{ website: "http://acme.example" }, "https"],
    [{ website: "javascript:alert(1)" }, "https"],
    [{ socialLinks: { linkedin: "https://evil.example/in" } }, "LinkedIn"],
    [{ socialLinks: { twitter: "https://x.com/a" } }, ""],
    [{ legalName: "a".repeat(161) }, "160"],
    [{ legalName: "line\nbreak" }, "invalid"],
    [{ footerText: "x".repeat(121) }, "120"],
    [{ aboutBody: "x".repeat(1201) }, "1200"],
    [{ aboutHighlights: Array.from({ length: 5 }, () => ({ title: "t", text: "x" })) }, "at most 4"],
    [{ aboutHighlights: [{ title: "", text: "x" }] }, "title"],
    [{ aboutHighlights: [{ title: "t", text: "x", extra: 1 }] }, ""],
    [{ introPages: "fancy" }, "introduction"],
    [{ companyId: 5 }, ""],
    [{ legalName: 5 }, "text"],
  ];
  for (const [input, fragment] of bad) {
    const result = documentSettingsSchema.safeParse(input);
    assert.equal(result.success, false, JSON.stringify(input));
    if (fragment && !result.success) assert.ok(result.error.issues.some((i) => i.message.includes(fragment)), `${JSON.stringify(input)} -> ${result.error.issues.map((i) => i.message).join("|")}`);
  }
  pass("the schema is strict: https only, social links on their own network, bounded text, no unknown keys");

  // ── WhatsApp and canonical URLs ──
  assert.equal(isSocialUrl("whatsapp", "https://wa.me/919876543210"), true);
  assert.equal(isSocialUrl("whatsapp", "https://api.whatsapp.com/send?phone=919876543210"), true);
  assert.equal(isSocialUrl("whatsapp", "https://wa.me.evil.example/919876543210"), false);
  assert.equal(isSocialUrl("whatsapp", "http://wa.me/919876543210"), false);
  const canonical = documentSettingsSchema.parse({ website: "  https://WWW.Acme.Example ", socialLinks: { whatsapp: "https://WA.ME/919876543210", linkedin: "https://www.LinkedIn.com/company/acme" } });
  assert.equal(canonical.website, "https://www.acme.example/");
  assert.equal(canonical.socialLinks?.whatsapp, "https://wa.me/919876543210");
  assert.equal(canonical.socialLinks?.linkedin, "https://www.linkedin.com/company/acme");
  for (const evil of ["javascript:alert(1)", "data:text/html,x", "https://evil.example/wa.me", "whatsapp://send?phone=1", "http://wa.me/1"]) {
    assert.equal(documentSettingsSchema.safeParse({ socialLinks: { whatsapp: evil } }).success, false, evil);
  }
  assert.equal(WHYTE_SOCIAL_URLS.whatsapp, undefined, "no WhatsApp link is invented for the default company");
  assert.ok(!resolveSocialLinks(undefined, "Whyte", true).some((link) => link.id === "whatsapp"));
  const own = resolveSocialLinks({ whatsapp: "https://wa.me/919876543210" }, "Acme", false);
  assert.deepEqual(own.map((link) => [link.id, link.ariaLabel]), [["whatsapp", "Acme on WhatsApp"]]);
  pass("WhatsApp links (wa.me / whatsapp.com) are supported, URLs are stored in canonical form, unsafe schemes are refused, none is invented");

  // ── static guards: nothing company-specific left in the document ──
  const preview = read("src", "components", "proposal-builder", "StepProposalPreview.tsx");
  for (const literal of ["whyte.co.in", "sales@whyte", "Private Limited", "Connect with Whyte", "_Whyte_Automation", "Smart Living Ecosystems", "Whyte Smart Living Ecosystem", "98982 34336"]) {
    assert.ok(!preview.includes(literal), `StepProposalPreview no longer hard-codes "${literal}"`);
  }
  assert.ok(/resolveProposalContent\(company\)/.test(preview) && /<ProposalContactCard content=\{content\}/.test(preview) && /<ProposalPageFooter/.test(preview), "the PDF reads its identity from the company's resolved content");
  const social = read("src", "components", "shared", "SocialLinks.tsx");
  assert.ok(!/linkedin\.com\/company|instagram\.com\/|facebook\.com\//.test(social) && !/WHYTE_SOCIAL_LINKS/.test(social), "SocialLinks holds no company's URLs");
  const footer = read("src", "lib", "footerCompany.ts");
  assert.ok(/company\.documentSettings\?\.socialLinks/.test(footer) && /getAuthenticatedActor\(\)/.test(footer), "the footer's links come from the session's own company");
  const patch = read("src", "app", "api", "company", "route.ts");
  assert.ok(/DEFAULT_COMPANY_SLUG/.test(patch) && /introPages === "standard"/.test(patch), "the standard intro pages are gated to the default company on the server");
  assert.ok(!/documentSettings[^\n]*companyId|body\.companyId/.test(patch), "the company is never taken from the request body");
  pass("static guards: the PDF, footer and social links hold no company-specific literals; the company comes from the session");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
