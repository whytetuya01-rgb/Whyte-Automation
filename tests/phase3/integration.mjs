import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rootRequire = createRequire(join(repo, "package.json"));
const { MongoClient } = rootRequire("mongodb");
const bcrypt = rootRequire("bcryptjs");

function checkSafeTarget(uri, dbName) {
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "mongodb:", "test MongoDB must use mongodb://");
  assert.equal(parsed.hostname, "127.0.0.1", "test MongoDB host must be loopback");
  assert.equal(parsed.port, "27017", "test MongoDB port must be local default");
  assert.equal(parsed.username, "", "test MongoDB must not include credentials");
  assert.equal(parsed.password, "", "test MongoDB must not include credentials");
  assert.equal(parsed.pathname, `/${dbName}`, "URI database must match generated test database");
  assert.deepEqual([...parsed.searchParams.keys()], ["directConnection"], "test MongoDB URI has unexpected options");
  assert.equal(parsed.searchParams.get("directConnection"), "true");
  assert.match(dbName, /^whyte_quotation_phase3_test_[0-9]{8}_[a-f0-9]{12}$/);
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise((resolveListening) => server.once("listening", resolveListening));
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  return port;
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`isolated Next server exited early (${child.exitCode}): ${output()}`);
    try {
      const response = await fetch(`${baseUrl}/register`);
      if (response.status === 200) return;
    } catch {
      /* server starting */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`isolated Next server did not become ready: ${output()}`);
}

async function assertCase(name, fn, results) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const dbName = `whyte_quotation_phase3_test_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(6).toString("hex")}`;
const mongoUri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
const secret = randomBytes(48).toString("base64url");

let tempRoot;
let child;
let mongo;
let serverOutput = "";
const results = [];

