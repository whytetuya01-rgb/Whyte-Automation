/**
 * Browser check of /register/company/submitted at desktop, tablet and phone sizes: content, the three-step progress,
 * both buttons, no overflow, reduced motion, and contrast of the text. Public page: no data, no sign-in.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/company-submitted-page.browser.mjs
 * Optional: SCREENSHOT_DIR=<dir>
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) { console.error("UNVERIFIED: set PLAYWRIGHT_MODULE."); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(modulePath);
const shotDir = process.env.SCREENSHOT_DIR;
const results = [];
const pass = (m) => { results.push(m); console.log(`  ✓ ${m}`); };
let server, browser, exitCode = 0;

const luminance = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

try {
  server = await startIsolatedServer("submitted-ui", [{ _id: 1, email: "x@example.com", role: "super_admin", name: "X" }], { production: true });
  const { baseUrl } = server;
  browser = await chromium.launch({ headless: true });
  const open = async (viewport, options = {}) => {
    const context = await browser.newContext({ viewport, ...options });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`${baseUrl}/register/company/submitted`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Your Request Is Under Review" }).waitFor();
    await page.waitForTimeout(1400); // let the entrance animation finish
    return { context, page };
  };

  const sizes = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1100 }, phone: { width: 375, height: 800 } };
  for (const [name, viewport] of Object.entries(sizes)) {
    const { context, page } = await open(viewport);
    const body = await page.locator("body").innerText();
    assert.match(body, /PENDING APPROVAL/i);
    assert.match(body, /Thank you for registering with Whyte Automation\. Your company registration request has been submitted successfully and is awaiting approval from our team\. You will receive an email once your request is reviewed\./);
    for (const step of ["Registration Submitted", "Application Review", "Approval Decision"]) assert.match(body, new RegExp(step));
    assert.doesNotMatch(body, /approved!|Congratulations|\d+ (hours|days)/i, "never implies approval or invents a timeline");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${name}: no horizontal scroll`);
    const steps = page.getByRole("list", { name: "Registration progress" }).getByRole("listitem");
    assert.equal(await steps.count(), 3);
    assert.equal(await steps.nth(1).getAttribute("aria-current"), "step", "step 2 is the current step");
    const buttons = await page.evaluate(() => [...document.querySelectorAll("main a")].map((a) => { const r = a.getBoundingClientRect(); return { text: a.textContent.trim(), href: a.getAttribute("href"), h: Math.round(r.height), left: r.left, right: r.right }; }));
    assert.deepEqual(buttons.map((b) => b.text), ["Back to Login", "Visit Our Website"]);
    assert.ok(buttons.every((b) => b.h >= 44), `${name}: tap targets are at least 44px tall`);
    assert.ok(buttons.every((b) => b.left >= 0 && b.right <= viewport.width), `${name}: buttons stay inside the viewport`);
    if (shotDir) await page.screenshot({ path: `${shotDir}/s-${name}.png`, fullPage: true });
    if (name === "desktop") {
      assert.equal(await page.locator('aside img[src*="cover-hero"]').count(), 1, "brand artwork is shown on desktop");
      assert.ok((await page.locator("aside").boundingBox()).width / viewport.width > 0.45, "balanced split");
      const h1 = await page.getByRole("heading", { name: "Your Request Is Under Review" }).boundingBox();
      assert.ok(h1.y > 150 && h1.y < viewport.height - 300, "the confirmation is vertically centred in the viewport");
    } else {
      assert.equal(await page.locator("aside").isVisible(), false, `${name}: the large brand panel is replaced by a compact bar`);
      assert.ok(await page.locator("header img").first().boundingBox(), `${name}: the logo is shown compactly`);
      const h1 = await page.getByRole("heading", { name: "Your Request Is Under Review" }).boundingBox();
      assert.ok(h1.y < 420, `${name}: the confirmation is prioritised above the fold`);
    }
    await context.close();
  }
  pass("desktop, tablet and phone: content, three-step progress, no overflow, tap targets >= 44px, brand panel on desktop and a compact bar below it");

  const nav = await open(sizes.desktop);
  await nav.page.getByRole("link", { name: "Back to Login" }).click();
  await nav.page.waitForURL("**/admin/login");
  await nav.context.close();
  const site = await open(sizes.desktop);
  assert.equal(await site.page.getByRole("link", { name: /Visit Our Website/ }).getAttribute("href"), "https://whyte.co.in/");
  pass("'Back to Login' goes to /admin/login; 'Visit Our Website' points at the website");

  const colours = await site.page.evaluate(() => {
    const parse = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const out = [];
    for (const el of document.querySelectorAll("main p, main a, main h1")) {
      if (!el.textContent.trim() || el.closest("span.sr-only")) continue;
      let node = el; let colour = null;
      while (node && !colour) { const c = getComputedStyle(node).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)/.test(c)) colour = c; node = node.parentElement; }
      out.push({ text: el.textContent.trim().slice(0, 30), fg: parse(getComputedStyle(el).color), bg: parse(colour ?? "rgb(255,255,255)") });
    }
    return out;
  });
  for (const c of colours) assert.ok(contrast(c.fg, c.bg) >= 4.5, `contrast of "${c.text}" is ${contrast(c.fg, c.bg).toFixed(2)}`);
  pass("all text on the confirmation panel meets WCAG AA contrast (4.5:1)");
  await site.context.close();

  const instant = await browser.newContext({ viewport: sizes.desktop, reducedMotion: "reduce" });
  const reduced = await instant.newPage();
  await reduced.goto(`${baseUrl}/register/company/submitted`, { waitUntil: "domcontentloaded" });
  await reduced.getByRole("heading", { name: "Your Request Is Under Review" }).waitFor();
  assert.equal(await reduced.evaluate(() => getComputedStyle(document.querySelector("main h1")).opacity), "1", "with reduced motion the text is visible immediately (no fade-in)");
  await instant.close();
  pass("reduced-motion users get no entrance animation: content is visible immediately");

  console.log(`\n${results.length} checks passed.`);
} catch (error) {
  exitCode = 1;
  console.error("\nFAILED:", error?.stack ?? error);
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
