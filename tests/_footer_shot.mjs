import { createRequire } from "node:module";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const out = process.env.OUT;
let server, browser;
try {
  server = await startIsolatedServer("footer-shot", [{ _id: 1, email: "d@example.com", role: "dealer", name: "Dealer", discountAllocationPercent: 10, companyId: 1 }], { production: true });
  const { db, login, baseUrl } = server; const now = new Date();
  await db.collection("companies").insertOne({ _id: 1, name: "Whyte Automations", slug: "w", status: "active", phone: "+91 98765 43210", address: "St", gstNumber: null, email: "hello@whyteautomations.example.com", logoUrl: null, tagline: "Smart homes, simply", documentSettings: { socialLinks: { whatsapp: "https://wa.me/919876543210", instagram: "https://instagram.com/w", website: "https://w.example.com" } }, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  await db.collection("housetypes").insertOne({ _id: 1, companyId: 1, name: "2 BHK", isActive: true, sortOrder: 1 });
  const cookie = await login("d@example.com", "user");
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 2 });
  await ctx.addCookies(cookie.split("; ").filter(Boolean).map((p) => { const i = p.indexOf("="); return { name: p.slice(0, i), value: p.slice(i + 1), url: baseUrl }; }));
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  for (const [name, path] of [["home", "/"], ["new", "/quotation/new"]]) {
    await page.goto(baseUrl + path, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${name}-top.png` });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-bottom.png` });
    console.log(name, await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })));
  }
} catch (e) { console.error(e); } finally { await browser?.close(); if (server) await server.cleanup(); process.exit(0); }
