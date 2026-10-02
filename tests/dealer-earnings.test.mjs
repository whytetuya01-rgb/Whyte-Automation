/**
 * Automated Regression Test Suite: Dealer Earnings Dashboard
 * Validates financial calculations, summary metrics, customer discounts,
 * commission margins, lifecycle-based confirmed earnings, pagination,
 * and Dealer IDOR data isolation.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootRequire = createRequire(join(repo, "package.json"));
const { MongoClient, Decimal128 } = rootRequire("mongodb");
const bcrypt = rootRequire("bcryptjs");

function checkSafeTarget(uri, dbName) {
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "mongodb:", "test MongoDB must use mongodb://");
  assert.equal(parsed.hostname, "127.0.0.1", "test MongoDB host must be loopback");
  assert.equal(parsed.port, "27017", "test MongoDB port must be local default");
  assert.equal(parsed.pathname, `/${dbName}`, "URI database must match generated test database");
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
      const response = await fetch(`${baseUrl}/login`);
      if (response.status === 200) return;
    } catch {
      /* server starting */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`isolated Next server did not become ready: ${output()}`);
}

async function assertCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

const dbName = `whyte_quotation_earnings_test_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(6).toString("hex")}`;
const mongoUri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
const secret = randomBytes(48).toString("base64url");

let tempRoot;
let child;
let mongo;
let serverOutput = "";