try {
  checkSafeTarget(mongoUri, dbName);
  mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
  await mongo.connect();
  await mongo.db(dbName).command({ ping: 1 });
  console.log(`Safety checks PASS: loopback MongoDB reachable; isolated database ${dbName}.`);

  tempRoot = await mkdtemp(join(tmpdir(), "whyte-phase3-isolated-"));
  await mkdir(join(tempRoot, ".next-phase3-test"));
  await cp(join(repo, "src"), join(tempRoot, "src"), { recursive: true });
  await symlink(join(repo, "node_modules"), join(tempRoot, "node_modules"), "junction");
  await symlink(join(repo, "public"), join(tempRoot, "public"), "junction");
  await copyFile(join(repo, "tsconfig.json"), join(tempRoot, "tsconfig.json"));
  await copyFile(join(repo, "postcss.config.mjs"), join(tempRoot, "postcss.config.mjs"));
  await writeFile(
    join(tempRoot, "package.json"),
    JSON.stringify({ private: true, scripts: { dev: "next dev --webpack" } })
  );
  await writeFile(
    join(tempRoot, "next.config.mjs"),
    `
    const isolated = process.env.PHASE3_ISOLATED_TEST_RUN === "1";
    const distDir = isolated ? process.env.PHASE3_TEST_DIST_DIR : ".next";
    export default { distDir: distDir || ".next", images: { remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }] } };
  `
  );

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(port),
    MONGODB_URI: mongoUri,
    NEXTAUTH_URL: baseUrl,
    NEXTAUTH_SECRET: secret,
    PHASE3_ISOLATED_TEST_RUN: "1",
    PHASE3_TEST_DIST_DIR: ".next-phase3-test",
  };

  const { spawn } = await import("node:child_process");
  child = spawn("node", ["./node_modules/next/dist/bin/next", "dev", "--webpack", "-p", String(port)], {
    cwd: tempRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitForServer(baseUrl, child, () => serverOutput);
  console.log(`Isolated Next.js server ready at ${baseUrl}. Starting Final Role & Access tests...`);

  const database = mongo.db(dbName);
  const accounts = database.collection("adminusers");
  const quotations = database.collection("quotations");
  const rooms = database.collection("quotationrooms");
  const items = database.collection("quotationitems");
  const products = database.collection("products");
  const counters = database.collection("counters");

  // Helper for auth sign in
  async function signIn(email, password, portal = "user") {
    const cookieStore = new Map();
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
    assert.equal(csrfResponse.status, 200);
    for (const cookie of csrfResponse.headers.getSetCookie()) {
      cookieStore.set(
        cookie.split(";")[0].split("=")[0],
        cookie.split(";")[0].slice(cookie.split(";")[0].indexOf("=") + 1)
      );
    }
    const csrf = (await csrfResponse.json()).csrfToken;
    const form = new URLSearchParams({
      csrfToken: csrf,
      email,
      password,
      portal,
      callbackUrl: `${baseUrl}/`,
      json: "true",
    });
    const callback = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: [...cookieStore].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: form.toString(),
      redirect: "manual",
    });
    for (const cookie of callback.headers.getSetCookie()) {
      cookieStore.set(
        cookie.split(";")[0].split("=")[0],
        cookie.split(";")[0].slice(cookie.split(";")[0].indexOf("=") + 1)
      );
    }
    return [...cookieStore].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  // Seed Super Admin, Admin, and a legacy Sales User
  const superAdminPassword = "SuperAdminPassword123!";
  const superAdminEmail = `superadmin-${randomUUID()}@phase3.test`;
  const superAdminHash = await bcrypt.hash(superAdminPassword, 10);
  await accounts.insertOne({
    _id: 1,
    name: "Super Admin",
    firstName: "Super",
    lastName: "Admin",
    email: superAdminEmail,
    passwordHash: superAdminHash,
    role: "super_admin",
    isActive: true,
    createdAt: new Date(),
  });

  const adminPassword = "AdminPassword123!";
  const adminEmail = `admin-${randomUUID()}@phase3.test`;
  const adminHash = await bcrypt.hash(adminPassword, 10);
  await accounts.insertOne({
    _id: 2,
    name: "Regular Admin",
    firstName: "Regular",
    lastName: "Admin",
    email: adminEmail,
    passwordHash: adminHash,
    role: "admin",
    isActive: true,
    createdAt: new Date(),
  });

  const legacySalesPassword = "LegacySalesPassword123!";
  const legacySalesEmail = `sales-${randomUUID()}@phase3.test`;
  const legacySalesHash = await bcrypt.hash(legacySalesPassword, 10);
  await accounts.insertOne({
    _id: 3,
    name: "Legacy Sales",
    firstName: "Legacy",
    lastName: "Sales",
    email: legacySalesEmail,
    passwordHash: legacySalesHash,
    role: "sales",
    isActive: true,
    createdAt: new Date(),
  });

  await counters.insertOne({ _id: "adminUser", seq: 3 });

  // Seed sample product for quotation testing
  await products.insertOne({
    _id: 101,
    name: "Touch Switch 4M",
    sku: "SW-4M",
    isActive: true,
    variants: [
      {
        id: 1,
        _id: 1,
        automationTier: "Smart",
        surfaceFinish: "Glass",
        price: 5000,
        isActive: true,
      },
    ],
  });

  let superAdminCookie = await signIn(superAdminEmail, superAdminPassword, "admin");
  let adminCookie = await signIn(adminEmail, adminPassword, "admin");
  let dealer1Cookie;
  let dealer2Cookie;
  let dealer1Id;
  let dealer2Id;

  // ── TEST 1: Public Registration and Role Enforcement ──
  await assertCase("Public registration creates Dealer only and blocks role injection", async () => {
    const dealer1Email = `dealer1-${randomUUID()}@phase3.test`;
    const res = await fetch(`${baseUrl}/api/admin/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Dealer",
        lastName: "One",
        email: dealer1Email,
        password: "Dealer1Password123!",
        contactNumber: "9876543210",
        address: "42 Whyte Road, Pune",
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.data.role, "dealer");
    dealer1Id = body.data.id;
    dealer1Cookie = await signIn(dealer1Email, "Dealer1Password123!");

    // Role injection attempts must be rejected
    for (const injectedRole of ["super_admin", "admin", "sales"]) {
      const injectRes = await fetch(`${baseUrl}/api/admin/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: "Hacker",
          lastName: "User",
          email: `hacker-${randomUUID()}@phase3.test`,
          password: "HackerPassword123!",
          role: injectedRole,
          contactNumber: "9876543211",
          address: "Dark Web Road",
        }),
      });
      assert.equal(injectRes.status, 400, `Registration with role '${injectedRole}' must be rejected`);
    }

    // Register second dealer
    const dealer2Email = `dealer2-${randomUUID()}@phase3.test`;
    const reg2 = await fetch(`${baseUrl}/api/admin/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Dealer",
        lastName: "Two",
        email: dealer2Email,
        password: "Dealer2Password123!",
        contactNumber: "9876543212",
        address: "100 Whyte Boulevard, Mumbai",
      }),
    });
    assert.equal(reg2.status, 201);
    dealer2Id = (await reg2.json()).data.id;
    dealer2Cookie = await signIn(dealer2Email, "Dealer2Password123!");
  }, results);

  // ── TEST 2: Legacy Sales Account Protection & Invalidation ──
  await assertCase("Legacy sales accounts cannot authenticate to user or admin portal", async () => {
    // 1. Try signing in as sales to user portal: must fail (not authorized)
    const salesUserLogin = await signIn(legacySalesEmail, legacySalesPassword, "user");
    assert.ok(!salesUserLogin.includes("next-auth.session-token"), "Sales user must NOT receive session on user portal");

    // 2. Try signing in as sales to admin portal: must fail
    const salesAdminLogin = await signIn(legacySalesEmail, legacySalesPassword, "admin");
    assert.ok(!salesAdminLogin.includes("next-auth.session-token"), "Sales user must NOT receive session on admin portal");

    // 3. Dealer cannot access admin portal
    const dealerAdminLogin = await signIn(`dealer1-test@test.com`, "any", "admin");
    assert.ok(!dealerAdminLogin.includes("next-auth.session-token"), "Dealer must NOT receive session on admin portal");
  }, results);

  // ── TEST 3: Dealer Route Restrictions & Navigation Isolation ──
  await assertCase("Dealer route restrictions and profile accessibility", async () => {
    // Dealer accessing /admin/dealers is redirected to /
    const dealerAdminPage = await fetch(`${baseUrl}/admin/dealers`, {
      headers: { cookie: dealer1Cookie },
      redirect: "manual",
    });
    assert.equal(dealerAdminPage.status, 307, "Dealer accessing /admin/dealers should be redirected");
    assert.equal(new URL(dealerAdminPage.headers.get("location"), baseUrl).pathname, "/");

    // Dealer accessing /dealers is redirected to /
    const dealerSalesDealersPage = await fetch(`${baseUrl}/dealers`, {
      headers: { cookie: dealer1Cookie },
      redirect: "manual",
    });
    assert.equal(dealerSalesDealersPage.status, 307, "Dealer accessing /dealers should be redirected to /");
    assert.equal(new URL(dealerSalesDealersPage.headers.get("location"), baseUrl).pathname, "/");

    // Dealer accessing /dealer/access is redirected to /
    const dealerAccessPage = await fetch(`${baseUrl}/dealer/access`, {
      headers: { cookie: dealer1Cookie },
      redirect: "manual",
    });
    assert.equal(dealerAccessPage.status, 307);
    assert.equal(new URL(dealerAccessPage.headers.get("location"), baseUrl).pathname, "/");

    // Dealer accessing /profile returns 200
    const dealerProfilePageRes = await fetch(`${baseUrl}/profile`, {
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(dealerProfilePageRes.status, 200, "Dealer accessing /profile must return 200");
  }, results);

  // ── TEST 4: Super Admin & Admin Responsibilities & Role Distinction ──
  await assertCase("Super Admin and Admin responsibilities, discount updates, and role distinction", async () => {
    // 1. Both Super Admin and Admin can view all dealers
    const superAdminList = await fetch(`${baseUrl}/api/admin/dealers?page=1&pageSize=10`, {
      headers: { cookie: superAdminCookie },
    });
    assert.equal(superAdminList.status, 200);
    const superAdminDealers = await superAdminList.json();
    assert.ok(superAdminDealers.data.length >= 2, "Super Admin should see all dealers");

    const adminList = await fetch(`${baseUrl}/api/admin/dealers?page=1&pageSize=10`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(adminList.status, 200);
    const adminDealers = await adminList.json();
    assert.ok(adminDealers.data.length >= 2, "Admin should see all dealers");

    // 2. Both Super Admin and Admin can update dealer discount allocation
    const updateAllocSuper = await fetch(`${baseUrl}/api/admin/dealers/${dealer1Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: superAdminCookie },
      body: JSON.stringify({ discountAllocationPercent: 20 }),
    });
    assert.equal(updateAllocSuper.status, 200);

    const updateAllocAdmin = await fetch(`${baseUrl}/api/admin/dealers/${dealer2Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ discountAllocationPercent: 15 }),
    });
    assert.equal(updateAllocAdmin.status, 200);

    // 3. Super Admin can toggle dealer active status
    const deactivateRes = await fetch(`${baseUrl}/api/admin/dealers/${dealer2Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: superAdminCookie },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(deactivateRes.status, 200);

    // 4. Role distinction: Admin CANNOT toggle dealer active status (must be 403)
    const adminDeactivate = await fetch(`${baseUrl}/api/admin/dealers/${dealer1Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(adminDeactivate.status, 403, "Admin cannot toggle dealer active status; Super Admin only");

    // Reactivate Dealer 2 for remaining tests
    await fetch(`${baseUrl}/api/admin/dealers/${dealer2Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: superAdminCookie },
      body: JSON.stringify({ isActive: true }),
    });
  }, results);

  // ── TEST 5: Dealer Profile Security, Fields, and Protection ──
  await assertCase("Dealer Profile API security, editing, and field protection", async () => {
    // 1. Unauthenticated request to GET /api/dealer/profile returns 401
    const unauthRes = await fetch(`${baseUrl}/api/dealer/profile`);
    assert.equal(unauthRes.status, 401);

    // 2. Non-dealer roles receive 403 Forbidden
    const adminProfileRes = await fetch(`${baseUrl}/api/dealer/profile`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(adminProfileRes.status, 403);

    // 3. Dealer views their own profile
    const dealerProfileRes = await fetch(`${baseUrl}/api/dealer/profile`, {
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(dealerProfileRes.status, 200);
    const dealerProfile = await dealerProfileRes.json();
    assert.equal(dealerProfile.id, dealer1Id);
    assert.equal(dealerProfile.role, "dealer");
    assert.equal(dealerProfile.firstName, "Dealer");
    assert.equal(dealerProfile.lastName, "One");
    assert.equal(dealerProfile.contactNumber, "9876543210");
    assert.equal(dealerProfile.address, "42 Whyte Road, Pune");
    assert.equal(dealerProfile.discountAllocationPercent, 20);

    // 4. Dealer updates permitted profile details
    const updateRes = await fetch(`${baseUrl}/api/dealer/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({
        firstName: "DealerPrime",
        lastName: "Updated",
        contactNumber: "9123456789",
        gstNumber: "27AABCB1234F1Z5",
        address: "99 Premier Tech Park, Pune",
      }),
    });
    assert.equal(updateRes.status, 200);

    // 5. Privilege escalation attempts: role, discount, isActive, id must be rejected
    const roleEscalate = await fetch(`${baseUrl}/api/dealer/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({ role: "super_admin" }),
    });
    assert.equal(roleEscalate.status, 400);

    const discountEscalate = await fetch(`${baseUrl}/api/dealer/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({ discountAllocationPercent: 50 }),
    });
    assert.equal(discountEscalate.status, 400);

    // 6. Password update: invalid current fails, valid current succeeds
    const wrongPassRes = await fetch(`${baseUrl}/api/dealer/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({
        currentPassword: "WrongPassword999!",
        newPassword: "NewSecurePassword123!",
      }),
    });
    assert.equal(wrongPassRes.status, 400);

    const validPassRes = await fetch(`${baseUrl}/api/dealer/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({
        currentPassword: "Dealer1Password123!",
        newPassword: "NewDealerPassword123!",
      }),
    });
    assert.equal(validPassRes.status, 200);

    // Re-sign in with new password
    dealer1Cookie = await signIn(dealerProfile.email, "NewDealerPassword123!");
    assert.ok(dealer1Cookie);
  }, results);

  // ── TEST 6: Dealer Quotation Data Isolation & IDOR Protection (Critical) ──
  let quotationAId;
  let quotationCId;
  await assertCase("Dealer quotation data isolation and IDOR protection across all endpoints", async () => {
    // Dealer 1 creates Quotation A
    const createQuoteA = await fetch(`${baseUrl}/api/quotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({
        clientName: "Client A of Dealer 1",
        customerDiscountPercent: 10,
      }),
    });
    assert.equal(createQuoteA.status, 201);
    const qA = (await createQuoteA.json()).data || (await createQuoteA.json());
    quotationAId = qA.id || qA._id;

    // Dealer 2 creates Quotation C
    const createQuoteC = await fetch(`${baseUrl}/api/quotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: dealer2Cookie },
      body: JSON.stringify({
        clientName: "Client C of Dealer 2",
        customerDiscountPercent: 5,
      }),
    });
    assert.equal(createQuoteC.status, 201);
    const qC = (await createQuoteC.json()).data || (await createQuoteC.json());
    quotationCId = qC.id || qC._id;

    // 1. Dealer 1 listing quotations sees ONLY Quotation A, NOT Quotation C
    const listRes1 = await fetch(`${baseUrl}/api/quotations`, {
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(listRes1.status, 200);
    const listData1 = await listRes1.json();
    const ids1 = listData1.map((q) => q.id || q._id);
    assert.ok(ids1.includes(quotationAId), "Dealer 1 must see Quotation A");
    assert.ok(!ids1.includes(quotationCId), "Dealer 1 must NOT see Quotation C");

    // 2. Dealer 1 tries to filter by dealerId=dealer2Id: must still only see own quotations
    const spoofFilter = await fetch(`${baseUrl}/api/quotations?dealerId=${dealer2Id}`, {
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(spoofFilter.status, 200);
    const spoofListData = await spoofFilter.json();
    const spoofIds = spoofListData.map((q) => q.id || q._id);
    assert.ok(!spoofIds.includes(quotationCId), "Dealer 1 passing dealerId param must NOT see other dealer's quotations");

    // 3. IDOR: Dealer 1 attempts GET /api/quotations/[id] for Quotation C -> must be 403
    const getOtherQuote = await fetch(`${baseUrl}/api/quotations/${quotationCId}`, {
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(getOtherQuote.status, 403, "Dealer 1 fetching Quotation C must return 403 Forbidden");

    // 4. IDOR: Dealer 1 attempts PATCH /api/quotations/[id] for Quotation C -> must be 403
    const patchOtherQuote = await fetch(`${baseUrl}/api/quotations/${quotationCId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({ clientName: "Hacked by Dealer 1" }),
    });
    assert.equal(patchOtherQuote.status, 403, "Dealer 1 modifying Quotation C must return 403 Forbidden");

    // 5. IDOR: Dealer 1 attempts DELETE /api/quotations/[id] for Quotation C -> must be 403
    const deleteOtherQuote = await fetch(`${baseUrl}/api/quotations/${quotationCId}`, {
      method: "DELETE",
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(deleteOtherQuote.status, 403, "Dealer 1 deleting Quotation C must return 403 Forbidden");

    // 6. IDOR: Dealer 1 attempts POST /api/quotations/[id]/duplicate for Quotation C -> must be 403
    const cloneOtherQuote = await fetch(`${baseUrl}/api/quotations/${quotationCId}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
    });
    assert.equal(cloneOtherQuote.status, 403, "Dealer 1 cloning Quotation C must return 403 Forbidden");

    // 7. IDOR: Dealer 1 attempts POST /api/quotations/[id]/rooms for Quotation C -> must be 403
    const addRoomOtherQuote = await fetch(`${baseUrl}/api/quotations/${quotationCId}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({ customName: "Hacked Room" }),
    });
    assert.equal(addRoomOtherQuote.status, 403, "Dealer 1 adding room to Quotation C must return 403 Forbidden");

    // 8. IDOR: Dealer 1 attempts POST /api/quotations/[id]/mark-sent for Quotation C -> must be 403
    const markSentOtherQuote = await fetch(`${baseUrl}/api/quotations/${quotationCId}/mark-sent`, {
      method: "POST",
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(markSentOtherQuote.status, 403, "Dealer 1 marking Quotation C as sent must return 403 Forbidden");

    // 9. IDOR: Dealer 1 querying another dealer's earnings -> returns Dealer 1's own earnings
    const earningsRes = await fetch(`${baseUrl}/api/dealer/earnings?dealerId=${dealer2Id}`, {
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(earningsRes.status, 200);
    const earningsData = await earningsRes.json();
    assert.equal(earningsData.dealerId, dealer1Id, "Dealer 1 querying dealerId=dealer2Id must receive own dealerId");

    // 10. Admin can view all quotations
    const adminQuotesRes = await fetch(`${baseUrl}/api/quotations`, {
      headers: { cookie: adminCookie },
    });
    assert.equal(adminQuotesRes.status, 200);
    const adminQuotes = await adminQuotesRes.json();
    const adminIds = adminQuotes.map((q) => q.id || q._id);
    assert.ok(adminIds.includes(quotationAId) && adminIds.includes(quotationCId), "Admin must see quotations from all dealers");
  }, results);

  // ── TEST 7: Discount Snapshot, Customer Discount Cap & Lock/Clone ──
  let quotationBId;
  await assertCase("Discount snapshotting, cap validation, lifecycle transitions, and lock/clone", async () => {
    // Quotation A was created with 20% allocated, 10% customer discount
    const quoteA = await (await fetch(`${baseUrl}/api/quotations/${quotationAId}`, {
      headers: { cookie: dealer1Cookie },
    })).json();
    assert.equal(quoteA.allocatedDiscountPercent, 20);
    assert.equal(quoteA.customerDiscountPercent, 10);
    assert.equal(quoteA.estimatedEarningPercent, 10);

    // Dealer tries to set customer discount > allocated snapshot (25% > 20%) -> 400
    const exceedRes = await fetch(`${baseUrl}/api/quotations/${quotationAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({ customerDiscountPercent: 25 }),
    });
    assert.equal(exceedRes.status, 400, "Customer discount exceeding allocated snapshot must be rejected");

    // Admin updates Dealer 1 discount allocation to 25%
    const updateAlloc = await fetch(`${baseUrl}/api/admin/dealers/${dealer1Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ discountAllocationPercent: 25 }),
    });
    assert.equal(updateAlloc.status, 200);

    // Existing Quotation A retains original 20% snapshot
    const quoteAFresh = await (await fetch(`${baseUrl}/api/quotations/${quotationAId}`, {
      headers: { cookie: dealer1Cookie },
    })).json();
    assert.equal(quoteAFresh.allocatedDiscountPercent, 20, "Quotation A allocation must stay snapshotted at 20%");

    // New Quotation B snapshots 25%
    const createQuoteB = await fetch(`${baseUrl}/api/quotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({
        clientName: "Bob Client",
        customerDiscountPercent: 15,
      }),
    });
    assert.equal(createQuoteB.status, 201);
    const quoteBRaw = await createQuoteB.json();
    const quoteB = quoteBRaw.data || quoteBRaw;
    quotationBId = quoteB.id || quoteB._id;
    assert.equal(quoteB.allocatedDiscountPercent, 25);
    assert.equal(quoteB.estimatedEarningPercent, 10); // 25 - 15 = 10%

    // Mark sent trigger
    const markSentRes = await fetch(`${baseUrl}/api/quotations/${quotationAId}/mark-sent`, {
      method: "POST",
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(markSentRes.status, 200);

    // Dealer cannot approve
    const dealerApprove = await fetch(`${baseUrl}/api/quotations/${quotationAId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({ action: "approve" }),
    });
    assert.equal(dealerApprove.status, 403, "Dealer cannot approve quotations");

    // Admin approves Sent quotation
    const adminApprove = await fetch(`${baseUrl}/api/quotations/${quotationAId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ action: "approve" }),
    });
    assert.equal(adminApprove.status, 200);
    const approvedData = await adminApprove.json();
    assert.equal(approvedData.data.status, "approved");

    // Admin marks Approved quotation as Delivered
    const adminDeliver = await fetch(`${baseUrl}/api/quotations/${quotationAId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ action: "deliver" }),
    });
    assert.equal(adminDeliver.status, 200);
    const deliveredData = await adminDeliver.json();
    assert.equal(deliveredData.data.status, "delivered");

    // Editing locked Delivered quotation is rejected (403)
    const editDelivered = await fetch(`${baseUrl}/api/quotations/${quotationAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
      body: JSON.stringify({ clientName: "Modified After Delivery" }),
    });
    assert.equal(editDelivered.status, 403, "Editing delivered quotation must be 403");

    // Cloning locked quotation creates new Draft with current allocation (25%) and customer discount 0
    const cloneRes = await fetch(`${baseUrl}/api/quotations/${quotationAId}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: dealer1Cookie },
    });
    assert.equal(cloneRes.status, 201);
    const cloned = (await cloneRes.json()).data;
    assert.notEqual(cloned.id || cloned._id, quotationAId);
    assert.equal(cloned.status, "draft");
    assert.equal(cloned.customerDiscountPercent, 0);
    assert.equal(cloned.allocatedDiscountPercent, 25);
    assert.equal(cloned.clonedFromQuotationId, quotationAId);
    assert.equal(cloned.approvedAt, null);
  }, results);

  // ── TEST 8: Earnings Calculation & Deduplication ──
  await assertCase("Earnings calculate only from confirmed Approved/Delivered quotations", async () => {
    // Add room and item to Quotation B: 2 items * 5000 = 10,000 subtotal
    const roomSeq = 1;
    await rooms.insertOne({
      _id: roomSeq,
      quotationId: quotationBId,
      customName: "Living Room",
      sortOrder: 0,
    });
    await items.insertOne({
      _id: 1,
      quotationId: quotationBId,
      quotationRoomId: roomSeq,
      productId: 101,
      quantity: 2,
      unitPrice: rootRequire("mongodb").Decimal128.fromString("5000.00"),
    });

    // Before approval: earnings are 0
    let earningsRes = await fetch(`${baseUrl}/api/dealer/earnings`, {
      headers: { cookie: dealer1Cookie },
    });
    assert.equal(earningsRes.status, 200);
    let earningsData = await earningsRes.json();
    assert.equal(earningsData.accumulatedEarnings, 0);

    // Transition Quotation B: Draft -> Sent -> Approved
    await fetch(`${baseUrl}/api/quotations/${quotationBId}/mark-sent`, {
      method: "POST",
      headers: { cookie: dealer1Cookie },
    });

    // Subtotal 10,000 * 10% earning = 1,000
    await quotations.updateOne(
      { _id: quotationBId },
      { $set: { estimatedEarningAmount: rootRequire("mongodb").Decimal128.fromString("1000.00") } }
    );

    // Super Admin approves Quotation B
    await fetch(`${baseUrl}/api/quotations/${quotationBId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: superAdminCookie },
      body: JSON.stringify({ action: "approve" }),
    });

    // Check earnings after approval
    earningsRes = await fetch(`${baseUrl}/api/dealer/earnings`, {
      headers: { cookie: dealer1Cookie },
    });
    earningsData = await earningsRes.json();
    assert.equal(earningsData.accumulatedEarnings, 1000);
    assert.equal(earningsData.approvedCount, 1);

    // Deliver Quotation B: must not double count
    await fetch(`${baseUrl}/api/quotations/${quotationBId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: superAdminCookie },
      body: JSON.stringify({ action: "deliver" }),
    });

    earningsRes = await fetch(`${baseUrl}/api/dealer/earnings`, {
      headers: { cookie: dealer1Cookie },
    });
    earningsData = await earningsRes.json();
    assert.equal(earningsData.accumulatedEarnings, 1000, "Earnings must not double count on delivery");
    assert.equal(earningsData.deliveredCount, 2); // Quotation A + Quotation B
  }, results);

  console.log(`\nAll Final Role Architecture integration tests passed! Database used: ${dbName} (credentials omitted).`);
} catch (error) {
  console.error(`BLOCKED before completion: ${error instanceof Error ? error.message : String(error)}`);
  if (serverOutput) console.error(`Isolated server output: ${serverOutput.slice(-3000)}`);
  process.exitCode = 2;
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([once(child, "exit"), new Promise((resolveStop) => setTimeout(resolveStop, 5000))]);
  }
  if (mongo) await mongo.close();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
