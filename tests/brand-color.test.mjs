/**
 * Custom brand colour through the real API (production-mode server + throwaway local MongoDB): saving, validation
 * (strict hex, contrast gate, unknown keys), removing it, theme presets staying independent, tenant isolation
 * (Company A / B, dealers, anonymous users, Super Admin on the platform vs acting as a company) and the stylesheet
 * rendered into each company's pages.
 *
 *   node tests/brand-color.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer("brand-color", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 4, email: "dealer@example.com", role: "dealer", name: "Dealer", companyId: 10 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  const company = (id, slug) => ({ _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("companies").insertMany([company(10, "alpha"), company(20, "beta")]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 10 });
  const cookie = {
    super: await login("super@example.com", "admin"),
    a: await login("ownera@example.com", "admin"),
    b: await login("ownerb@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
  };
  const stored = (id) => db.collection("companies").findOne({ _id: id });
  const patch = async (c, body) => {
    const res = await fetch(`${baseUrl}/api/theme`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, json };
  };
  const getTheme = async (c) => (await (await fetch(`${baseUrl}/api/theme`, { headers: { Cookie: c } })).json()).data;
  const page = async (c) => (await fetch(`${baseUrl}/admin/dashboard`, { headers: { Cookie: c } })).text();
  const styleOf = (html) => /<style[^>]*id="company-brand-color"[^>]*>([^<]*)<\/style>/.exec(html)?.[1] ?? null;

  // ── save, normalise, read back ──
  const saved = await patch(cookie.a, { brandColor: "  #1B3C73 " });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal((await stored(10)).brandColor, "#1b3c73", "stored lower-case and trimmed");
  assert.equal(saved.json.data.brandColor, "#1b3c73");
  assert.equal((await getTheme(cookie.a)).brandColor, "#1b3c73");
  assert.equal((await stored(10)).theme ?? "whyte-rose", "whyte-rose", "the preset is untouched");
  pass("a company owner saves a brand colour (normalised) and reads it back; the preset theme is untouched");

  // ── validation ──
  const before = JSON.stringify(await stored(10));
  for (const [label, body, fragment] of [
    ["too light (pale yellow)", { brandColor: "#ffeb3b" }, "too light"],
    ["white", { brandColor: "#ffffff" }, "too light"],
    ["short hex", { brandColor: "#fff" }, "#rrggbb"],
    ["named colour", { brandColor: "red" }, "#rrggbb"],
    ["css injection", { brandColor: "#1b3c73;}body{display:none}" }, "#rrggbb"],
    ["wrong type", { brandColor: 123 }, "#rrggbb"],
    ["unknown key", { brandColor: "#1b3c73", companyId: 20 }, ""],
    ["empty body", {}, "Choose"],
  ]) {
    const res = await patch(cookie.a, body);
    assert.equal(res.status, 400, `${label} -> ${res.status} ${JSON.stringify(res.json)}`);
    if (fragment) assert.ok(res.json.error.message.includes(fragment), `${label}: "${res.json.error.message}"`);
  }
  assert.equal(JSON.stringify(await stored(10)), before, "rejected requests change nothing");
  pass("too-light colours (with a clear message), malformed values, injection attempts, unknown keys and empty requests are rejected without changing anything");

  // ── presets stay independent ──
  const preset = await patch(cookie.a, { theme: "emerald-haven" });
  assert.equal(preset.status, 200);
  const afterPreset = await stored(10);
  assert.equal(afterPreset.theme, "emerald-haven");
  assert.equal(afterPreset.brandColor, "#1b3c73", "choosing a preset does not erase the custom colour");
  const both = await patch(cookie.a, { theme: "champagne-bronze", brandColor: "#7c3aed" });
  assert.equal(both.status, 200);
  assert.deepEqual([(await stored(10)).theme, (await stored(10)).brandColor], ["champagne-bronze", "#7c3aed"]);
  pass("a preset and a custom colour can be saved separately or together");

  // ── the stylesheet reaches only the owning company's pages ──
  await patch(cookie.a, { brandColor: "#1b3c73" });
  const [htmlA, htmlB, htmlSuper] = await Promise.all([page(cookie.a), page(cookie.b), page(cookie.super)]);
  const cssA = styleOf(htmlA);
  assert.ok(cssA && cssA.includes("--accent:#1B3C73") && cssA.startsWith(":root:root:not([data-theme-preview]),:root:root:not([data-theme-preview]) body{"), "A's pages carry A's colour (stepping aside only during a preset preview)");
  assert.equal(styleOf(htmlB), null, "B (no custom colour) gets no override");
  assert.ok(!htmlB.includes("1B3C73") && !htmlB.includes("1b3c73"), "and none of A's colour");
  assert.equal(styleOf(htmlSuper), null, "a Super Admin on the platform gets none");
  const patchB = await patch(cookie.b, { brandColor: "#b91c1c" });
  assert.equal(patchB.status, 200);
  const htmlB2 = await page(cookie.b);
  assert.ok(styleOf(htmlB2)?.includes("--accent:#B91C1C") && !htmlB2.includes("1B3C73"), "B's pages carry B's colour only");
  assert.ok(!(await page(cookie.a)).includes("B91C1C"), "A's pages never carry B's colour");
  pass("each company's pages carry only its own brand colour; a company without one and the platform get none");

  // ── remove ──
  const removed = await patch(cookie.a, { brandColor: null });
  assert.equal(removed.status, 200);
  assert.equal((await stored(10)).brandColor, null);
  assert.equal(styleOf(await page(cookie.a)), null, "the override disappears once removed");
  pass("removing the custom colour restores the selected preset");

  // ── tenant isolation ──
  const bBefore = JSON.stringify(await stored(20));
  const hijack = await patch(cookie.a, { brandColor: "#0d9488", companyId: 20 });
  assert.equal(hijack.status, 400, "a client-supplied company id is refused outright");
  assert.equal(JSON.stringify(await stored(20)), bBefore);
  assert.equal((await patch(null, { brandColor: "#0d9488" })).status, 401, "anonymous");
  assert.equal((await patch(cookie.dealer, { brandColor: "#0d9488" })).status, 403, "a dealer cannot change the brand colour");
  assert.equal((await patch(cookie.super, { brandColor: "#0d9488" })).status, 403, "a Super Admin on the platform changes no company");
  assert.equal(JSON.stringify(await stored(20)), bBefore);
  assert.equal((await getTheme(cookie.a)).brandColor, null, "A does not see B's colour");
  pass("Company A cannot change or read Company B's colour; dealers, anonymous users and a company-less Super Admin cannot write");

  const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie.super }, body: JSON.stringify({ companyId: 20, reason: "brand colour test" }) });
  assert.equal(act.status, 200);
  const acting = [cookie.super, ...act.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ");
  const aNow = JSON.stringify(await stored(10));
  const actSave = await patch(acting, { brandColor: "#0d9488" });
  assert.equal(actSave.status, 200, JSON.stringify(actSave.json));
  assert.equal((await stored(20)).brandColor, "#0d9488", "acting as Company B changes Company B");
  assert.equal(JSON.stringify(await stored(10)), aNow, "and never Company A");
  assert.ok(styleOf(await page(acting))?.includes("--accent:#0D9488"), "while acting as B the pages carry B's colour");
  assert.equal(styleOf(await page(cookie.super)), null, "the plain Super Admin session still has none");
  pass("a Super Admin acting as Company B changes and sees only Company B's colour");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
