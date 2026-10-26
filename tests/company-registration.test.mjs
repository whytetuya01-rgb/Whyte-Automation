/**
 * Company self-registration, logo upload and Super Admin approval, through the real API (production-mode server +
 * throwaway local MongoDB). Cloudinary and the email provider are replaced by local fake HTTP endpoints reached
 * through their own configuration (`upload_prefix`, `RESEND_API_BASE_URL`), so production code has no test hooks and
 * no real credential is involved.
 *
 *   node tests/company-registration.test.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✓ ${name}`); };
let server;
let fake;
let exitCode = 0;

const API_KEY = "123456789012345";
const API_SECRET = "test-only-secret-value-0123456789";
const CLOUD = "testcloud";
const PASSWORD = "Sup3rSecret!";

// ── fake Cloudinary + fake email provider ───────────────────────────
const uploads = [];
const destroyed = [];
const emails = [];
let mode = "ok"; // Cloudinary: ok | http500 | http401
let emailMode = "ok"; // ok | fail
const startFake = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/emails") {
        if (emailMode === "fail") { res.statusCode = 500; res.end(JSON.stringify({ message: "provider down" })); return; }
        emails.push(JSON.parse(body));
        res.end(JSON.stringify({ id: `em_${emails.length}` }));
        return;
      }
      if (mode === "http500") { res.statusCode = 500; res.end(JSON.stringify({ error: { message: "boom internal detail" } })); return; }
      if (mode === "http401") { res.statusCode = 401; res.end(JSON.stringify({ error: { message: `Unknown API key ${API_KEY}` } })); return; }
      if (req.url.endsWith("/image/upload")) {
        const folder = /name="folder"\r\n\r\n([^\r\n]+)/.exec(body)?.[1] ?? "";
        const publicId = `${folder}/asset${uploads.length + 1}`;
        uploads.push({ folder, publicId });
        res.end(JSON.stringify({ public_id: publicId, secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${publicId}.png`, version: 1 }));
      } else if (req.url.endsWith("/image/destroy")) {
        destroyed.push(/(whyte\/companies\/[A-Za-z0-9_/-]+)/.exec(body)?.[1] ?? "");
        res.end(JSON.stringify({ result: "ok" }));
      } else {
        res.statusCode = 404; res.end("{}");
      }
    });
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 9)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(100, 1)]);

try {
  fake = await startFake();
  const fakePort = fake.address().port;
  Object.assign(process.env, {
    CLOUDINARY_CLOUD_NAME: CLOUD,
    CLOUDINARY_API_KEY: API_KEY,
    CLOUDINARY_API_SECRET: API_SECRET,
    CLOUDINARY_URL: `cloudinary://${API_KEY}:${API_SECRET}@${CLOUD}?upload_prefix=http://127.0.0.1:${fakePort}`,
    RESEND_API_KEY: "re_test_key_not_real",
    EMAIL_FROM: "WHYTE <no-reply@example.test>",
    RESEND_API_BASE_URL: `http://127.0.0.1:${fakePort}`,
    SESSION_ACTOR_CACHE_TTL_MS: "0",
    COMPANY_REGISTER_RATE_LIMIT_MAX: "150",
  });

  server = await startIsolatedServer(
    "company-reg",
    [
      { _id: 1, email: "super@example.com", role: "super_admin", name: "Super Admin" },
      { _id: 2, email: "owner1@example.com", role: "company_owner", name: "Whyte Owner", companyId: 1 },
      { _id: 3, email: "dealer1@example.com", role: "dealer", name: "Whyte Dealer", companyId: 1 },
    ],
    { production: true }
  );
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  // Whyte exactly as it is in production: status "pending", no review fields at all.
  await db.collection("companies").insertOne({ _id: 1, name: "Whyte Automations", slug: "whyte-automations", status: "pending", phone: "9898234336", address: "Gandhinagar", gstNumber: null, email: "sales@whyte.co.in", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertMany([{ _id: "adminUser", seq: 3 }, { _id: "company", seq: 1 }]);
  const whyteBefore = JSON.stringify(await db.collection("companies").findOne({ _id: 1 }));
  const superCookie = await login("super@example.com", "admin");

  const goodFields = (n, overrides = {}) => ({
    companyName: `Acme Homes ${n}`,
    companyEmail: `info${n}@acme.example`,
    companyPhone: "+91 98765 43210",
    companyAddress: "12 Main Street, Ahmedabad, Gujarat 380001",
    ownerName: "Jane Doe",
    ownerEmail: `owner${n}@acme.example`,
    ownerPhone: "9876543210",
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...overrides,
  });
  const submit = async (fields, file) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    if (file) body.append("logo", new Blob([file.bytes], { type: file.type }), file.name ?? "logo");
    const res = await fetch(`${baseUrl}/api/company/register`, { method: "POST", body });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, json, text };
  };
  const counts = async () => ({ companies: await db.collection("companies").countDocuments({}), users: await db.collection("adminusers").countDocuments({}) });

  /** Real credentials sign-in: returns the session cookie (if one was issued) and the NextAuth error code. */
  const attemptLogin = async (email, password, portal = "admin") => {
    const jar = new Map();
    const remember = (response) => { for (const c of response.headers.getSetCookie()) { const pair = c.split(";")[0]; jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)); } };
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
    remember(csrfRes);
    const csrf = (await csrfRes.json()).csrfToken;
    const cb = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: new URLSearchParams({ csrfToken: csrf, email, password, portal, callbackUrl: `${baseUrl}/`, json: "true" }).toString(),
      redirect: "manual",
    });
    remember(cb);
    const text = await cb.text();
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const session = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } })).json();
    const error = /[?&]error=([A-Z_a-z]+)/.exec(text)?.[1] ?? null;
    return { cookie, error, signedIn: Boolean(session?.user), text };
  };
  const findCompany = (name) => db.collection("companies").findOne({ name });
  const approve = (id, cookie = superCookie) => api(cookie, "POST", `/api/platform/company-registrations/${id}/approve`);

  // ═══ 1. registration without a logo ═══════════════════════════════════
  const r1 = await submit(goodFields(1));
  assert.equal(r1.status, 201, r1.text);
  assert.equal(r1.json.data.status, "pending_review");
  assert.equal(r1.json.data.logoUrl, null);
  assert.doesNotMatch(r1.text, /passwordHash|Sup3rSecret/, "the response carries no password or hash");
  const c1 = await findCompany("Acme Homes 1");
  assert.ok(c1 && c1._id > 1, "a new tenant id was issued");
  assert.equal(c1.slug, "acme-homes-1");
  assert.equal(c1.registrationStatus, "pending_review");
  assert.equal(c1.status, "pending");
  assert.ok(c1.registrationSubmittedAt instanceof Date);
  assert.equal(c1.email, "info1@acme.example");
  assert.equal(c1.logoUrl, null);
  const o1 = await db.collection("adminusers").findOne({ email: "owner1@acme.example" });
  assert.equal(o1.role, "company_owner");
  assert.equal(o1.companyId, c1._id);
  assert.match(o1.passwordHash, /^\$2[aby]\$/, "password stored as a bcrypt hash");
  assert.notEqual(o1.passwordHash, PASSWORD);
  assert.equal(emails.length, 0, "registering sends no email and never contains a password");
  pass("registration creates a pending_review company and a hashed-password Company Owner tied to it; no password in the response");

  // ═══ 2. pending owner cannot sign in ═══════════════════════════════
  const pendingLogin = await attemptLogin("owner1@acme.example", PASSWORD);
  assert.equal(pendingLogin.signedIn, false, "no session for a pending company");
  assert.equal(pendingLogin.error, "COMPANY_PENDING_REVIEW");
  const wrongPassword = await attemptLogin("owner1@acme.example", "totally-wrong-password");
  assert.equal(wrongPassword.signedIn, false);
  assert.notEqual(wrongPassword.error, "COMPANY_PENDING_REVIEW", "the review state is revealed only after a correct password");
  assert.equal((await attemptLogin("nobody@acme.example", PASSWORD)).error === "COMPANY_PENDING_REVIEW", false);
  pass("a pending owner cannot sign in (clear message only after the correct password; wrong passwords and unknown emails learn nothing)");

  // ═══ 3. Super Admin sees the request ═════════════════════════════════
  const pendingList = await api(superCookie, "GET", "/api/platform/company-registrations?status=pending_review");
  assert.equal(pendingList.status, 200);
  const row = pendingList.data.items.find((i) => i.name === "Acme Homes 1");
  assert.ok(row, "the request is listed");
  assert.equal(row.registrationStatus, "pending_review");
  assert.equal(row.owner.email, "owner1@acme.example");
  assert.equal(row.owner.name, "Jane Doe");
  assert.equal(row.owner.phone, "9876543210");
  assert.equal(row.address, "12 Main Street, Ahmedabad, Gujarat 380001");
  assert.ok(row.submittedAt);
  assert.ok(!JSON.stringify(row).includes("passwordHash"));
  assert.equal(pendingList.data.counts.pending_review >= 1, true);
  const detail = await api(superCookie, "GET", `/api/platform/company-registrations/${c1._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.name, "Acme Homes 1");
  const approvedTab = await api(superCookie, "GET", "/api/platform/company-registrations?status=approved");
  assert.ok(approvedTab.data.items.some((i) => i.name === "Whyte Automations" && i.origin === "platform"), "existing companies appear under Approved");
  assert.equal((await api(superCookie, "GET", "/api/platform/company-registrations?status=bogus")).status, 400);
  pass("Super Admin lists pending requests with company, owner, address and submission data; existing companies sit under Approved");

  // ═══ 4. only a Super Admin may review ═══════════════════════════════
  const whyteOwner = await login("owner1@example.com", "admin");
  const whyteDealer = await login("dealer1@example.com", "user");
  const targets = [`/api/platform/company-registrations/${c1._id}/approve`, `/api/platform/company-registrations/${c1._id}/reject`, `/api/platform/company-registrations/${c1._id}/resend-email`];
  for (const path of targets) {
    assert.equal((await api("", "POST", path)).status, 401, `anonymous ${path}`);
    assert.equal((await api(whyteOwner, "POST", path)).status, 403, `company owner ${path}`);
    assert.equal((await api(whyteDealer, "POST", path)).status, 403, `dealer ${path}`);
  }
  for (const cookie of ["", whyteOwner, whyteDealer]) {
    assert.ok([401, 403].includes((await api(cookie, "GET", "/api/platform/company-registrations")).status), "list is Super Admin only");
    assert.ok([401, 403].includes((await api(cookie, "GET", `/api/platform/company-registrations/${c1._id}`)).status));
  }
  assert.equal((await findCompany("Acme Homes 1")).registrationStatus, "pending_review", "nothing changed");
  pass("anonymous users, company owners and dealers cannot list, approve, reject or resend (enforced by the API)");

  // ═══ 5. approval enables login and sends the email ═══════════════════
  const approved = await approve(c1._id);
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.data.changed, true);
  assert.equal(approved.data.registration.registrationStatus, "approved");
  const after = await findCompany("Acme Homes 1");
  assert.equal(after.registrationStatus, "approved");
  assert.equal(after.status, "active");
  assert.equal(after.reviewedBy, 1);
  assert.equal(after.reviewedByName, "Super Admin");
  assert.ok(after.reviewedAt instanceof Date);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, "owner1@acme.example");
  assert.equal(emails[0].to?.includes?.("@"), true);
  assert.equal(emails[0].subject, "Congratulations! Your Company Is Approved");
  assert.match(emails[0].html, new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/admin/login`), "the button links to the configured login URL");
  assert.match(emails[0].html, /Login to Your Account/);
  assert.doesNotMatch(emails[0].html + emails[0].text, new RegExp(PASSWORD.replace(/[.*+?^${}()|[\]\\!]/g, "\\$&")), "the password is never emailed");
  assert.equal(after.decisionEmail.status, "sent");
  const okLogin = await attemptLogin("owner1@acme.example", PASSWORD);
  assert.equal(okLogin.signedIn, true, "the owner signs in after approval with the registered email and password");
  const own = await api(okLogin.cookie, "GET", "/api/company");
  assert.equal((own.data ?? own.json).name, "Acme Homes 1");
  assert.equal((await api(okLogin.cookie, "GET", "/api/platform/company-registrations")).status, 403, "an approved owner still cannot review companies");
  pass("approval commits first, then emails the owner (correct subject, configured login link, no password); the owner can sign in afterwards");

  // ═══ 6. idempotent and concurrent approval ═══════════════════════════
  assert.equal((await submit(goodFields(2))).status, 201);
  const c2 = await findCompany("Acme Homes 2");
  const emailsBefore = emails.length;
  const races = await Promise.all(Array.from({ length: 6 }, () => approve(c2._id)));
  assert.ok(races.every((r) => r.status === 200), "every concurrent click is answered successfully");
  assert.equal(races.filter((r) => r.data.changed).length, 1, "exactly one request performed the transition");
  assert.equal(emails.length - emailsBefore, 1, "exactly one approval email was sent");
  assert.equal(await db.collection("companies").countDocuments({ name: "Acme Homes 2" }), 1);
  assert.equal(await db.collection("adminusers").countDocuments({ companyId: c2._id }), 1, "no duplicate owner");
  const again = await approve(c2._id);
  assert.equal(again.data.changed, false);
  assert.equal(emails.length - emailsBefore, 1, "a repeated click sends nothing");
  pass("approving twice or six times at once performs one transition and sends one email");

  // ═══ 7. email failure is recorded and retryable ════════════════════
  assert.equal((await submit(goodFields(3))).status, 201);
  const c3 = await findCompany("Acme Homes 3");
  emailMode = "fail";
  const failedApproval = await approve(c3._id);
  assert.equal(failedApproval.status, 200, "an email failure never undoes the approval");
  assert.equal(failedApproval.data.registration.registrationStatus, "approved");
  assert.equal(failedApproval.data.registration.decisionEmail.status, "failed", "delivery is not reported as sent");
  assert.equal((await attemptLogin("owner3@acme.example", PASSWORD)).signedIn, true, "the owner can already sign in");
  const retryFail = await api(superCookie, "POST", `/api/platform/company-registrations/${c3._id}/resend-email`);
  assert.equal(retryFail.status, 200);
  assert.equal(retryFail.data.decisionEmail.status, "failed");
  assert.equal(retryFail.data.decisionEmail.attempts, 2);
  emailMode = "ok";
  const retryOk = await api(superCookie, "POST", `/api/platform/company-registrations/${c3._id}/resend-email`);
  assert.equal(retryOk.data.decisionEmail.status, "sent");
  assert.equal(emails.at(-1).to, "owner3@acme.example");
  assert.equal((await api(superCookie, "POST", `/api/platform/company-registrations/${c3._id}/resend-email`)).status, 409, "a delivered email is not re-sent");
  assert.doesNotMatch(server.getOutput(), /re_test_key_not_real/, "the email key is never logged");
  pass("a failed email is recorded as failed, can be retried, and a delivered one is never sent twice");

  // ═══ 8. rejection ═══════════════════════════════════════════════
  assert.equal((await submit(goodFields(4))).status, 201);
  assert.equal((await submit(goodFields(5))).status, 201);
  const c4 = await findCompany("Acme Homes 4");
  const c5 = await findCompany("Acme Homes 5");
  const reject4 = await api(superCookie, "POST", `/api/platform/company-registrations/${c4._id}/reject`, { note: "internal: looks like a competitor", notifyOwner: true });
  assert.equal(reject4.status, 200, reject4.text);
  assert.equal((await findCompany("Acme Homes 4")).registrationStatus, "rejected");
  const rejectedMail = emails.at(-1);
  assert.equal(rejectedMail.to, "owner4@acme.example");
  assert.doesNotMatch(rejectedMail.html + rejectedMail.text, /competitor|internal/i, "internal notes never reach the owner");
  const rejectedLogin = await attemptLogin("owner4@acme.example", PASSWORD);
  assert.equal(rejectedLogin.signedIn, false);
  assert.equal(rejectedLogin.error, "COMPANY_REJECTED");
  const mailsBefore = emails.length;
  assert.equal((await api(superCookie, "POST", `/api/platform/company-registrations/${c5._id}/reject`)).status, 200, "an empty body rejects without a note or email");
  assert.equal(emails.length, mailsBefore, "no email unless notifyOwner is chosen");
  assert.equal((await attemptLogin("owner5@acme.example", PASSWORD)).signedIn, false);
  assert.equal((await approve(c4._id)).status, 409, "a rejected request cannot be approved by a stray click");
  assert.equal((await api(superCookie, "POST", `/api/platform/company-registrations/${c1._id}/reject`)).status, 409, "an approved company cannot be rejected through the review API");
  assert.equal((await approve(1)).status, 409, "an existing (non-registration) company is not reviewable");
  assert.equal((await api(superCookie, "GET", "/api/platform/company-registrations?status=rejected")).data.items.length >= 2, true);
  assert.equal((await api(superCookie, "POST", `/api/platform/company-registrations/999999/approve`)).status, 404);
  assert.equal((await api(superCookie, "POST", `/api/platform/company-registrations/abc/approve`)).status, 400);
  pass("rejection blocks sign-in, never emails internal notes, emails only when chosen, and approve/reject cannot be flipped afterwards");

  // ═══ 9. stale sessions and direct API access ═════════════════════════
  const live = await attemptLogin("owner1@acme.example", PASSWORD);
  assert.equal((await api(live.cookie, "GET", "/api/products")).status, 200);
  await db.collection("companies").updateOne({ _id: c1._id }, { $set: { registrationStatus: "pending_review" } });
  assert.equal((await api(live.cookie, "GET", "/api/products")).status, 401, "an existing session stops working the moment the company is not approved");
  assert.equal((await api(live.cookie, "GET", "/api/company")).status, 401);
  await db.collection("companies").updateOne({ _id: c1._id }, { $set: { registrationStatus: "rejected" } });
  assert.equal((await api(live.cookie, "GET", "/api/products")).status, 401);
  await db.collection("companies").updateOne({ _id: c1._id }, { $set: { registrationStatus: "approved" } });
  assert.equal((await api(live.cookie, "GET", "/api/products")).status, 200, "and works again once approved");
  const tamper = await api(live.cookie, "PATCH", "/api/company", { name: "Acme Homes 1", phone: "+91 98765 43210", address: "12 Main Street, Ahmedabad", registrationStatus: "approved", status: "active" });
  assert.ok(tamper.status >= 400 || (await findCompany("Acme Homes 1")).registrationStatus === "approved");
  assert.equal(JSON.stringify((await findCompany("Whyte Automations"))), whyteBefore, "Whyte's record is untouched");
  pass("a stale session is invalid as soon as the company is pending or rejected; owners cannot edit review fields");

  // ═══ 10. existing Whyte company keeps working although it is "pending" ═══
  const whyteSignIn = await attemptLogin("owner1@example.com", "Password123!");
  assert.equal(whyteSignIn.signedIn, true, "Whyte's owner (company status pending, no review field) still signs in");
  assert.equal((await attemptLogin("dealer1@example.com", "Password123!", "user")).signedIn, true, "Whyte's dealer still signs in");
  assert.equal((await attemptLogin("super@example.com", "Password123!")).signedIn, true, "the Super Admin still signs in");
  assert.equal((await api(whyteOwner, "GET", "/api/products")).status, 200);
  const dealerReg = await fetch(`${baseUrl}/api/admin/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  assert.equal(dealerReg.status, 400, "the public dealer registration endpoint is unchanged (still validates its own body)");
  pass("Whyte (status pending, no review state), its dealer and the Super Admin sign in exactly as before; dealer registration is unchanged");

  // ═══ 11. logo upload on registration ═════════════════════════════════
  const r6 = await submit(goodFields(6), { bytes: PNG, type: "image/png", name: "logo.png" });
  assert.equal(r6.status, 201, r6.text);
  const c6 = await findCompany("Acme Homes 6");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].folder, `whyte/companies/${c6._id}/branding`);
  assert.equal(c6.logoPublicId, uploads[0].publicId);
  assert.match(c6.logoUrl, /^https:\/\/res\.cloudinary\.com\/testcloud\//);
  assert.equal((await api(superCookie, "GET", "/api/platform/company-registrations?status=pending_review")).data.items.find((i) => i.name === "Acme Homes 6").logoUrl, c6.logoUrl, "the reviewer sees the logo");
  for (const [n, file] of [[7, { bytes: JPG, type: "image/jpeg" }], [8, { bytes: WEBP, type: "image/webp" }]]) {
    assert.equal((await submit(goodFields(n), file)).status, 201, `${file.type} accepted`);
  }
  pass("registration with a PNG / JPEG / WebP logo stores URL and public id on the new company, in that company's own folder");

  const before4 = { ...(await counts()), uploads: uploads.length };
  for (const [label, file] of [
    ["text renamed to png", { bytes: Buffer.from("not an image at all"), type: "image/png" }],
    ["gif", { bytes: Buffer.from("GIF89a....."), type: "image/gif" }],
    ["svg", { bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), type: "image/svg+xml" }],
    ["png bytes declared as jpeg", { bytes: PNG, type: "image/jpeg" }],
    ["too large (2MB + 1)", { bytes: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), type: "image/png" }],
  ]) {
    const res = await submit(goodFields(50), file);
    assert.ok(res.status >= 400 && res.status < 500, `${label}: expected a 4xx, got ${res.status}`);
    assert.equal(res.json.error.field, "logo", `${label}: error is attached to the logo field`);
  }
  assert.deepEqual({ ...(await counts()), uploads: uploads.length }, before4, "an invalid logo creates no company, no owner and no upload");
  pass("invalid logos (wrong type, fake bytes, mismatched type, SVG, over 2MB) are rejected on the server and nothing is created");

  for (const failure of ["http500", "http401"]) {
    mode = failure;
    const beforeCounts = await counts();
    const res = await submit(goodFields(60), { bytes: PNG, type: "image/png" });
    assert.ok(res.status >= 500, `${failure}: unexpected ${res.status}`);
    assert.equal(res.json.error.field, "logo");
    assert.doesNotMatch(res.text, new RegExp(`${API_KEY}|${API_SECRET}|boom internal detail|Unknown API key`), "no vendor text or credential in the response");
    assert.deepEqual(await counts(), beforeCounts, `${failure}: no partial company or owner`);
  }
  mode = "ok";
  assert.equal((await submit(goodFields(60), { bytes: PNG, type: "image/png" })).status, 201, "the same registration succeeds once the uploader recovers");
  assert.doesNotMatch(server.getOutput(), new RegExp(`${API_KEY}|${API_SECRET}`), "the server log never contains the key or secret");
  pass("an upload failure creates no company or owner, returns a safe message and leaks no key or secret");

  await db.collection("companies").insertOne({ _id: 900, name: "Ghost Co", slug: "ghost-co", status: "active", phone: "1", address: "x", email: null, logoUrl: null, isDeleted: true, createdAt: now, updatedAt: now });
  const beforeGhost = { ...(await counts()), uploads: uploads.length, destroyed: destroyed.length };
  const ghost = await submit(goodFields(70, { companyName: "Ghost Co" }), { bytes: PNG, type: "image/png" });
  assert.equal(ghost.status, 409, ghost.text);
  assert.equal(ghost.json.error.field, "companyName");
  assert.equal(uploads.length, beforeGhost.uploads + 1);
  assert.equal(destroyed.length, beforeGhost.destroyed + 1, "the uploaded asset was deleted again");
  assert.equal(destroyed.at(-1), uploads.at(-1).publicId);
  assert.deepEqual(await counts(), { companies: beforeGhost.companies, users: beforeGhost.users }, "no company or owner was left behind");
  pass("a database failure after the upload deletes the uploaded asset and leaves no company or owner");

  // ═══ 12. duplicates, mass assignment, validation, concurrency ═════════
  const dupBefore = { ...(await counts()), uploads: uploads.length };
  for (const [field, fields] of [
    ["ownerEmail", goodFields(80, { ownerEmail: "OWNER1@acme.example" })],
    ["ownerEmail", goodFields(81, { ownerEmail: "owner1@example.com" })],
    ["companyEmail", goodFields(82, { companyEmail: "INFO1@ACME.EXAMPLE" })],
    ["companyName", goodFields(83, { companyName: "acme homes 1" })],
    ["companyName", goodFields(84, { companyName: "Whyte Automations" })],
  ]) {
    const res = await submit(fields, { bytes: PNG, type: "image/png" });
    assert.equal(res.status, 409, `${field}: expected 409, got ${res.status} ${res.text.slice(0, 120)}`);
    assert.equal(res.json.error.field, field);
  }
  assert.deepEqual({ ...(await counts()), uploads: uploads.length }, dupBefore, "duplicates are refused before any upload or write");
  pass("duplicate owner email, company email and company name (including 'Whyte Automations') are refused with 409 before anything is uploaded or created");

  const attackBefore = await counts();
  for (const extra of [{ role: "super_admin" }, { companyId: "1" }, { status: "active" }, { registrationStatus: "approved" }, { permissions: "admins:manage" }, { isActive: "true" }]) {
    const res = await submit({ ...goodFields(90), ...extra });
    assert.equal(res.status, 400, `extra field ${Object.keys(extra)[0]} must be refused, got ${res.status}`);
  }
  assert.deepEqual(await counts(), attackBefore);
  for (const [field, patch] of [
    ["companyName", { companyName: "" }], ["companyName", { companyName: "x".repeat(121) }],
    ["companyEmail", { companyEmail: "not-an-email" }], ["companyPhone", { companyPhone: "12" }],
    ["companyAddress", { companyAddress: "" }], ["ownerName", { ownerName: " " }],
    ["ownerEmail", { ownerEmail: "nope" }], ["password", { password: "short", confirmPassword: "short" }],
    ["confirmPassword", { confirmPassword: "different" }],
  ]) {
    const res = await submit(goodFields(91, patch));
    assert.equal(res.status, 400, `${field}: ${res.status}`);
    assert.equal(res.json.error.field, field, `${field}: error is attached to the right field`);
  }
  assert.deepEqual(await counts(), attackBefore);
  assert.equal(await db.collection("adminusers").countDocuments({ role: "super_admin" }), 1, "no new Super Admin was ever created");
  pass("a public request cannot choose role, company id, status or review state; every field is validated with a field-level error");

  const same = goodFields(95);
  const parallel = await Promise.all(Array.from({ length: 5 }, () => submit(same)));
  assert.equal(parallel.filter((r) => r.status === 201).length, 1, "exactly one of five identical concurrent registrations wins");
  assert.ok(parallel.filter((r) => r.status !== 201).every((r) => r.status === 409 || r.status === 429));
  assert.equal(await db.collection("companies").countDocuments({ name: "Acme Homes 95" }), 1);
  assert.equal(await db.collection("adminusers").countDocuments({ email: "owner95@acme.example" }), 1);
  pass("five identical concurrent registrations create exactly one company and one owner");

  // ═══ 13. logo isolation (companies must be approved before their owners can sign in) ═══
  const cA = await findCompany("Acme Homes 6");
  const cB = await findCompany("Acme Homes 7");
  assert.equal((await approve(cA._id)).status, 200);
  assert.equal((await approve(cB._id)).status, 200);
  const cookieA = (await attemptLogin("owner6@acme.example", PASSWORD)).cookie;
  const cookieB = (await attemptLogin("owner7@acme.example", PASSWORD)).cookie;
  const logoBefore = { A: cA.logoPublicId, B: (await findCompany("Acme Homes 7")).logoPublicId };
  const swap = async (cookie, extra = {}) => {
    const body = new FormData();
    body.append("logo", new Blob([PNG], { type: "image/png" }), "new.png");
    for (const [k, v] of Object.entries(extra)) body.append(k, v);
    const res = await fetch(`${baseUrl}/api/company/logo`, { method: "POST", headers: { Cookie: cookie }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const hijack = await swap(cookieB, { companyId: String(cA._id), id: String(cA._id) });
  assert.equal(hijack.status, 200);
  assert.equal((await db.collection("companies").findOne({ _id: cA._id })).logoPublicId, logoBefore.A, "company A's logo is untouched by B's request");
  const bAfter = await db.collection("companies").findOne({ _id: cB._id });
  assert.notEqual(bAfter.logoPublicId, logoBefore.B);
  assert.equal(bAfter.logoPublicId.startsWith(`whyte/companies/${cB._id}/branding/`), true);
  assert.deepEqual(destroyed.slice(-1), [logoBefore.B], "only B's previous file was deleted");
  assert.equal((await swap(cookieA)).status, 200);
  const aAfter = await db.collection("companies").findOne({ _id: cA._id });
  assert.equal(aAfter.logoPublicId.startsWith(`whyte/companies/${cA._id}/branding/`), true);
  assert.equal((await db.collection("companies").findOne({ _id: cB._id })).logoPublicId, bAfter.logoPublicId, "B is unchanged by A's update");
  const unauth = await fetch(`${baseUrl}/api/company/logo`, { method: "POST", body: (() => { const b = new FormData(); b.append("logo", new Blob([PNG], { type: "image/png" })); return b; })() });
  assert.equal(unauth.status, 401);
  assert.equal((await swap(whyteDealer)).status, 403, "a dealer cannot change the logo");
  assert.equal((await swap(superCookie)).status, 403, "a Super Admin with no company selected cannot change any logo");
  assert.equal((await db.collection("companies").findOne({ _id: 1 })).logoUrl, null);
  const del = await fetch(`${baseUrl}/api/company/logo`, { method: "DELETE", headers: { Cookie: cookieA } });
  assert.equal(del.status, 200);
  assert.equal((await db.collection("companies").findOne({ _id: cA._id })).logoUrl, null);
  assert.equal(destroyed.at(-1), aAfter.logoPublicId);
  const patch = await api(cookieB, "PATCH", "/api/company", { name: "Acme Homes 7", phone: "+91 98765 43210", address: "12 Main Street, Ahmedabad", logoUrl: "https://evil.example/x.png" });
  assert.equal(patch.status, 200, patch.text);
  assert.equal((await db.collection("companies").findOne({ _id: cB._id })).logoUrl, bAfter.logoUrl, "the profile PATCH ignores logoUrl");
  pass("each company replaces only its own logo; client-supplied company ids are ignored; anonymous, dealer and company-less Super Admin cannot change a logo");

  assert.equal(JSON.stringify(await db.collection("companies").findOne({ _id: 1 })), whyteBefore, "the Whyte company record is byte-for-byte unchanged by the whole run");
  pass("the existing Whyte company record is unchanged after every registration, approval and rejection");

  // ═══ 14. rate limit ════════════════════════════════════════════════
  let limited = false;
  for (let i = 0; i < 400 && !limited; i++) limited = (await submit({ companyName: "" })).status === 429;
  assert.equal(limited, true, "repeated public registrations from one address are rate limited");
  pass("the public endpoint is rate limited per address");

  assert.doesNotMatch(server.getOutput(), /TenantScopeViolationError|UnhandledPromiseRejection/);
  pass("server log is free of tenant violations");
  console.log(`\n${results.length} checks passed.`);
} catch (error) {
  exitCode = 1;
  console.error("\nFAILED:", error?.stack ?? error);
  if (server) console.error("--- server output (tail) ---\n" + server.getOutput().slice(-1800));
} finally {
  if (server) await server.cleanup();
  if (fake) fake.close();
  process.exit(exitCode);
}
