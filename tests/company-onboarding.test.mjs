/**
 * Company onboarding through the real API (production-mode server + throwaway local MongoDB; email and Cloudinary
 * are local fakes): owner email verification at registration (link, hashed token, expiry, resend, approval gate),
 * the company API never exposing internal fields, the dashboard setup guide, and the quotation cover image.
 *
 *   node tests/company-onboarding.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";
import { png } from "./helpers/imageFixtures.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let fake;
let exitCode = 0;

const emails = [];
const uploads = [];
const destroyed = [];
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/emails") { emails.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); res.end(JSON.stringify({ id: `em_${emails.length}` })); return; }
      if (req.url.endsWith("/image/upload")) {
        const folder = /name="folder"\r\n\r\n([^\r\n]+)/.exec(body)?.[1] ?? "";
        const publicId = `${folder}/asset${uploads.length + 1}`;
        uploads.push(publicId);
        res.end(JSON.stringify({ public_id: publicId, secure_url: `https://res.cloudinary.com/testcloud/image/upload/v1/${publicId}.png`, version: 1 }));
        return;
      }
      if (req.url.endsWith("/image/destroy")) { destroyed.push(/(whyte\/companies\/[A-Za-z0-9_/-]+)/.exec(body)?.[1] ?? ""); res.end(JSON.stringify({ result: "ok" })); return; }
      res.statusCode = 404; res.end("{}");
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

const PASSWORD = "Str0ng!Passw0rd";

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
    COMPANY_REGISTER_RATE_LIMIT_MAX: "100",
  });
  server = await startIsolatedServer("onboarding", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "owner.a@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 3, email: "owner.b@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 4, email: "dealer.a@example.com", role: "dealer", name: "Dealer A", companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  const company = (id, slug) => ({ _id: id, name: `Company ${slug}`, slug, status: "active", phone: "1111111111", address: "Street 1", gstNumber: null, email: `${slug}@example.com`, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("companies").insertMany([
    { ...company(10, "alpha"), reviewNote: "internal only", reviewedBy: 1, reviewedByName: "Super", decisionEmail: { kind: "approved", status: "sent", attempts: 1 } },
    company(20, "beta"),
  ]);
  await db.collection("counters").insertMany([{ _id: "adminUser", seq: 50 }, { _id: "company", seq: 50 }]);
  const cookie = { super: await login("super@example.com", "admin"), a: await login("owner.a@example.com", "admin"), b: await login("owner.b@example.com", "admin"), dealer: await login("dealer.a@example.com", "user") };
  const post = async (path, body, c) => {
    const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const register = async (n) => {
    const body = new FormData();
    for (const [k, v] of Object.entries({ companyName: `Reg Co ${n}`, companyEmail: `info${n}@reg.example`, companyPhone: "+91 98765 43210", companyAddress: "12 Main Street, Ahmedabad", ownerName: `Owner ${n}`, ownerEmail: `owner${n}@reg.example`, ownerPhone: "9876543210", password: PASSWORD, confirmPassword: PASSWORD })) body.append(k, v);
    const res = await fetch(`${baseUrl}/api/company/register`, { method: "POST", body });
    assert.equal(res.status, 201);
    return db.collection("companies").findOne({ name: `Reg Co ${n}` });
  };
  const tokenFrom = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  const lastMailTo = (to) => emails.filter((m) => m.to === to).at(-1);

  // ═══ 1. verification email at registration ═══
  const r1 = await register(1);
  const mail1 = lastMailTo("owner1@reg.example");
  assert.equal(mail1.subject, "Verify your email to complete your company registration");
  const token1 = tokenFrom(mail1);
  assert.ok(token1 && token1.length >= 40, "the email carries a long random token");
  assert.match(mail1.html, new RegExp(`/register/company/verify\\?token=${token1}`));
  assert.ok(!(mail1.html + mail1.text).includes(PASSWORD), "no password in the email");
  assert.equal(r1.ownerEmailVerification.tokenHash, createHash("sha256").update(token1).digest("hex"), "only the token's hash is stored");
  assert.ok(!JSON.stringify(r1).includes(token1), "the raw token is never stored");
  assert.equal(r1.ownerEmailVerification.verifiedAt, null);
  assert.ok(r1.ownerEmailVerification.expiresAt > new Date(Date.now() + 47 * 3600 * 1000), "the link is valid for 48 hours");
  pass("registration emails the owner a verification link; only the token's SHA-256 is stored, with a 48-hour expiry");

  // ═══ 2. approval waits for verification ═══
  const blocked = await api(cookie.super, "POST", `/api/platform/company-registrations/${r1._id}/approve`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.json?.error?.message ?? blocked.text, /not verified/i);
  const listed = (await api(cookie.super, "GET", "/api/platform/company-registrations?status=pending_review")).data.items.find((i) => i.id === r1._id);
  assert.equal(listed.ownerEmailVerified, false);
  pass("a request cannot be approved until its owner verifies the email; the review list shows it as not verified");

  // ═══ 3. the verify endpoint ═══
  assert.equal((await post("/api/company/register/verify", { token: "short" })).status, 400, "malformed token");
  assert.equal((await post("/api/company/register/verify", { token: "A".repeat(43) })).status, 404, "unknown token");
  assert.equal((await post("/api/company/register/verify", {})).status, 400, "missing token");
  const ok = await post("/api/company/register/verify", { token: token1 });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.data, { companyName: "Reg Co 1", alreadyVerified: false });
  assert.ok((await db.collection("companies").findOne({ _id: r1._id })).ownerEmailVerification.verifiedAt instanceof Date);
  assert.equal((await post("/api/company/register/verify", { token: token1 })).json.data.alreadyVerified, true, "opening the link again is harmless");
  const approved = await api(cookie.super, "POST", `/api/platform/company-registrations/${r1._id}/approve`);
  assert.equal(approved.status, 200, approved.text);
  pass("the link verifies the owner's email exactly once (again = 'already verified'); malformed or unknown tokens are refused; then approval works");

  // expiry
  const r2 = await register(2);
  const token2 = tokenFrom(lastMailTo("owner2@reg.example"));
  await db.collection("companies").updateOne({ _id: r2._id }, { $set: { "ownerEmailVerification.expiresAt": new Date(Date.now() - 1000) } });
  const expired = await post("/api/company/register/verify", { token: token2 });
  assert.equal(expired.status, 409);
  assert.equal(expired.json.error.details.reason, "expired");
  assert.equal((await db.collection("companies").findOne({ _id: r2._id })).ownerEmailVerification.verifiedAt, null);
  pass("an expired link verifies nothing and says it has expired");

  // ═══ 4. resend ═══
  const before = emails.length;
  const generic = await post("/api/company/register/resend-verification", { email: "nobody@reg.example" });
  const real = await post("/api/company/register/resend-verification", { email: "owner2@reg.example" });
  assert.equal(generic.status, 200);
  assert.deepEqual(generic.json, real.json, "the answer is identical whether or not the email is registered");
  assert.equal(emails.length, before + 1, "only the real pending registration gets an email");
  const token2b = tokenFrom(lastMailTo("owner2@reg.example"));
  assert.notEqual(token2b, token2);
  assert.equal((await post("/api/company/register/verify", { token: token2 })).status, 404, "the old link stops working");
  assert.equal((await post("/api/company/register/verify", { token: token2b })).status, 200, "the new link works");
  assert.equal((await post("/api/company/register/resend-verification", { email: "owner1@reg.example" })).status, 200);
  assert.equal(emails.length, before + 1, "an already-verified registration gets no new email");
  assert.equal((await post("/api/company/register/resend-verification", { email: "not-an-email" })).status, 400);
  let limited = null;
  for (let i = 0; i < 6 && !limited; i++) {
    const res = await post("/api/company/register/resend-verification", { email: "owner3@reg.example" });
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, "resending is rate limited");
  pass("resend answers identically for unknown emails, replaces the old link, skips verified registrations and is rate limited");

  const r3 = await register(4);
  const adminResend = await api(cookie.super, "POST", `/api/platform/company-registrations/${r3._id}/resend-verification`);
  assert.equal(adminResend.status, 200, adminResend.text);
  assert.equal(emails.filter((m) => m.to === "owner4@reg.example").length, 2, "the Super Admin can send the owner a new link");
  assert.equal((await api(cookie.super, "POST", `/api/platform/company-registrations/${r1._id}/resend-verification`)).status, 409, "not for an approved request");
  assert.equal((await api(cookie.a, "POST", `/api/platform/company-registrations/${r3._id}/resend-verification`)).status, 403, "a company owner cannot use it");
  pass("a Super Admin can resend the verification link (only for requests still waiting; nobody else can)");

  // legacy registrations (before verification existed) are approvable as before
  await db.collection("companies").insertOne({ ...company(30, "legacy-pending"), status: "pending", registrationStatus: "pending_review", registrationSubmittedAt: now });
  const legacy = await api(cookie.super, "POST", "/api/platform/company-registrations/30/approve");
  assert.equal(legacy.status, 200, legacy.text);
  pass("registrations made before email verification existed are approved exactly as before");

  // ═══ 5. the company API hides internal fields ═══
  const profile = await (await fetch(`${baseUrl}/api/company`, { headers: { Cookie: cookie.a } })).json();
  assert.equal(profile._id, 10);
  for (const field of ["reviewNote", "reviewedBy", "reviewedByName", "decisionEmail", "ownerEmailVerification", "coverImagePublicId"]) {
    assert.ok(!(field in profile), `GET /api/company does not return ${field}`);
  }
  pass("the company API never returns review notes, reviewer, decision-email internals, verification data or storage ids");

  // ═══ 6. setup guide ═══
  const guideB = await api(cookie.b, "GET", "/api/company/onboarding");
  assert.equal(guideB.status, 200);
  assert.equal(guideB.data.total, 9);
  assert.deepEqual(guideB.data.steps.filter((s) => s.done).map((s) => s.id), ["profile"], "a fresh company has only its profile done");
  await db.collection("categories").insertOne({ _id: 201, companyId: 20, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
  await db.collection("products").insertOne({ _id: 201, companyId: 20, name: "Smart Switch", code: "P-1", type: "switch_board", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 201, companyId: 20, productId: 201, variantCode: "V-1", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  await db.collection("companies").updateOne({ _id: 20 }, { $set: { brandColor: "#1b3c73" } });
  const guideB2 = await api(cookie.b, "GET", "/api/company/onboarding");
  assert.deepEqual(guideB2.data.steps.filter((s) => s.done).map((s) => s.id).sort(), ["categories", "colours", "products", "profile"].sort(), "steps tick off from real data");
  const guideA = await api(cookie.a, "GET", "/api/company/onboarding");
  assert.ok(!guideA.data.steps.find((s) => s.id === "categories").done, "Company B's data never counts for Company A");
  assert.equal((await fetch(`${baseUrl}/api/company/onboarding`, { method: "DELETE", headers: { Cookie: cookie.dealer } })).status, 403, "a dealer cannot hide the guide");
  assert.equal((await fetch(`${baseUrl}/api/company/onboarding`, { method: "DELETE", headers: { Cookie: cookie.b } })).status, 200);
  assert.equal((await api(cookie.b, "GET", "/api/company/onboarding")).data.dismissed, true);
  assert.equal((await api(cookie.a, "GET", "/api/company/onboarding")).data.dismissed, false, "hiding is per company");
  assert.equal((await api(cookie.super, "GET", "/api/company/onboarding")).status, 403, "no guide without a company context");
  pass("the setup guide's 9 steps are worked out from each company's own data; hiding it is per company and needs company:edit");

  // ═══ 7. cover image ═══
  const upload = async (c, bytes, type = "image/png") => {
    const body = new FormData();
    body.append("coverImage", new Blob([bytes], { type }), "cover.png");
    const res = await fetch(`${baseUrl}/api/company/cover-image`, { method: "POST", headers: c ? { Cookie: c } : {}, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const coverOk = await upload(cookie.a, png(900, 500));
  assert.equal(coverOk.status, 200, JSON.stringify(coverOk.json));
  const a1 = await db.collection("companies").findOne({ _id: 10 });
  assert.match(a1.coverImageUrl, /^https:\/\/res\.cloudinary\.com\/testcloud\//);
  assert.ok(a1.coverImagePublicId.startsWith("whyte/companies/10/branding/"), "stored in the company's own branding folder");
  for (const [label, bytes, type, status] of [
    ["too small", png(400, 300), "image/png", 400],
    ["portrait", png(600, 900), "image/png", 400],
    ["too wide", png(2000, 500), "image/png", 400],
    ["svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml", 415],
  ]) {
    const res = await upload(cookie.a, bytes, type);
    assert.equal(res.status, status, `${label}: ${res.status} ${JSON.stringify(res.json)}`);
    assert.equal(res.json.error.field, "coverImage", label);
  }
  const replaced = await upload(cookie.a, png(1200, 800));
  assert.equal(replaced.status, 200);
  assert.ok(destroyed.includes(a1.coverImagePublicId), "the previous cover file is deleted after the new one is saved");
  assert.equal((await db.collection("companies").findOne({ _id: 20 })).coverImageUrl ?? null, null, "Company B is untouched");
  assert.equal((await upload(cookie.dealer, png(900, 500))).status, 403, "a dealer cannot change it");
  assert.equal((await upload(null, png(900, 500))).status, 401);
  assert.equal((await upload(cookie.super, png(900, 500))).status, 403, "a Super Admin on the platform changes no company");
  const del = await fetch(`${baseUrl}/api/company/cover-image`, { method: "DELETE", headers: { Cookie: cookie.a } });
  assert.equal(del.status, 200);
  assert.equal((await db.collection("companies").findOne({ _id: 10 })).coverImageUrl, null);
  pass("the cover image is validated (type, pixel size, landscape), stored per company, replaced and removed safely; only company admins can change it");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  fake?.close();
  process.exit(exitCode);
}
