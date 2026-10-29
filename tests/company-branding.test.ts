/**
 * Company-specific branding: URL sanitising, the per-company lookup, and static guards that keep the logo
 * server-resolved from the trusted session (never client input, never browser storage) and wired into the loaders.
 * The signed-in behaviour end to end (two companies, logout/login, Super Admin platform vs act-as) is in
 * tests/company-branding.browser.mjs.
 *
 * Throwaway database on the local loopback MongoDB; never the real one.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/company-branding.test.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { companyFaviconUrl, loadBrandingForCompany, sanitizeLogoUrl, PLATFORM_BRANDING } from "../src/lib/companyBranding";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");
const now = new Date();
type Doc = Record<string, unknown>;

async function main() {
  // ── sanitizeLogoUrl ──
  assert.equal(sanitizeLogoUrl("https://res.cloudinary.com/x/logo.png"), "https://res.cloudinary.com/x/logo.png");
  for (const bad of [null, undefined, 42, "", "   ", "http://insecure.example/logo.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "/relative/logo.png", "not a url", `https://x.example/${"a".repeat(1100)}`]) {
    assert.equal(sanitizeLogoUrl(bad), null, `rejects ${String(bad).slice(0, 40)}`);
  }
  pass("sanitizeLogoUrl accepts only absolute https URLs");

  // ── browser-tab icon ──
  const cloud = "https://res.cloudinary.com/demo/image/upload/v17/whyte/companies/10/branding/logo.png";
  assert.equal(companyFaviconUrl(cloud, "white"), "https://res.cloudinary.com/demo/image/upload/c_pad,w_96,h_96,b_white,f_png/v17/whyte/companies/10/branding/logo.png");
  assert.equal(companyFaviconUrl(cloud, "transparent"), "https://res.cloudinary.com/demo/image/upload/c_pad,w_96,h_96,b_transparent,f_png/v17/whyte/companies/10/branding/logo.png");
  assert.equal(companyFaviconUrl("https://cdn.example.com/logo.png", "white"), "https://cdn.example.com/logo.png", "a non-Cloudinary https logo is used as it is");
  for (const unsafe of ["http://res.cloudinary.com/demo/image/upload/x.png", "javascript:alert(1)", "data:image/png;base64,AA", "", null, undefined]) {
    assert.equal(companyFaviconUrl(unsafe, "white"), null, `unsafe icon ${String(unsafe)}`);
  }
  const layoutSource = read("src", "app", "layout.tsx");
  assert.ok(/export async function generateMetadata/.test(layoutSource) && /companyFaviconUrl\(branding\.compactLogoUrl \?\? branding\.logoUrl/.test(layoutSource), "the tab title and icon come from the server-resolved branding");
  assert.ok(/manifest: "\/manifest\.json"/.test(layoutSource) && /title: "Whyte",/.test(layoutSource), "the installed-app (PWA) entries are unchanged");
  pass("the browser tab icon is the company logo padded to a square (https only), and the title follows the company; PWA entries unchanged");

  // ── static guards ──
  const brandingSource = read("src", "lib", "companyBranding.ts");
  assert.ok(/getAuthenticatedActor\(\)/.test(brandingSource), "branding is resolved from the trusted actor");
  const brandingCode = brandingSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/headers|searchParams|request|cookies\(/.test(brandingCode), "no client-supplied input is read");
  const root = read("src", "app", "layout.tsx");
  assert.ok(/await getCompanyBranding\(\)/.test(root) && /<BrandingProvider branding=\{branding\}>[\s\S]*<Providers[ >]/.test(root), "root layout provides server-resolved branding above the loaders");
  const provider = read("src", "components", "providers", "BrandingProvider.tsx");
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(/.test(provider), "branding is never stored or fetched client-side");
  const loader = read("src", "components", "shared", "WhyteLoader.tsx");
  assert.ok(!/<WhyteLogo/.test(loader) && (loader.match(/<BrandLogo/g) || []).length === 2, "both loader layers use BrandLogo (animation classes unchanged)");
  assert.ok(/animate-whyte-reveal/.test(loader) && /animate-whyte-glow/.test(loader), "loader animations are preserved");
  assert.ok(/CompanyLogo/.test(read("src", "components", "admin", "sidebar", "AnimatedLogo.tsx")), "admin header/sidebar logo uses the company logo");
  const dealerHeader = read("src", "app", "(app)", "layout.tsx");
  assert.ok(/<DealerHeaderLogo \/>/.test(dealerHeader) && !/<WhyteLogo/.test(dealerHeader), "the dealer header shows the company's logo (Whyte's only as the fallback)");
  const dealerLogo = read("src", "components", "shared", "DealerHeaderLogo.tsx");
  assert.ok(/useCompanyBranding\(\)/.test(dealerLogo) && /fallback=\{whyte\}/.test(dealerLogo), "it reads the server-resolved branding and falls back to the Whyte logo");
  const sw = read("public", "sw.js");
  assert.ok(/CLEAR_PAGE_CACHE/.test(sw) && /replace\) await clearCachedPages/.test(sw), "service worker drops cached pages on account change / sign-out");
  assert.ok(/clearCachedPages\(\)/.test(read("src", "components", "shared", "SignOutButton.tsx")), "sign-out clears cached pages");
  pass("branding is server-resolved, never stored client-side, wired into loaders, the admin header and the dealer header; SW page cache cleared per account");

  assert.ok(/try \{[\s\S]*loadBrandingForCompany|catch \{\s*return PLATFORM_BRANDING/.test(brandingSource), "lookup failures degrade to the default");
  pass("lookup and request-level failures degrade to the default branding");

  // ── per-company lookup ──
  const dbName = `whyte_company_branding_${randomBytes(5).toString("hex")}`;
  const uri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  let failed = false;
  try {
    const base = { status: "active", phone: "1", address: "x", isDeleted: false, createdAt: now, updatedAt: now };
    const companies: Doc[] = [
      { _id: 1, name: "Alpha Automation", slug: "alpha", logoUrl: "https://logos.test/alpha.svg", ...base },
      { _id: 2, name: "Beta Builders", slug: "beta", logoUrl: "https://logos.test/beta.svg", ...base },
      { _id: 3, name: "No Logo Co", slug: "nologo", logoUrl: null, ...base },
      { _id: 4, name: "Unsafe Logo Co", slug: "unsafe", logoUrl: "javascript:alert(1)", ...base },
      { _id: 5, name: "Deleted Co", slug: "deleted", logoUrl: "https://logos.test/deleted.svg", ...base, isDeleted: true },
    ];
    await mongoose.connection.collection("companies").insertMany(companies);

    const a = await loadBrandingForCompany(1);
    const b = await loadBrandingForCompany(2);
    assert.deepEqual([a.companyId, a.companyName, a.logoUrl], [1, "Alpha Automation", "https://logos.test/alpha.svg"]);
    assert.deepEqual([b.companyId, b.companyName, b.logoUrl], [2, "Beta Builders", "https://logos.test/beta.svg"]);
    assert.deepEqual([a.theme, a.brandColor, a.compactLogoUrl], ["whyte-rose", null, null], "defaults for a company that customised nothing");
    pass("two companies resolve to their own, different logos");

    assert.equal((await loadBrandingForCompany(3)).logoUrl, null, "no logo → default");
    assert.equal((await loadBrandingForCompany(4)).logoUrl, null, "unsafe logo URL → default");
    pass("a missing or unsafe logo falls back to the default (null)");

    assert.deepEqual(await loadBrandingForCompany(null), PLATFORM_BRANDING);
    assert.deepEqual(await loadBrandingForCompany(999), PLATFORM_BRANDING, "unknown company");
    assert.deepEqual(await loadBrandingForCompany(5), PLATFORM_BRANDING, "soft-deleted company");
    pass("platform context (null), an unknown company and a deleted company all get the default branding");

  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
    console.log(failed ? "\nFAILED" : `\n${count} passed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