try {
  checkSafeTarget(mongoUri, dbName);
  mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
  await mongo.connect();
  await mongo.db(dbName).command({ ping: 1 });
  console.log(`Safety checks PASS: loopback MongoDB reachable; isolated database ${dbName}.`);

  tempRoot = await mkdtemp(join(tmpdir(), "whyte-earnings-isolated-"));
  await mkdir(join(tempRoot, ".next-earnings-test"));
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
    PHASE3_TEST_DIST_DIR: ".next-earnings-test",
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
  console.log(`Isolated Next.js server ready at ${baseUrl}. Starting Earnings tests...\n`);

  const db = mongo.db(dbName);
  const now = new Date();
  const passwordHash = await bcrypt.hash("Password123!", 10);

  // Seed Users
  // Dealer A: id 10, discountAllocationPercent = 30%
  // Dealer B: id 20, discountAllocationPercent = 20%
  // Admin: id 30
  await db.collection("adminusers").insertMany([
    {
      _id: 10,
      email: "dealer_a@example.com",
      passwordHash,
      role: "dealer",
      name: "Dealer Alpha",
      firstName: "Dealer",
      lastName: "Alpha",
      phone: "+919876543210",
      isActive: true,
      discountAllocationPercent: 30,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 20,
      email: "dealer_b@example.com",
      passwordHash,
      role: "dealer",
      name: "Dealer Beta",
      firstName: "Dealer",
      lastName: "Beta",
      phone: "+919876543211",
      isActive: true,
      discountAllocationPercent: 20,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 30,
      email: "admin@example.com",
      passwordHash,
      role: "admin",
      name: "Admin Whyte",
      firstName: "Admin",
      lastName: "Whyte",
      phone: "+919876543212",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Seed Quotations for Dealer A:
  // Q1 (Draft): Subtotal 5,000, Customer Discount 10% (500), Net 4,500, Margin 20% (1,000), Confirmed 0
  // Q2 (Approved): Subtotal 10,000, Customer Discount 0% (0), Net 10,000, Margin 30% (3,000), Confirmed 3,000
  // Q3 (Delivered): Subtotal 2,000, Customer Discount 30% (600), Net 1,400, Margin 0% (0), Confirmed 0
  // Q4 (Rejected): Subtotal 8,000, Customer Discount 10% (800), Net 7,200, Margin 20% (1,600), Confirmed 0
  await db.collection("quotations").insertMany([
    {
      _id: "q-1",
      quotationNumber: "QT-2026-001",
      clientName: "Rohan Sharma",
      dealerId: 10,
      status: "draft",
      discountType: "percentage",
      discountValue: Decimal128.fromString("10.00"),
      allocatedDiscountPercent: 30,
      customerDiscountPercent: 10,
      estimatedEarningPercent: 20,
      estimatedEarningAmount: Decimal128.fromString("1000.00"),
      createdAt: new Date("2026-01-15T10:00:00Z"),
      updatedAt: now,
    },
    {
      _id: "q-2",
      quotationNumber: "QT-2026-002",
      clientName: "Priya Patel",
      dealerId: 10,
      status: "approved",
      discountType: "percentage",
      discountValue: Decimal128.fromString("0.00"),
      allocatedDiscountPercent: 30,
      customerDiscountPercent: 0,
      estimatedEarningPercent: 30,
      estimatedEarningAmount: Decimal128.fromString("3000.00"),
      createdAt: new Date("2026-01-20T10:00:00Z"),
      updatedAt: now,
    },
    {
      _id: "q-3",
      quotationNumber: "QT-2026-003",
      clientName: "Amit Verma",
      dealerId: 10,
      status: "delivered",
      discountType: "percentage",
      discountValue: Decimal128.fromString("30.00"),
      allocatedDiscountPercent: 30,
      customerDiscountPercent: 30,
      estimatedEarningPercent: 0,
      estimatedEarningAmount: Decimal128.fromString("0.00"),
      createdAt: new Date("2026-02-01T10:00:00Z"),
      updatedAt: now,
    },
    {
      _id: "q-4",
      quotationNumber: "QT-2026-004",
      clientName: "Kavita Rao",
      dealerId: 10,
      status: "rejected",
      discountType: "percentage",
      discountValue: Decimal128.fromString("10.00"),
      allocatedDiscountPercent: 30,
      customerDiscountPercent: 10,
      estimatedEarningPercent: 20,
      estimatedEarningAmount: Decimal128.fromString("1600.00"),
      createdAt: new Date("2026-02-10T10:00:00Z"),
      updatedAt: now,
    },
    // Seed Quotation for Dealer B (Approved, subtotal 50,000)
    {
      _id: "q-5",
      quotationNumber: "QT-2026-005",
      clientName: "Other Dealer Client",
      dealerId: 20,
      status: "approved",
      discountType: "percentage",
      discountValue: Decimal128.fromString("5.00"),
      allocatedDiscountPercent: 20,
      customerDiscountPercent: 5,
      estimatedEarningPercent: 15,
      estimatedEarningAmount: Decimal128.fromString("7500.00"),
      createdAt: new Date("2026-02-15T10:00:00Z"),
      updatedAt: now,
    },
  ]);

  // Seed Rooms
  await db.collection("quotationrooms").insertMany([
    { _id: 101, quotationId: "q-1", customName: "Living Room", sortOrder: 1 },
    { _id: 102, quotationId: "q-2", customName: "Master Bedroom", sortOrder: 1 },
    { _id: 103, quotationId: "q-3", customName: "Dining Room", sortOrder: 1 },
    { _id: 104, quotationId: "q-4", customName: "Home Office", sortOrder: 1 },
    { _id: 105, quotationId: "q-5", customName: "Lounge", sortOrder: 1 },
  ]);

  // Seed Items with multiple quantities and unit prices
  await db.collection("quotationitems").insertMany([
    // Q1: Item 1 (qty 2 * 1,000 = 2,000) + Item 2 (qty 1 * 3,000 = 3,000) -> Subtotal 5,000
    { _id: 1001, quotationRoomId: 101, productId: 1, quantity: 2, unitPrice: Decimal128.fromString("1000.00") },
    { _id: 1002, quotationRoomId: 101, productId: 2, quantity: 1, unitPrice: Decimal128.fromString("3000.00") },
    // Q2: Item 1 (qty 1 * 10,000 = 10,000) -> Subtotal 10,000
    { _id: 1003, quotationRoomId: 102, productId: 3, quantity: 1, unitPrice: Decimal128.fromString("10000.00") },
    // Q3: Item 1 (qty 4 * 500 = 2,000) -> Subtotal 2,000
    { _id: 1004, quotationRoomId: 103, productId: 4, quantity: 4, unitPrice: Decimal128.fromString("500.00") },
    // Q4: Item 1 (qty 8 * 1,000 = 8,000) -> Subtotal 8,000
    { _id: 1005, quotationRoomId: 104, productId: 5, quantity: 8, unitPrice: Decimal128.fromString("1000.00") },
    // Q5 (Dealer B): Item 1 (qty 5 * 10,000 = 50,000) -> Subtotal 50,000
    { _id: 1006, quotationRoomId: 105, productId: 6, quantity: 5, unitPrice: Decimal128.fromString("10000.00") },
  ]);

  // Login Helpers
  async function login(email, password, portal) {
    const cookieStore = new Map();
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
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

  const dealerACookie = await login("dealer_a@example.com", "Password123!", "user");
  const dealerBCookie = await login("dealer_b@example.com", "Password123!", "user");
  const adminCookie = await login("admin@example.com", "Password123!", "admin");

  // ── TEST 1: Summary Cards Accuracy ──
  await assertCase("Summary Cards: Calculates net quotation values, customer discounts, and confirmed earnings", async () => {
    const res = await fetch(`${baseUrl}/api/dealer/earnings`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    // Total Net Quotation Value: 4,500 (Q1) + 10,000 (Q2) + 1,400 (Q3) + 7,200 (Q4) = 23,100
    assert.equal(data.summary.totalQuotationValue, 23100, "Total Quotation Value must use customer-discounted net total (23,100)");

    // Total Customer Discount: 500 (Q1) + 0 (Q2) + 600 (Q3) + 800 (Q4) = 1,900
    assert.equal(data.summary.totalCustomerDiscount, 1900, "Total Customer Discount must equal 1,900");

    // Estimated Commission across non-rejected: Q1 (1,000) + Q2 (3,000) + Q3 (0) = 4,000
    assert.equal(data.summary.estimatedCommission, 4000, "Estimated Commission across eligible quotations must equal 4,000");

    // Confirmed Earnings: Approved Q2 (3,000) + Delivered Q3 (0) = 3,000
    assert.equal(data.summary.confirmedEarnings, 3000, "Confirmed Earnings must equal 3,000 from approved and delivered only");
    assert.equal(data.accumulatedEarnings, 3000, "Backward-compatible accumulatedEarnings matches confirmed earnings");

    // Quotation Counts: Total 4, Approved 1, Delivered 1, Draft 1, Rejected 1
    assert.equal(data.summary.totalQuotations, 4);
    assert.equal(data.summary.approvedCount, 1);
    assert.equal(data.summary.deliveredCount, 1);
    assert.equal(data.summary.draftCount, 1);
    assert.equal(data.summary.rejectedCount, 1);
  });

  // ── TEST 2: IDOR Protection & Dealer Data Isolation ──
  await assertCase("IDOR Protection: Dealer A passing dealerId=20 still receives Dealer A's earnings only", async () => {
    const res = await fetch(`${baseUrl}/api/dealer/earnings?dealerId=20`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    // Must be scoped to Dealer A (id 10), NEVER Dealer B (id 20)
    assert.equal(data.dealerId, 10, "Dealer identity must be derived strictly from session, ignoring spoofed dealerId");
    assert.equal(data.dealer.id, 10);
    assert.equal(data.summary.totalQuotations, 4, "Must not include Dealer B quotations");

    // None of Dealer B's quotations should be present
    const qIds = data.quotations.map((q) => q.id);
    assert.ok(!qIds.includes("q-5"), "Dealer A must not see Dealer B's quotation (q-5)");
  });

  // ── TEST 3: Detailed Quotation Calculations & Multi-Quantity Integrity ──
  await assertCase("Quotation Calculations: Multi-quantity subtotal, zero discount, and max discount handling", async () => {
    const res = await fetch(`${baseUrl}/api/dealer/earnings?pageSize=10`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const map = new Map(data.quotations.map((q) => [q.id, q]));

    // Q1: Multi-quantity items (qty 2 * 1,000 + qty 1 * 3,000 = 5,000)
    const q1 = map.get("q-1");
    assert.ok(q1);
    assert.equal(q1.subtotal, 5000);
    assert.equal(q1.customerDiscountPercent, 10);
    assert.equal(q1.customerDiscountAmount, 500);
    assert.equal(q1.netQuotationValue, 4500);
    assert.equal(q1.dealerCommissionPercent, 20); // 30 - 10 = 20%
    assert.equal(q1.estimatedCommissionAmount, 1000); // 5000 * 20% = 1000
    assert.equal(q1.confirmedCommissionAmount, 0, "Draft quotation confirmed commission is 0");
    assert.equal(q1.isConfirmed, false);

    // Q2: Zero discount (0%)
    const q2 = map.get("q-2");
    assert.ok(q2);
    assert.equal(q2.subtotal, 10000);
    assert.equal(q2.customerDiscountPercent, 0);
    assert.equal(q2.customerDiscountAmount, 0);
    assert.equal(q2.netQuotationValue, 10000);
    assert.equal(q2.dealerCommissionPercent, 30); // 30 - 0 = 30%
    assert.equal(q2.estimatedCommissionAmount, 3000);
    assert.equal(q2.confirmedCommissionAmount, 3000, "Approved quotation confirmed commission is 3000");
    assert.equal(q2.isConfirmed, true);

    // Q3: Maximum permitted discount (30%)
    const q3 = map.get("q-3");
    assert.ok(q3);
    assert.equal(q3.subtotal, 2000);
    assert.equal(q3.customerDiscountPercent, 30);
    assert.equal(q3.customerDiscountAmount, 600);
    assert.equal(q3.netQuotationValue, 1400);
    assert.equal(q3.dealerCommissionPercent, 0); // 30 - 30 = 0%
    assert.equal(q3.estimatedCommissionAmount, 0);
    assert.equal(q3.confirmedCommissionAmount, 0);
    assert.equal(q3.isConfirmed, true); // Status is delivered
  });

  // ── TEST 4: Filtering & Search ──
  await assertCase("Filtering & Search: Filter by status, search by customer, and date ranges", async () => {
    // 1. Search by customer "Priya"
    const searchRes = await fetch(`${baseUrl}/api/dealer/earnings?search=Priya`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.equal(searchData.quotations.length, 1);
    assert.equal(searchData.quotations[0].id, "q-2");

    // 2. Filter by status "approved"
    const statusRes = await fetch(`${baseUrl}/api/dealer/earnings?status=approved`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.quotations.length, 1);
    assert.equal(statusData.quotations[0].status, "approved");

    // 3. Filter by date: February 2026 quotations only (Q3, Q4)
    const dateRes = await fetch(`${baseUrl}/api/dealer/earnings?startDate=2026-02-01&endDate=2026-02-28`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(dateRes.status, 200);
    const dateData = await dateRes.json();
    assert.equal(dateData.quotations.length, 2);
    const dateIds = dateData.quotations.map((q) => q.id);
    assert.ok(dateIds.includes("q-3") && dateIds.includes("q-4"));
  });

  // ── TEST 5: Pagination ──
  await assertCase("Pagination: Pages 1 and 2 return expected slices and total counts", async () => {
    const page1Res = await fetch(`${baseUrl}/api/dealer/earnings?page=1&pageSize=2`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(page1Res.status, 200);
    const page1 = await page1Res.json();
    assert.equal(page1.quotations.length, 2);
    assert.equal(page1.pagination.total, 4);
    assert.equal(page1.pagination.totalPages, 2);
    assert.equal(page1.pagination.page, 1);

    const page2Res = await fetch(`${baseUrl}/api/dealer/earnings?page=2&pageSize=2`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(page2Res.status, 200);
    const page2 = await page2Res.json();
    assert.equal(page2.quotations.length, 2);
    assert.equal(page2.pagination.page, 2);

    // Page 1 and Page 2 must not have overlapping quotations
    const p1Ids = new Set(page1.quotations.map((q) => q.id));
    for (const q of page2.quotations) {
      assert.ok(!p1Ids.has(q.id), "Pagination slices must be disjoint");
    }
  });

  // ── TEST 6: Admin Inspection ──
  await assertCase("Admin Access: Admin can inspect Dealer A's earnings via ?dealerId=10", async () => {
    const res = await fetch(`${baseUrl}/api/dealer/earnings?dealerId=10`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.dealerId, 10);
    assert.equal(data.summary.totalQuotations, 4);
    assert.equal(data.summary.confirmedEarnings, 3000);
  });

  console.log("\nAll Dealer Earnings Dashboard regression tests passed successfully!");
} finally {
  if (child && child.pid) {
    try {
      const { execSync } = await import("node:child_process");
      execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }
  if (mongo) {
    try {
      await mongo.db(dbName).dropDatabase();
      await mongo.close();
    } catch {
      /* ignore */
    }
  }
  if (tempRoot) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}
