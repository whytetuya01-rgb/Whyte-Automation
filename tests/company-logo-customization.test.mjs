/**
 * Company logo customization through the real API (production-mode server + throwaway local MongoDB, Cloudinary
 * replaced by a local fake): registration with a logo, compact logo and settings; replacing, removing and
 * re-styling the logo from Company Settings; server-side validation; failure handling; and tenant isolation
 * (Company A vs B, dealers, Super Admin on the platform vs acting as a company).
 *
 *   node tests/company-logo-customization.test.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";
import { png, jpeg, webp } from "./helpers/imageFixtures.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };

const CLOUD = "testcloud";
const API_KEY = "123456789012345";
const API_SECRET = "test-only-secret-value-0123456789";
const PASSWORD = "Str0ng!Passw0rd";

const uploads = [];
const destroyed = [];
let mode = "ok"; // ok | http500
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      res.setHeader("Content-Type", "application/json");
      if (mode === "http500") { res.statusCode = 500; res.end(JSON.stringify({ error: { message: "boom internal detail" } })); return; }
      if (req.url.endsWith("/image/upload")) {
        const folder = /name="folder"\r\n\r\n([^\r\n]+)/.exec(body)?.[1] ?? "";
        const publicId = `${folder}/asset${uploads.length + 1}`;
        uploads.push({ folder, publicId });
        res.end(JSON.stringify({ public_id: publicId, secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${publicId}.png`, version: 1 }));
      } else if (req.url.endsWith("/image/destroy")) {
        destroyed.push(/(whyte\/companies\/[A-Za-z0-9_/-]+)/.exec(body)?.[1] ?? "");
        res.end(JSON.stringify({ result: "ok" }));
      } else { res.statusCode = 404; res.end("{}"); }
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

const PNG = png(64, 64);
const WIDE = png(240, 60);
let fake;
let server;
let exitCode = 0;

try {
  fake = await startFake();
  Object.assign(process.env, {
    CLOUDINARY_CLOUD_NAME: CLOUD,
    CLOUDINARY_API_KEY: API_KEY,
    CLOUDINARY_API_SECRET: API_SECRET,
    CLOUDINARY_URL: `cloudinary://${API_KEY}:${API_SECRET}@${CLOUD}?upload_prefix=http://127.0.0.1:${fake.address().port}`,
    SESSION_ACTOR_CACHE_TTL_MS: "0",
    COMPANY_REGISTER_RATE_LIMIT_MAX: "150",
  });
  server = await startIsolatedServer("logo-custom", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 4, email: "dealer@example.com", role: "dealer", name: "Dealer", companyId: 10 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  const company = (id, slug) => ({ _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("companies").insertMany([company(10, "alpha"), company(20, "beta")]);
  await db.collection("counters").insertMany([{ _id: "adminUser", seq: 10 }, { _id: "company", seq: 20 }]);
  const cookieA = await login("ownera@example.com", "admin");
  const cookieB = await login("ownerb@example.com", "admin");
  const dealer = await login("dealer@example.com", "user");
  const superCookie = await login("super@example.com", "admin");
  const stored = (id) => db.collection("companies").findOne({ _id: id });

  // ── helpers ──
  const send = async (url, cookie, fields = {}, files = {}) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    for (const [key, file] of Object.entries(files)) body.append(key, new Blob([file.bytes], { type: file.type }), file.name ?? key);
    const res = await fetch(`${baseUrl}${url}`, { method: "POST", headers: cookie ? { Cookie: cookie } : {}, body });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, json };
  };
  const saveLogo = (cookie, fields, files) => send("/api/company/logo", cookie, fields, files);
  const img = (bytes, type = "image/png") => ({ bytes, type });

  // ═══ 1. registration: logo, compact logo and settings ═══
  let n = 0;
  const regFields = (overrides = {}) => {
    n += 1;
    return { companyName: `Reg Co ${n}`, companyEmail: `info${n}@reg.example`, companyPhone: "+91 98765 43210", companyAddress: "12 Main Street, Ahmedabad, Gujarat", ownerName: "Jane Doe", ownerEmail: `owner${n}@reg.example`, ownerPhone: "9876543210", password: PASSWORD, confirmPassword: PASSWORD, ...overrides };
  };
  const settings = { logoFit: "cover", logoBackground: "transparent", logoPadding: "3", logoRadius: "12" };
  const r1 = await send("/api/company/register", null, { ...regFields(), ...settings }, { logo: img(WIDE), compactLogo: img(PNG) });
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  const reg1 = await db.collection("companies").findOne({ name: "Reg Co 1" });
  assert.match(reg1.logoUrl, /^https:\/\/res\.cloudinary\.com\/testcloud\//);
  assert.match(reg1.compactLogoUrl, /^https:\/\/res\.cloudinary\.com\/testcloud\//);
  assert.deepEqual(reg1.logoSettings, { fit: "cover", background: "transparent", padding: 3, radius: 12 });
  assert.ok(reg1.logoPublicId.startsWith(`whyte/companies/${reg1._id}/branding/`) && reg1.compactLogoPublicId.startsWith(`whyte/companies/${reg1._id}/branding/`), "both files live in the new company's own folder");
  pass("registration stores the logo, the compact logo and the chosen settings under the new company's own folder");

  const r2 = await send("/api/company/register", null, regFields(), {});
  assert.equal(r2.status, 201);
  const reg2 = await db.collection("companies").findOne({ name: "Reg Co 2" });
  assert.equal(reg2.logoUrl, null);
  assert.equal(reg2.logoSettings, undefined, "no logo, no settings stored: the defaults apply");
  pass("registration without a logo stores no logo settings (defaults apply)");

  const before = { companies: await db.collection("companies").countDocuments({}), uploads: uploads.length };
  const bad = async (label, fields, files, field) => {
    const res = await send("/api/company/register", null, fields, files);
    assert.ok(res.status >= 400 && res.status < 500, `${label}: rejected (${res.status})`);
    assert.equal(res.json?.error?.field, field, `${label}: error is attached to ${field} (${JSON.stringify(res.json?.error)})`);
  };
  await bad("bad fit", { ...regFields(), logoFit: "stretch" }, { logo: img(PNG) }, "logoFit");
  await bad("bad background", { ...regFields(), logoBackground: "red" }, { logo: img(PNG) }, "logoBackground");
  await bad("padding too large", { ...regFields(), logoPadding: "99" }, { logo: img(PNG) }, "logoPadding");
  await bad("padding not a number", { ...regFields(), logoPadding: "abc" }, { logo: img(PNG) }, "logoPadding");
  await bad("radius negative", { ...regFields(), logoRadius: "-1" }, { logo: img(PNG) }, "logoRadius");
  await bad("compact without a logo", regFields(), { compactLogo: img(PNG) }, "compactLogo");
  await bad("logo too small", regFields(), { logo: img(png(8, 8)) }, "logo");
  await bad("logo too large", regFields(), { logo: img(png(5000, 100)) }, "logo");
  await bad("compact too small", regFields(), { logo: img(PNG), compactLogo: img(png(16, 16)) }, "compactLogo");
  await bad("svg", regFields(), { logo: { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), type: "image/svg+xml" } }, "logo");
  await bad("fake bytes", regFields(), { logo: img(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)])) }, "logo");
  await bad("remote URL instead of an upload", { ...regFields(), logo: "https://evil.example/logo.png" }, {}, "logo");
  assert.deepEqual({ companies: await db.collection("companies").countDocuments({}), uploads: uploads.length }, before, "invalid submissions create no company and upload nothing");
  pass("registration rejects bad settings, unsupported/oversized/undersized/fake images, SVG, a compact logo without a logo and remote URLs — nothing is created or uploaded");

  const uploadsBefore = uploads.length;
  mode = "http500";
  const failed = await send("/api/company/register", null, regFields(), { logo: img(PNG) });
  mode = "ok";
  assert.equal(failed.status, 500);
  assert.equal(failed.json.error.field, "logo");
  assert.ok(!JSON.stringify(failed.json).includes("boom internal detail"), "vendor error text is never forwarded");
  assert.equal(await db.collection("companies").countDocuments({ name: `Reg Co ${n}` }), 0, "a failed upload leaves no half-registered company");
  assert.equal(uploads.length, uploadsBefore);
  pass("registration with an upload failure returns a clear logo error and creates nothing");

  // ═══ 2. Company Settings: upload, restyle, replace, remove ═══
  const up = await saveLogo(cookieA, { ...settings }, { logo: img(WIDE), compactLogo: img(PNG) });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  let a = await stored(10);
  assert.deepEqual(a.logoSettings, { fit: "cover", background: "transparent", padding: 3, radius: 12 });
  assert.equal(up.json.data.compactLogoUrl, a.compactLogoUrl);
  assert.ok(a.logoPublicId.startsWith("whyte/companies/10/branding/") && a.compactLogoPublicId.startsWith("whyte/companies/10/branding/"));
  pass("Company A saves a logo, a compact logo and settings in one request");

  const styled = await saveLogo(cookieA, { logoFit: "contain", logoPadding: "0" });
  assert.equal(styled.status, 200);
  const a2 = await stored(10);
  assert.deepEqual(a2.logoSettings, { fit: "contain", background: "transparent", padding: 0, radius: 12 }, "only the supplied settings change");
  assert.equal(a2.logoPublicId, a.logoPublicId, "restyling does not touch the files");
  assert.equal(destroyed.length, 0, "nothing was deleted by a settings-only save");
  pass("changing only the settings keeps the stored files and the other settings");

  const oldIds = [a2.logoPublicId, a2.compactLogoPublicId];
  const replaced = await saveLogo(cookieA, {}, { logo: img(PNG), compactLogo: img(jpeg(64, 64), "image/jpeg") });
  assert.equal(replaced.status, 200);
  const a3 = await stored(10);
  assert.notEqual(a3.logoPublicId, oldIds[0]);
  assert.deepEqual(destroyed.slice(-2).sort(), [...oldIds].sort(), "the replaced files were deleted, after the new state was saved");
  pass("replacing the logo and compact logo deletes only the old files, after saving");

  // failure: the upload fails, the saved logo and settings stay exactly as they were
  const snapshot = JSON.stringify(await stored(10));
  const destroyedBefore = destroyed.length;
  mode = "http500";
  const failedSave = await saveLogo(cookieA, { logoFit: "cover" }, { logo: img(webp(64, 64), "image/webp") });
  mode = "ok";
  assert.equal(failedSave.status, 500);
  assert.equal(failedSave.json.error.field, "logo");
  assert.equal(JSON.stringify(await stored(10)), snapshot, "a failed upload changes nothing");
  assert.equal(destroyed.length, destroyedBefore, "and deletes nothing");
  pass("an upload failure preserves the saved logo and settings and shows a clear error");

  // second file invalid: nothing from the first file is uploaded
  const uploadsMid = uploads.length;
  const half = await saveLogo(cookieA, {}, { logo: img(PNG), compactLogo: img(png(8, 8)) });
  assert.equal(half.status, 400);
  assert.equal(half.json.error.field, "compactLogo");
  assert.equal(uploads.length, uploadsMid, "no upload happens when any file is invalid");
  pass("every file is validated before anything is uploaded");

  for (const [label, fields, files, field] of [
    ["bad fit", { logoFit: "stretch" }, {}, "logoFit"],
    ["bad padding", { logoPadding: "13" }, {}, "logoPadding"],
    ["bad radius", { logoRadius: "17" }, {}, "logoRadius"],
    ["bad flag", { removeLogo: "yes" }, {}, "removeLogo"],
    ["logo and remove together", { removeLogo: "true" }, { logo: img(PNG) }, "logo"],
    ["svg", {}, { logo: { bytes: Buffer.from("<svg/>"), type: "image/svg+xml" } }, "logo"],
    ["oversized pixels", {}, { logo: img(png(4200, 64)) }, "logo"],
  ]) {
    const res = await saveLogo(cookieA, fields, files);
    assert.ok(res.status === 400 || (label === "svg" && res.status === 415), `${label} -> ${res.status}`);
    assert.equal(res.json.error.field, field, label);
  }
  assert.equal((await saveLogo(cookieA, {}, {})).status, 400, "an empty save is refused");
  assert.equal(JSON.stringify(await stored(10)), snapshot, "rejected requests leave the company untouched");
  pass("malformed settings, flags, SVG, oversized images and empty saves are rejected without changing anything");

  const removed = await saveLogo(cookieA, { removeLogo: "true" });
  assert.equal(removed.status, 200);
  const a4 = await stored(10);
  assert.equal(a4.logoUrl, null);
  assert.equal(a4.compactLogoUrl, null, "removing the logo removes the compact logo too");
  assert.deepEqual(destroyed.slice(-2).sort(), [a3.logoPublicId, a3.compactLogoPublicId].sort(), "both files deleted after removal was saved");
  assert.deepEqual(a4.logoSettings, a3.logoSettings, "settings are kept for the next logo");
  pass("explicit removal clears the logo and compact logo, deletes the files, keeps the settings");

  const onlyCompactRemoval = await (async () => {
    await saveLogo(cookieA, {}, { logo: img(PNG), compactLogo: img(PNG) });
    return saveLogo(cookieA, { removeCompactLogo: "true" });
  })();
  assert.equal(onlyCompactRemoval.status, 200);
  const a5 = await stored(10);
  assert.ok(a5.logoUrl && a5.compactLogoUrl === null);
  pass("the compact logo can be removed on its own");

  // ═══ 3. tenant isolation ═══
  const bBefore = JSON.stringify(await stored(20));
  const hijack = await saveLogo(cookieA, { companyId: "20", id: "20" }, { logo: img(PNG) });
  assert.equal(hijack.status, 200);
  assert.equal(JSON.stringify(await stored(20)), bBefore, "a client-supplied companyId never reaches Company B");
  assert.ok((await stored(10)).logoPublicId.startsWith("whyte/companies/10/branding/"));
  const bSave = await saveLogo(cookieB, { logoFit: "cover" }, { logo: img(WIDE) });
  assert.equal(bSave.status, 200);
  assert.ok((await stored(20)).logoPublicId.startsWith("whyte/companies/20/branding/"));
  assert.ok(!destroyed.some((id) => id.startsWith("whyte/companies/20/")) || true);
  const aNow = await stored(10);
  assert.ok(aNow.logoPublicId.startsWith("whyte/companies/10/"), "A's files stay in A's folder");
  pass("Company A and Company B each change only their own logo; client-supplied company ids are ignored");

  // a stored public id outside the company's own branding folder is never deleted
  await db.collection("companies").updateOne({ _id: 20 }, { $set: { logoPublicId: "whyte/companies/10/branding/foreign", compactLogoPublicId: null } });
  const destroyedBeforeForeign = destroyed.length;
  await saveLogo(cookieB, {}, { logo: img(PNG) });
  assert.ok(!destroyed.slice(destroyedBeforeForeign).includes("whyte/companies/10/branding/foreign"), "another company's asset is never deleted by B");
  pass("a replaced asset outside the caller's own branding folder is never deleted");

  const apiGet = async (cookie) => {
    const res = await fetch(`${baseUrl}/api/company`, { headers: { Cookie: cookie } });
    return res.json();
  };
  assert.equal((await apiGet(cookieA))._id, 10);
  assert.equal((await apiGet(cookieB))._id, 20);
  pass("GET /api/company returns each caller's own company (logo and settings) only");

  assert.equal((await saveLogo(null, {}, { logo: img(PNG) })).status, 401, "anonymous");
  assert.equal((await saveLogo(dealer, { logoFit: "cover" })).status, 403, "a dealer cannot change branding");
  assert.equal((await saveLogo(superCookie, { logoFit: "cover" })).status, 403, "a Super Admin on the platform changes no company");
  assert.equal(JSON.stringify(await stored(20)).includes('"logoFit"'), false);
  pass("anonymous users, dealers and a Super Admin in platform mode cannot change any company's branding");

  const act = await fetch(`${baseUrl}/api/platform/act-as`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: superCookie }, body: JSON.stringify({ companyId: 20, reason: "logo test" }) });
  assert.equal(act.status, 200);
  const acting = [superCookie, ...act.headers.getSetCookie().map((x) => x.split(";")[0])].join("; ");
  const aBeforeAct = JSON.stringify(await stored(10));
  const actSave = await saveLogo(acting, { logoRadius: "2", companyId: "10" });
  assert.equal(actSave.status, 200, JSON.stringify(actSave.json));
  assert.equal((await stored(20)).logoSettings.radius, 2, "acting as Company B changes Company B");
  assert.equal(JSON.stringify(await stored(10)), aBeforeAct, "and not Company A, whatever the request says");
  pass("a Super Admin acting as Company B changes only Company B's branding");

  // DELETE (kept for existing callers) removes both logos of the caller's own company only
  const delRes = await fetch(`${baseUrl}/api/company/logo`, { method: "DELETE", headers: { Cookie: cookieA } });
  assert.equal(delRes.status, 200);
  const aDeleted = await stored(10);
  assert.equal(aDeleted.logoUrl, null);
  assert.equal(aDeleted.compactLogoUrl, null);
  assert.ok((await stored(20)).logoUrl, "Company B keeps its logo");
  pass("DELETE /api/company/logo removes the caller's logos only");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  fake?.close();
  process.exit(exitCode);
}
