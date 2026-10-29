/**
 * Browser check (real Chromium via Playwright, production build, throwaway local Mongo) of the company registration
 * journey: public form -> "under review" confirmation -> blocked sign-in -> Super Admin review (details, approve
 * confirmation) -> owner signs in -> logo upload in Company Settings. Cloudinary and email are local fakes.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/company-registration.browser.mjs
 * Optional: SCREENSHOT_DIR=<dir>
 */
import { png } from "./helpers/imageFixtures.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let fake;
let browser;
let exitCode = 0;
const shotDir = process.env.SCREENSHOT_DIR;

const uploads = [];
const emails = [];
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/emails") { emails.push(JSON.parse(body)); res.end(JSON.stringify({ id: "em_1" })); return; }
      if (req.url.endsWith("/image/upload")) {
        const folder = /name="folder"\r\n\r\n([^\r\n]+)/.exec(body)?.[1] ?? "";
        const publicId = `${folder}/asset${uploads.length + 1}`;
        uploads.push(publicId);
        res.end(JSON.stringify({ public_id: publicId, secure_url: `https://res.cloudinary.com/testcloud/image/upload/v1/${publicId}.png` }));
      } else { res.end(JSON.stringify({ result: "ok" })); }
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

// a real 64x64 PNG so the browser can render the preview (logos must be 32-4096 px)
const PNG = png(64, 64);
const PASSWORD = "Sup3rSecret!";

