/**
 * Browser check of company logo customization (real Chromium against an isolated production server, a throwaway
 * Mongo and a fake Cloudinary): the live preview reacts to every control, Reset only touches unsaved settings,
 * invalid files and a broken image are reported, leaving the page without saving changes nothing, saving updates the
 * database and the real header logo without a manual reload, a failed save keeps the stored logo, and the
 * registration form sends the logo, compact logo and settings.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/company-logo-customization.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";
import { png } from "./helpers/imageFixtures.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let fake;
let browser;
let exitCode = 0;

const CLOUD = "testcloud";
const uploads = [];
let cloudMode = "ok";
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      res.setHeader("Content-Type", "application/json");
      if (cloudMode === "http500") { res.statusCode = 500; res.end(JSON.stringify({ error: { message: "boom" } })); return; }
      if (req.url.endsWith("/image/upload")) {
        const folder = /name="folder"\r\n\r\n([^\r\n]+)/.exec(body)?.[1] ?? "";
        const publicId = `${folder}/asset${uploads.length + 1}`;
        uploads.push(publicId);
        res.end(JSON.stringify({ public_id: publicId, secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${publicId}.png`, version: 1 }));
      } else if (req.url.endsWith("/image/destroy")) {
        res.end(JSON.stringify({ result: "ok" }));
      } else { res.statusCode = 404; res.end("{}"); }
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

const PNG = png(64, 64);
const WIDE = png(240, 60, [30, 60, 115, 255]);
const COMPACT = png(64, 64, [0, 150, 80, 255]);
const PASSWORD = "Str0ng!Passw0rd";

try {
  fake = await startFake();
  Object.assign(process.env, {
    CLOUDINARY_CLOUD_NAME: CLOUD,
    CLOUDINARY_API_KEY: "123456789012345",
    CLOUDINARY_API_SECRET: "test-only-secret-value-0123456789",
    CLOUDINARY_URL: `cloudinary://123456789012345:test-only-secret-value-0123456789@${CLOUD}?upload_prefix=http://127.0.0.1:${fake.address().port}`,
    SESSION_ACTOR_CACHE_TTL_MS: "0",
    COMPANY_REGISTER_RATE_LIMIT_MAX: "150",
  });
  server = await startIsolatedServer("logo-ui", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Company alpha", slug: "alpha", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: "https://logos.test/alpha.png", logoPublicId: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertMany([{ _id: "adminUser", seq: 10 }, { _id: "company", seq: 10 }]);
  const cookieA = await login("ownera@example.com", "admin");
  const stored = () => db.collection("companies").findOne({ _id: 10 });

  browser = await chromium.launch({ headless: true });
  const open = async (cookie, viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    await context.route("https://logos.test/**", (route) => {
      if (route.request().url().includes("broken")) return route.fulfill({ status: 404, body: "no" });
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    });
    await context.route("https://res.cloudinary.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: WIDE }));
    if (cookie) {
      await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => {
        const i = pair.indexOf("=");
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
      }));
    }
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };

  const { page } = await open(cookieA);
  const gotoSettings = async () => {
    await page.goto(`${baseUrl}/admin/company`, { waitUntil: "load" });
    await page.getByRole("tab", { name: "Logo Customization" }).click();
    await page.locator('[data-testid="logo-live-preview"]').waitFor();
    await page.locator('[data-testid="logo-preview-expanded"] img[data-company-logo]').waitFor();
  };
  await gotoSettings();
  const chip = () => page.locator('[data-testid="logo-preview-expanded"] > span').first();
  const chipBox = async () => { await page.waitForTimeout(200); return chip().boundingBox(); };
  const chipStyle = (prop) => chip().evaluate((el, p) => getComputedStyle(el)[p], prop);
  const radio = (label, option) => page.getByRole("radiogroup", { name: label }).getByRole("radio", { name: option });
  const range = (label) => page.getByRole("slider", { name: label });

  // ── saved logo is loaded into the editor and the real header components ──
  assert.equal(await page.locator('[data-testid="logo-preview-loader"] img[data-company-logo]').count(), 2, "the loader preview shows the saved logo (its dim base layer and the animated reveal layer)");
  assert.equal(await page.locator('[data-testid="logo-preview-collapsed"] img[data-company-logo]').count(), 1, "the collapsed preview falls back to the saved logo");
  assert.equal(await page.locator('[data-testid="company-logo-frame"] img').count(), 1);
  pass("the saved logo loads into the editor and into the expanded, collapsed and loader previews");

  // ── each control changes the preview immediately ──
  const base = await chipBox();
  assert.ok(Math.abs(base.width - 40) <= 1 && Math.abs(base.height - 40) <= 1, `default contain chip fits the square logo (${base.width}x${base.height})`);
  await radio("Logo Fit", "Cover / Crop").click();
  assert.ok(Math.abs((await chipBox()).width - 124) <= 1, "cover uses the fixed-width chip (112 + 2 x 6 padding)");
  await range("Logo Padding").fill("12");
  assert.ok(Math.abs((await chipBox()).width - 136) <= 1, "more padding widens the chip");
  await range("Logo Padding").fill("0");
  assert.ok(Math.abs((await chipBox()).width - 112) <= 1, "no padding narrows it");
  await radio("Logo Fit", "Contain").click();
  assert.ok((await chipBox()).width < 112, "contain follows the logo's own proportions again");
  pass("Logo Fit and Logo Padding update the preview");

  assert.equal(await chipStyle("backgroundColor"), "rgb(255, 255, 255)");
  await radio("Logo Background", "Transparent").click();
  assert.equal(await chipStyle("backgroundColor"), "rgba(0, 0, 0, 0)");
  await radio("Logo Background", "White").click();
  await range("Corner Rounding").fill("16");
  assert.equal(await chipStyle("borderTopLeftRadius"), "16px");
  await range("Corner Rounding").fill("0");
  assert.equal(await chipStyle("borderTopLeftRadius"), "0px");
  pass("Logo Background and Corner Rounding update the preview");

  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/logo-customization-tab.png`, fullPage: true });

  // Reset only touches unsaved settings
  const resetButton = page.getByRole("button", { name: "Reset to Defaults" });
  assert.equal(await resetButton.isEnabled(), true);
  await resetButton.click();
  assert.ok(Math.abs((await chipBox()).width - 40) <= 1);
  assert.equal(await resetButton.isDisabled(), true, "nothing to reset once the defaults are showing");
  assert.equal(await page.locator('[data-testid="logo-preview-expanded"] img[data-company-logo]').count(), 1, "the saved logo is still shown");
  assert.equal((await stored()).logoUrl, "https://logos.test/alpha.png", "Reset never changes what is saved");
  pass("Reset to Defaults resets the unsaved settings only; the saved logo stays");

  // compact logo
  await page.setInputFiles('input[aria-label="Compact sidebar logo file"]', { name: "compact.png", mimeType: "image/png", buffer: COMPACT });
  await page.waitForFunction(() => /^blob:/.test(document.querySelector('[data-testid="logo-preview-collapsed"] img[data-company-logo]')?.getAttribute("src") ?? ""));
  assert.equal(await page.locator('[data-testid="logo-preview-expanded"] img[data-company-logo]').getAttribute("src"), "https://logos.test/alpha.png", "the expanded preview keeps the main logo");
  await page.getByTestId("logo-customizer").getByRole("button", { name: "Discard", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="logo-preview-collapsed"] img[data-company-logo]')?.getAttribute("src") === "https://logos.test/alpha.png");
  pass("a compact logo appears in the collapsed preview only, and Discard returns to the main logo");

  // missing-logo state
  await page.getByRole("button", { name: "Remove logo" }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="logo-live-preview"] img[data-company-logo]').length === 0);
  assert.match(await page.locator('[data-testid="logo-preview-note"]').innerText(), /default Whyte branding/);
  assert.ok(await page.locator('[data-testid="logo-preview-expanded"] img[alt="Whyte Automations logo"]').isVisible(), "the default Whyte logo shows in the preview");
  assert.equal((await stored()).logoUrl, "https://logos.test/alpha.png", "removal is unsaved until Save");
  await page.getByRole("button", { name: "Keep current logo" }).click();
  await page.locator('[data-testid="logo-preview-expanded"] img[data-company-logo]').waitFor();
  pass("removing the logo previews the default Whyte branding without deleting anything until Save");

  // invalid files
  await page.setInputFiles('input[aria-label="Company logo file"]', { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.locator("text=/Use a PNG, JPG or WebP image/").waitFor();
  await page.setInputFiles('input[aria-label="Company logo file"]', { name: "tiny.png", mimeType: "image/png", buffer: png(8, 8) });
  await page.locator("text=at least 64×32 pixels").first().waitFor();
  assert.equal(await page.locator('[data-testid="logo-preview-expanded"] img[data-company-logo]').getAttribute("src"), "https://logos.test/alpha.png", "an invalid file never replaces the preview");
  pass("an unsupported file type and a too-small image are rejected with clear messages");

  // leaving without saving changes nothing
  await radio("Logo Fit", "Cover / Crop").click();
  await page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "load" });
  assert.equal((await stored()).logoSettings, undefined, "unsaved changes are never persisted");
  assert.equal((await stored()).logoUrl, "https://logos.test/alpha.png");
  await gotoSettings();
  assert.ok(Math.abs((await chipBox()).width - 40) <= 1, "the editor starts from what is saved");
  pass("navigating away without saving leaves the stored logo and settings unchanged");

  // broken image state
  await db.collection("companies").updateOne({ _id: 10 }, { $set: { logoUrl: "https://logos.test/broken.png" } });
  await page.reload({ waitUntil: "load" });
  await page.getByRole("tab", { name: "Logo Customization" }).click();
  await page.locator('[data-testid="logo-live-preview"]').waitFor();
  await page.locator('[data-testid="logo-preview-note"]', { hasText: "could not be loaded" }).waitFor();
  assert.ok(await page.locator('[data-testid="logo-preview-expanded"] img[alt="Whyte Automations logo"]').isVisible(), "a broken image falls back to the default logo");
  await db.collection("companies").updateOne({ _id: 10 }, { $set: { logoUrl: "https://logos.test/alpha.png" } });
  pass("a broken saved image is reported in the preview and falls back to the default logo");

  // failed save keeps the stored logo
  await gotoSettings();
  await page.setInputFiles('input[aria-label="Company logo file"]', { name: "new.png", mimeType: "image/png", buffer: WIDE });
  await page.waitForFunction(() => /^blob:/.test(document.querySelector('[data-testid="logo-preview-expanded"] img[data-company-logo]')?.getAttribute("src") ?? ""));
  cloudMode = "http500";
  await page.getByRole("button", { name: "Save Logo Settings" }).click();
  await page.locator('[role="alert"]', { hasText: /could not be uploaded|not available/i }).first().waitFor();
  cloudMode = "ok";
  assert.equal((await stored()).logoUrl, "https://logos.test/alpha.png", "the saved logo survives a failed upload");
  assert.ok(await page.locator('[data-testid="logo-preview-expanded"] img[data-company-logo]').isVisible(), "the unsaved preview is still there to retry");
  pass("a failed save shows a clear error and preserves the stored logo");

  // successful save: logo + settings together; the real header updates without a manual refresh
  await radio("Logo Fit", "Cover / Crop").click();
  await range("Logo Padding").fill("3");
  await range("Corner Rounding").fill("10");
  await page.getByRole("button", { name: "Save Logo Settings" }).click();
  await page.locator("text=Your company logo and its settings have been updated.").first().waitFor();
  const saved = await stored();
  assert.match(saved.logoUrl, /^https:\/\/res\.cloudinary\.com\/testcloud\//);
  assert.deepEqual(saved.logoSettings, { fit: "cover", background: "white", padding: 3, radius: 10 });
  const headerLogo = page.locator("header img[data-company-logo]").first();
  await page.waitForFunction(() => /res\.cloudinary\.com/.test(document.querySelector("header img[data-company-logo]")?.getAttribute("src") ?? ""), null, { timeout: 15000 });
  const headerChip = headerLogo.locator("xpath=ancestor::span[contains(@class,'overflow-hidden')][1]");
  assert.equal(await headerChip.evaluate((el) => getComputedStyle(el).borderTopLeftRadius), "10px");
  assert.ok(Math.abs((await headerChip.boundingBox()).width - 118) <= 1, "the header chip uses the saved cover settings (112 + 2 x 3)");
  assert.equal(await page.locator('[data-testid="company-logo-frame"] img').count(), 1);
  pass("saving stores the logo and settings together and the real header logo updates without a manual reload");

  // Reload: the saved settings drive the editor and header
  await page.reload({ waitUntil: "load" });
  await page.getByRole("tab", { name: "Logo Customization" }).click();
  await page.locator('[data-testid="logo-preview-expanded"] img[data-company-logo]').waitFor();
  assert.ok(Math.abs((await chipBox()).width - 118) <= 1);
  assert.equal(await range("Corner Rounding").inputValue(), "10");
  pass("the saved settings are loaded back into the editor");

  // ── tabs: the existing profile form still works, and unsaved logo changes survive switching tabs ──
  await gotoSettings();
  await radio("Logo Fit", "Contain").click(); // saved fit is cover, so this is an unsaved change
  assert.equal(await page.getByRole("tab", { name: /Logo Customization/ }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "Company Profile" }).click();
  assert.equal(await page.getByRole("tab", { name: "Company Profile" }).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator('[data-testid="logo-customizer"]').count(), 0, "the logo editor is not shown on the profile tab");
  await page.getByLabel("Tagline (on PDF header)").fill("Smart homes, smarter living");
  await page.getByRole("button", { name: "Save Company Settings" }).click();
  await page.locator("text=Company profile information updated successfully.").first().waitFor();
  assert.equal((await stored()).tagline, "Smart homes, smarter living", "the profile form still saves");
  assert.equal((await stored()).logoSettings.fit, "cover", "saving the profile does not touch the logo settings");
  await page.getByRole("tab", { name: /Logo Customization/ }).click();
  assert.ok((await chipBox()).width > 130, "the unsaved contain choice (wide logo) is still previewed after switching tabs");
  await page.getByRole("button", { name: "Cancel changes" }).click();
  assert.ok(Math.abs((await chipBox()).width - 118) <= 1, "cancelling shows the saved (cover) logo again");
  assert.equal(await page.getByRole("button", { name: "Save Logo Settings" }).isDisabled(), true, "cancelling returns to the saved state");
  await page.getByRole("tab", { name: "Company Profile" }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: /Logo Customization/ }).getAttribute("aria-selected"), "true", "tabs work with the keyboard");
  pass("the Logo Customization tab sits beside Company Profile: both save separately, unsaved logo changes survive tab switches, Cancel restores the saved logo, keyboard navigation works");

  // ── registration form ──
  const { page: reg, context: regContext } = await open(null);
  await reg.goto(`${baseUrl}/register/company`, { waitUntil: "load" });
  await reg.locator('[data-testid="logo-live-preview"]').waitFor();
  assert.match(await reg.locator('[data-testid="logo-preview-note"]').innerText(), /default Whyte branding/);
  await reg.fill("#company-name", "Skyline Smart Homes");
  await reg.fill("#company-email", "hello@skyline.example");
  await reg.fill("#company-phone", "+91 98765 43210");
  await reg.fill("#company-address", "7 Sky Tower, SG Highway, Ahmedabad 380054");
  await reg.fill("#owner-name", "Riya Shah");
  await reg.fill("#owner-email", "riya@skyline.example");
  await reg.fill("#owner-phone", "9876501234");
  await reg.fill("#owner-password", PASSWORD);
  await reg.fill("#owner-confirm-password", PASSWORD);
  await reg.setInputFiles("#company-logo", { name: "logo.png", mimeType: "image/png", buffer: WIDE });
  await reg.locator('[data-testid="logo-preview-expanded"] img[data-company-logo]').waitFor();
  await reg.setInputFiles('input[aria-label="Compact sidebar logo file"]', { name: "compact.png", mimeType: "image/png", buffer: COMPACT });
  await reg.getByRole("radiogroup", { name: "Logo Fit" }).getByRole("radio", { name: "Cover / Crop" }).click();
  await reg.getByRole("radiogroup", { name: "Logo Background" }).getByRole("radio", { name: "Transparent" }).click();
  await reg.getByRole("slider", { name: "Logo Padding" }).fill("2");
  await reg.getByRole("slider", { name: "Corner Rounding" }).fill("14");
  await reg.getByRole("button", { name: "Register company" }).click();
  await reg.waitForURL("**/register/company/submitted");
  const registered = await db.collection("companies").findOne({ name: "Skyline Smart Homes" });
  assert.match(registered.logoUrl, /res\.cloudinary\.com\/testcloud/);
  assert.match(registered.compactLogoUrl, /res\.cloudinary\.com\/testcloud/);
  assert.deepEqual(registered.logoSettings, { fit: "cover", background: "transparent", padding: 2, radius: 14 });
  pass("the registration form previews the logo and saves logo, compact logo and settings");
  await regContext.close();

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  fake?.close();
  process.exit(exitCode);
}
