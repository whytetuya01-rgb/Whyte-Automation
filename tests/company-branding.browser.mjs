/**
 * Browser + HTTP check of company-specific branding (real Chromium against an isolated production server and a
 * throwaway Mongo): each admin sees only their own company's logo in the header/sidebar and in the server-rendered
 * loader, a company without a logo (or with a broken one) gets the default Whyte logo, a Super Admin sees the
 * default on the platform and a company's logo only while acting as that company, and signing out then in as another
 * company never shows the previous company's logo.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/company-branding.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;

const LOGO = (id) => `https://logos.test/${id}.svg`;
const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60" viewBox="0 0 240 60"><rect width="240" height="60" fill="${fill}"/></svg>`;

try {
  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "admin_a@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 3, email: "admin_b@example.com", role: "admin", name: "Admin B", companyId: 20 },
    { _id: 4, email: "admin_c@example.com", role: "admin", name: "Admin C", companyId: 30 },
    { _id: 5, email: "admin_d@example.com", role: "admin", name: "Admin D", companyId: 40 },
  ];
  server = await startIsolatedServer("branding", USERS, { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  const companies = [
    [10, "alpha", LOGO("alpha")],
    [20, "beta", LOGO("beta")],
    [30, "nologo", null],
    [40, "broken", LOGO("broken")],
  ];
  await db.collection("companies").insertMany(
    companies.map(([id, slug, logoUrl]) => ({
      _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl, tagline: null, createdAt: now, updatedAt: now,
    }))
  );
  const cookie = {
    super: await login("super@example.com", "admin"),
    a: await login("admin_a@example.com", "admin"),
    b: await login("admin_b@example.com", "admin"),
    c: await login("admin_c@example.com", "admin"),
    d: await login("admin_d@example.com", "admin"),
  };

  // ── server-rendered HTML (this is what the full-screen loader and the root provider are built from) ──
  const html = async (cookieString) => (await fetch(`${baseUrl}/admin/dashboard`, { headers: { cookie: cookieString } })).text();
  const [htmlA, htmlB, htmlC, htmlSuper] = await Promise.all([html(cookie.a), html(cookie.b), html(cookie.c), html(cookie.super)]);
  assert.ok(htmlA.includes("logos.test/alpha.svg"), "A's page carries A's logo");
  assert.ok(htmlB.includes("logos.test/beta.svg"), "B's page carries B's logo");
  assert.ok(!htmlA.includes("beta.svg") && !htmlA.includes("Company beta"), "A's page never contains B's logo or name");
  assert.ok(!htmlB.includes("alpha.svg") && !htmlB.includes("Company alpha"), "B's page never contains A's logo or name");
  assert.ok(!htmlC.includes("logos.test"), "a company without a logo gets no company logo");
  assert.ok(!htmlSuper.includes("logos.test"), "a Super Admin on the platform gets no company logo");
  const loaderAt = htmlA.indexOf('role="status"');
  assert.ok(loaderAt >= 0 && htmlA.slice(loaderAt, loaderAt + 3000).includes("logos.test/alpha.svg"), `A's logo is inside the server-rendered full-screen loader (status@${loaderAt}, logo@${htmlA.indexOf("logos.test/alpha.svg")}, html sample: ${htmlA.slice(loaderAt, loaderAt + 400)})`);
  assert.ok(htmlC.slice(htmlC.indexOf('role="status"'), htmlC.indexOf('role="status"') + 3000).includes("company-logo-black"), "the loader keeps the default Whyte logo when there is no company logo");
  pass("server HTML: each company's page (loader included) carries only its own logo; no logo / platform get the default");

  browser = await chromium.launch({ headless: true });
  const newPage = async (cookieString) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route("https://logos.test/**", (route) => {
      const id = new URL(route.request().url()).pathname.replace(/\W|svg$/g, "");
      if (id === "broken") return route.fulfill({ status: 404, body: "no" });
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(id === "alpha" ? "#c33" : "#33c") });
    });
    if (cookieString) {
      await context.addCookies(cookieString.split("; ").filter(Boolean).map((pair) => {
        const i = pair.indexOf("=");
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl };
      }));
    }
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return { page, context };
  };
  const header = (page) => page.locator("header");
  const companyLogoSrcs = (page) => page.locator("img[data-company-logo]").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src")));
  const gotoDashboard = async (page) => {
    await page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "load" });
    await header(page).first().waitFor();
  };

  // ── header logo per company ──
  const a = await newPage(cookie.a);
  await gotoDashboard(a.page);
  await a.page.locator("img[data-company-logo]").first().waitFor();
  assert.deepEqual([...new Set(await companyLogoSrcs(a.page))], [LOGO("alpha")]);
  assert.ok(await a.page.locator("img[data-company-logo]").first().evaluate((i) => i.complete && i.naturalWidth > 0), "A's logo actually rendered");
  pass("Company A admin sees Company A's logo in the header");

  const b = await newPage(cookie.b);
  await gotoDashboard(b.page);
  await b.page.locator("img[data-company-logo]").first().waitFor();
  assert.deepEqual([...new Set(await companyLogoSrcs(b.page))], [LOGO("beta")]);
  pass("Company B admin sees Company B's logo (and not A's)");

  const c = await newPage(cookie.c);
  await gotoDashboard(c.page);
  assert.equal(await c.page.locator("img[data-company-logo]").count(), 0);
  assert.ok(await header(c.page).locator('img[alt="Whyte Automations logo"]').first().isVisible(), "default Whyte logo shown");
  pass("a company with no logo gets the default Whyte logo");

  const d = await newPage(cookie.d);
  await gotoDashboard(d.page);
  await d.page.waitForFunction(() => document.querySelectorAll("img[data-company-logo]").length === 0 && document.querySelector('header img[alt="Whyte Automations"], header img[alt="Whyte Automations logo"]'));
  pass("a company logo that fails to load falls back to the default Whyte logo");

  // ── Super Admin: platform vs act-as ──
  const s = await newPage(cookie.super);
  await gotoDashboard(s.page);
  assert.equal(await s.page.locator("img[data-company-logo]").count(), 0);
  pass("Super Admin on the platform sees the default Whyte logo");
  const act = await s.context.request.post(`${baseUrl}/api/platform/act-as`, { data: { companyId: 20, reason: "branding test" } });
  assert.ok(act.ok(), `act-as started (${act.status()})`);
  await gotoDashboard(s.page);
  await s.page.locator("img[data-company-logo]").first().waitFor();
  assert.deepEqual([...new Set(await companyLogoSrcs(s.page))], [LOGO("beta")]);
  assert.ok(!(await s.page.content()).includes("alpha.svg"));
  pass("Super Admin acting as Company B sees Company B's logo");
  await s.context.request.delete(`${baseUrl}/api/platform/act-as`);
  await gotoDashboard(s.page);
  assert.equal(await s.page.locator("img[data-company-logo]").count(), 0);
  pass("after ending act-as the Super Admin is back on the default logo");

  // ── sign out of A, sign in as B in the same browser: no trace of A ──
  await gotoDashboard(a.page);
  await a.page.getByRole("button", { name: /sign out/i }).first().click();
  await a.page.getByRole("button", { name: /^sign out$/i }).last().click();
  await a.page.waitForURL(/\/admin\/login/);
  assert.ok(!(await a.page.content()).includes("alpha.svg"), "login page after sign-out carries no company logo");
  await a.page.fill("#admin-identifier", "admin_b@example.com");
  await a.page.fill("#admin-password", "Password123!");
  await a.page.locator('button[type="submit"]').click();
  await a.page.waitForURL(/\/admin\/(dashboard|$)/);
  await a.page.locator("img[data-company-logo]").first().waitFor();
  assert.deepEqual([...new Set(await companyLogoSrcs(a.page))], [LOGO("beta")]);
  assert.ok(!(await a.page.content()).includes("alpha.svg"), "no trace of Company A after switching accounts");
  pass("sign out of A, sign in as B (same browser, no manual reload): only B's logo appears");

  await Promise.all([a, b, c, d, s].map((x) => x.context.close()));
  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.cleanup();
  process.exit(exitCode);
}