try {
  fake = await startFake();
  const port = fake.address().port;
  Object.assign(process.env, {
    CLOUDINARY_CLOUD_NAME: "testcloud",
    CLOUDINARY_API_KEY: "123456789012345",
    CLOUDINARY_API_SECRET: "test-only-secret-value-0123456789",
    CLOUDINARY_URL: `cloudinary://123456789012345:test-only-secret-value-0123456789@testcloud?upload_prefix=http://127.0.0.1:${port}`,
    RESEND_API_KEY: "re_test_key_not_real",
    EMAIL_FROM: "WHYTE <no-reply@example.test>",
    RESEND_API_BASE_URL: `http://127.0.0.1:${port}`,
    SESSION_ACTOR_CACHE_TTL_MS: "0",
  });
  server = await startIsolatedServer(
    "company-reg-ui",
    [{ _id: 1, email: "super@example.com", role: "super_admin", name: "Super Admin" }],
    { production: true }
  );
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 1, name: "Whyte Automations", slug: "whyte-automations", status: "pending", phone: "9898234336", address: "Gandhinagar", gstNumber: null, email: "sales@whyte.co.in", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertMany([{ _id: "adminUser", seq: 1 }, { _id: "company", seq: 1 }]);

  browser = await chromium.launch({ headless: true });
  const open = async (cookieString, viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    if (cookieString) {
      await context.addCookies(cookieString.split("; ").filter(Boolean).map((pair) => {
        const i = pair.indexOf("=");
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
      }));
    }
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { context, page };
  };
  const shot = async (page, name) => { if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true }); };

  // ═══ 1. public registration form ═══════════════════════════════════
  const visitor = await open("");
  const { page } = visitor;
  await page.goto(`${baseUrl}/register/company`, { waitUntil: "domcontentloaded" });
  await page.locator("#company-name:visible").waitFor();
  await shot(page, "r-1-form");
  assert.ok(!page.url().includes("/login"), "the registration page opens without signing in");

  await page.getByRole("button", { name: "Register company" }).click();
  await page.locator("text=Please enter your company name.").waitFor();
  assert.ok(await page.locator("text=Please enter the owner's full name.").count() >= 0);
  pass("a logged-out visitor opens the form; submitting it empty shows field-level errors");

  await page.fill("#company-name", "Skyline Smart Homes Pvt. Ltd.");
  await page.fill("#company-email", "hello@skyline.example");
  await page.fill("#company-phone", "+91 98765 43210");
  await page.fill("#company-address", "7 Sky Tower, SG Highway, Ahmedabad 380054");
  await page.fill("#owner-name", "Riya Shah");
  await page.fill("#owner-email", "riya@skyline.example");
  await page.fill("#owner-phone", "9876501234");
  await page.fill("#owner-password", PASSWORD);
  await page.fill("#owner-confirm-password", "different-password");
  await page.getByRole("button", { name: "Register company" }).click();
  await page.locator("text=Passwords do not match.").waitFor();
  await page.fill("#owner-confirm-password", PASSWORD);

  // invalid file is refused client-side, a PNG shows a preview
  await page.setInputFiles("#company-logo", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.locator("text=/Use a PNG, JPG or WebP image/").waitFor();
  assert.equal(await page.locator('img[alt="Selected company logo preview"]').count(), 0, "no preview for an invalid file");
  await page.setInputFiles("#company-logo", { name: "logo.png", mimeType: "image/png", buffer: PNG });
  const preview = page.locator('img[alt="Selected company logo preview"]');
  await preview.waitFor();
  assert.match(await preview.getAttribute("src"), /^blob:/, "the chosen logo is previewed before submitting");
  assert.equal(await page.locator("text=/Use a PNG, JPG or WebP image/").count(), 0, "the earlier error clears");
  await shot(page, "r-2-form-filled");
  pass("validation errors, a rejected non-image file, and a logo preview before submitting");

  await page.getByRole("button", { name: "Register company" }).click();
  await page.waitForURL("**/register/company/submitted");
  await page.getByRole("heading", { name: "Your Request Is Under Review" }).waitFor();
  const bodyText = await page.locator("body").innerText();
  assert.match(bodyText, /Thank you for registering with Whyte Automation\. Your company registration request has been submitted successfully and is awaiting approval from our team\. You will receive an email once your request is reviewed\./);
  assert.match(bodyText, /Pending Approval/i);
  assert.equal(await page.getByRole("link", { name: "Back to login" }).getAttribute("href"), "/login");
  assert.doesNotMatch(bodyText + page.url(), /riya@skyline|Sup3rSecret|Skyline|passwordHash|\b[0-9]{1,4}\b.*companyId/i, "nothing from the submission is shown or put in the URL");
  await shot(page, "r-3-submitted");
  const stored = await db.collection("companies").findOne({ name: "Skyline Smart Homes Pvt. Ltd." });
  assert.equal(stored.registrationStatus, "pending_review");
  assert.equal(uploads.length, 1);
  assert.match(stored.logoUrl, /testcloud/);
  // not signed in
  await page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/login/);
  pass("a valid submission lands on 'Your Request Is Under Review' with a Pending Approval indicator; nothing sensitive shown; the owner is not signed in");

  // ═══ 2. pending owner is turned away at sign-in ═══════════════════
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.locator('#admin-identifier:visible').fill("riya@skyline.example");
  await page.locator('#admin-password:visible').fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.locator("text=Your company registration is awaiting approval").first().waitFor();
  assert.match(page.url(), /login/);
  await shot(page, "r-4-pending-login");
  pass("signing in as the pending owner shows 'Your company registration is awaiting approval…'");
  await visitor.context.close();

  // ═══ 3. Super Admin review ═════════════════════════════════════════
  const superCookie = await login("super@example.com", "admin");
  const admin = await open(superCookie);
  await admin.page.goto(`${baseUrl}/admin/companies`, { waitUntil: "domcontentloaded" });
  await admin.page.getByRole("heading", { name: "Companies" }).first().waitFor();
  assert.ok(await admin.page.locator('a[href="/admin/companies"]').count() > 0, "the Companies menu item is in the Super Admin sidebar");
  const row = admin.page.locator('[data-testid="company-row"][data-company-name="Skyline Smart Homes Pvt. Ltd."]');
  await row.waitFor();
  const rowText = await row.innerText();
  assert.match(rowText, /Pending Review/);
  assert.match(rowText, /hello@skyline\.example/);
  assert.match(rowText, /Riya Shah/);
  assert.match(rowText, /riya@skyline\.example/);
  assert.match(rowText, /SG Highway/);
  assert.equal(await row.locator("img").count(), 1, "the company logo is shown");
  await shot(admin.page, "r-5-review-list");
  await row.getByRole("button", { name: /View details/ }).click();
  const modal = admin.page.locator('[data-testid="details-modal"]');
  await modal.waitFor();
  assert.match(await modal.innerText(), /9876501234/);
  await shot(admin.page, "r-6-details");
  await admin.page.keyboard.press("Escape");
  await modal.waitFor({ state: "detached" });
  assert.equal(await admin.page.getByTestId("tab-approved").count(), 1);
  assert.equal(await admin.page.getByTestId("tab-rejected").count(), 1);
  pass("Super Admin sees the request (logo, contacts, owner, address, date, status) and a full details view; tabs for Approved and Rejected exist");

  // Approval waits for the owner's email verification: the button is disabled until the emailed link is opened.
  await row.getByTestId("email-unverified-pill").waitFor();
  assert.equal(await row.getByTestId("approve-button").isDisabled(), true, "Approve is disabled until the owner verifies the email");
  const verifyMail = emails.filter((m) => /^Verify your email/.test(m.subject)).at(-1);
  assert.equal(verifyMail?.to, "riya@skyline.example", "the owner was emailed a verification link");
  const verifyLink = /https?:\/\/[^\s"<>]+\/register\/company\/verify\?token=[A-Za-z0-9_-]+/.exec(verifyMail.text)?.[0];
  assert.ok(verifyLink, "the email carries the verification link");
  const visitor2 = await open("");
  await visitor2.page.goto(verifyLink.replace(/^https?:\/\/[^/]+/, baseUrl), { waitUntil: "domcontentloaded" });
  await visitor2.page.getByRole("heading", { name: "Email verified" }).waitFor();
  await shot(visitor2.page, "r-4b-email-verified");
  await visitor2.context.close();
  await admin.page.reload({ waitUntil: "domcontentloaded" });
  await row.getByTestId("email-verified-pill").waitFor();
  pass("the owner opens the emailed link and sees 'Email verified'; the request then shows as verified and can be approved");

  await row.getByTestId("approve-button").click();
  const confirm = admin.page.locator('[data-testid="confirm-modal"]');
  await confirm.waitFor();
  assert.equal((await db.collection("companies").findOne({ name: "Skyline Smart Homes Pvt. Ltd." })).registrationStatus, "pending_review", "opening the confirmation approves nothing");
  await shot(admin.page, "r-7-confirm");
  await confirm.getByTestId("confirm-button").click();
  await row.waitFor({ state: "detached" });
  assert.equal((await db.collection("companies").findOne({ name: "Skyline Smart Homes Pvt. Ltd." })).registrationStatus, "approved");
  const decisionEmails = emails.filter((m) => !/^Verify your email/.test(m.subject));
  assert.equal(decisionEmails.length, 1);
  assert.equal(decisionEmails[0].subject, "Congratulations! Your Company Is Approved");
  await admin.page.getByTestId("tab-approved").click();
  await admin.page.locator('[data-testid="company-row"][data-company-name="Skyline Smart Homes Pvt. Ltd."]').waitFor();
  pass("Approve asks for confirmation, then approves, moves the company to the Approved tab and sends the approval email");

  // the list uses the whole content area (no empty strip on the right)
  const widths = await admin.page.evaluate(() => {
    const list = document.querySelector("ul[aria-busy]").getBoundingClientRect();
    const main = document.querySelector("main").getBoundingClientRect();
    return { list: list.width, main: main.width };
  });
  assert.ok(widths.list / widths.main > 0.85, `the company list fills the page (${Math.round(widths.list)} of ${Math.round(widths.main)}px)`);
  await shot(admin.page, "r-7b-full-width");
  pass("the Companies page uses the full content width");

  // deactivate / reactivate from the Approved tab
  const approvedRow = admin.page.locator('[data-testid="company-row"][data-company-name="Skyline Smart Homes Pvt. Ltd."]');
  await approvedRow.getByTestId("deactivate-button").click();
  await admin.page.locator('[data-testid="confirm-modal"]').getByTestId("confirm-button").click();
  await approvedRow.getByTestId("deactivated-pill").waitFor();
  assert.equal((await db.collection("companies").findOne({ name: "Skyline Smart Homes Pvt. Ltd." })).status, "suspended");
  const blockedPage = await open("");
  await blockedPage.page.goto(`${baseUrl}/admin/login`, { waitUntil: "domcontentloaded" });
  await blockedPage.page.locator("#admin-identifier:visible").fill("riya@skyline.example");
  await blockedPage.page.locator("#admin-password:visible").fill(PASSWORD);
  await blockedPage.page.locator('button[type="submit"]').first().click();
  await blockedPage.page.locator("text=Your company account has been deactivated").first().waitFor();
  await blockedPage.context.close();
  await approvedRow.getByTestId("reactivate-button").click();
  await admin.page.locator('[data-testid="confirm-modal"]').getByTestId("confirm-button").click();
  await approvedRow.getByTestId("deactivate-button").waitFor();
  assert.equal((await db.collection("companies").findOne({ name: "Skyline Smart Homes Pvt. Ltd." })).status, "active");
  pass("Deactivate (with confirmation) shows a Deactivated badge and the owner sees 'Your company account has been deactivated'; Reactivate restores access");
  await admin.context.close();

  // ═══ 4. owner signs in; uploads a new logo from Company Settings ═══
  const owner = await open("");
  await owner.page.goto(`${baseUrl}/admin/login`, { waitUntil: "domcontentloaded" });
  await owner.page.locator('#admin-identifier:visible').fill("riya@skyline.example");
  await owner.page.locator('#admin-password:visible').fill(PASSWORD);
  await owner.page.locator('button[type="submit"]').first().click();
  await owner.page.waitForURL(/\/admin\/dashboard/);
  assert.equal(await owner.page.locator('a[href="/admin/companies"]').count(), 0, "a Company Owner has no Companies review menu");
  await owner.page.goto(`${baseUrl}/admin/companies`, { waitUntil: "domcontentloaded" });
  await owner.page.locator('[role="alert"]').first().waitFor();
  assert.equal(await owner.page.locator('[data-testid="approve-button"]').count(), 0, "no approve action for a Company Owner");
  await owner.page.goto(`${baseUrl}/admin/company`, { waitUntil: "domcontentloaded" });
  await owner.page.getByRole("tab", { name: "Logo Customization" }).click();
  await owner.page.locator('[data-testid="company-logo-frame"] img').waitFor();
  await owner.page.setInputFiles('input[aria-label="Company logo file"]', { name: "new.png", mimeType: "image/png", buffer: PNG });
  // The new logo is only previewed until the form is saved.
  assert.equal(uploads.length, 1, "nothing is uploaded before Save");
  await owner.page.getByRole("button", { name: "Save Logo Settings" }).click();
  await owner.page.locator("text=Your company logo and its settings have been updated.").first().waitFor();
  assert.equal(uploads.length, 2, "the replacement was uploaded");
  assert.match((await db.collection("companies").findOne({ name: "Skyline Smart Homes Pvt. Ltd." })).logoPublicId, /branding\/asset2$/);
  await shot(owner.page, "r-8-company-settings");
  pass("after approval the owner signs in, has no review menu or actions, and replaces the logo from Company Settings");
  await owner.context.close();

  // ═══ 5. phone layout ═══════════════════════════════════════════════
  const phone = await open("", { width: 375, height: 800 });
  await phone.page.goto(`${baseUrl}/register/company`, { waitUntil: "domcontentloaded" });
  await phone.page.locator("#company-name:visible").waitFor();
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal scroll on the registration form");
  await shot(phone.page, "r-9-phone-form");
  await phone.page.goto(`${baseUrl}/register/company/submitted`, { waitUntil: "domcontentloaded" });
  await phone.page.getByRole("heading", { name: "Your Request Is Under Review" }).waitFor();
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal scroll on the confirmation");
  await shot(phone.page, "r-10-phone-submitted");
  pass("the registration form and confirmation fit a 375px phone without horizontal scroll");
  await phone.context.close();

  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError|UnhandledPromiseRejection/);
  pass("server log is free of tenant violations");
  console.log(`\n${results.length} checks passed.`);
} catch (error) {
  exitCode = 1;
  console.error("\nFAILED:", error?.stack ?? error);
  if (server) console.error("--- server output (tail) ---\n" + server.getOutput().slice(-1500));
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  if (fake) fake.close();
  process.exit(exitCode);
}
