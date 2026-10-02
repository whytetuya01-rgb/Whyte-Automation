import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootRequire = createRequire(join(repo, "package.json"));
const { MongoClient } = rootRequire("mongodb");
const bcrypt = rootRequire("bcryptjs");

// Import normalizeProductDimensions and findVariant from the refactored variant-dimension helper
import { normalizeProductDimensions, findVariant } from "../src/lib/variant-dimension.mjs";

function checkSafeTarget(uri, dbName) {
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "mongodb:", "test MongoDB must use mongodb://");
  assert.equal(parsed.hostname, "127.0.0.1", "test MongoDB host must be loopback");
  assert.equal(parsed.port, "27017", "test MongoDB port must be local default");
  assert.equal(parsed.username, "", "test MongoDB must not include credentials");
  assert.equal(parsed.password, "", "test MongoDB must not include credentials");
  assert.equal(parsed.pathname, `/${dbName}`, "URI database must match generated test database");
  assert.deepEqual([...parsed.searchParams.keys()], ["directConnection"]);
  assert.equal(parsed.searchParams.get("directConnection"), "true");
  assert.match(dbName, /^whyte_quotation_workflow_test_[0-9]{8}_[a-f0-9]{12}$/);
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

const results = [];

async function assertCase(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// =========================================================================
// SECTION 1: UNIT TESTS FOR DIMENSION NORMALIZATION & VARIANT PICKER
// =========================================================================

await assertCase("Unit: normalizeProductDimensions handles DB format with name and values", async () => {
  const product = {
    id: 330,
    name: "Varshil 10",
    isMatrix: true,
    matrixDimensions: [
      { name: "Automation", values: ["remote", "wifi", "zigbee"] },
      { name: "Finish", values: ["acrylic", "glass"] },
    ],
  };
  const variants = [
    { id: 1, config: { series: "wifi", finish: "acrylic", variantCode: "WIFI-ACRYLIC" }, price: "500.00", isActive: true },
    { id: 2, config: { series: "wifi", finish: "glass", variantCode: "WIFI-GLASS" }, price: "600.00", isActive: true },
  ];

  const dims = normalizeProductDimensions(product, variants);
  assert.equal(dims.length, 2, "Should parse 2 dimensions");
  assert.equal(dims[0].key, "series");
  assert.equal(dims[0].label, "Automation");
  assert.deepEqual(dims[0].options, ["remote", "wifi", "zigbee"]);
  assert.equal(dims[1].key, "finish");
  assert.equal(dims[1].label, "Finish");
  assert.deepEqual(dims[1].options, ["acrylic", "glass"]);
});

await assertCase("Unit: normalizeProductDimensions safely handles null or missing matrixDimensions", async () => {
  const product = {
    id: 44,
    name: "Touch 4 Switch",
    isMatrix: false,
    matrixDimensions: null,
  };
  const variants = [
    { id: 1, automationTier: "remote", surfaceFinish: "acrylic", price: "5799.00", isActive: true },
    { id: 2, automationTier: "wifi", surfaceFinish: "glass", price: "9399.00", isActive: true },
  ];

  const dims = normalizeProductDimensions(product, variants);
  assert.equal(dims.length, 2, "Should derive 2 dimensions from variant fields");
  assert.ok(dims.some((d) => d.key === "series" && d.options.includes("remote") && d.options.includes("wifi")));
  assert.ok(dims.some((d) => d.key === "finish" && d.options.includes("acrylic") && d.options.includes("glass")));
});

await assertCase("Unit: normalizeProductDimensions handles empty options and malformed records without throwing", async () => {
  const product = {
    id: 999,
    name: "Malformed Product",
    matrixDimensions: [
      null,
      {},
      { name: "EmptyDim", values: [] },
      { label: "ValidDim", options: ["opt1", "opt2"] },
    ],
  };

  const dims = normalizeProductDimensions(product, []);
  assert.equal(dims.length, 1);
  assert.equal(dims[0].label, "ValidDim");
  assert.deepEqual(dims[0].options, ["opt1", "opt2"]);
});

await assertCase("Unit: findVariant matches variant with extra metadata and case-insensitivity", async () => {
  const variants = [
    { id: 101, config: { series: "wifi", finish: "acrylic", variantCode: "WIFI-ACRYLIC" }, price: "500.00", isActive: true },
    { id: 102, config: { series: "wifi", finish: "glass", variantCode: "WIFI-GLASS" }, price: "600.00", isActive: true },
    { id: 103, automationTier: "zigbee", surfaceFinish: "acrylic", config: {}, price: "700.00", isActive: true },
  ];

  const match1 = findVariant(variants, { series: "WIFI", finish: "Acrylic" });
  assert.equal(match1?.id, 101, "Should match variant 101 ignoring extra variantCode in config");

  const match2 = findVariant(variants, { automation: "zigbee", finish: "acrylic" });
  assert.equal(match2?.id, 103, "Should match variant 103 via automationTier and surfaceFinish top-level fields");
});

// =========================================================================
// SECTION 2: END-TO-END WORKFLOW INTEGRATION TESTS
// =========================================================================

const dbName = `whyte_quotation_workflow_test_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(6).toString("hex")}`;
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

  tempRoot = await mkdtemp(join(tmpdir(), "whyte-workflow-isolated-"));
  await mkdir(join(tempRoot, ".next-workflow-test"));
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
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "development",
    MONGODB_URI: mongoUri,
    NEXTAUTH_SECRET: secret,
    NEXTAUTH_URL: baseUrl,
    PHASE3_ISOLATED_TEST_RUN: "1",
    PHASE3_TEST_DIST_DIR: ".next-workflow-test",
  };

  const { spawn } = await import("node:child_process");
  child = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
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
  console.log(`Isolated Next.js server ready at ${baseUrl}. Starting workflow tests...`);

  const db = mongo.db(dbName);
  const now = new Date();
  const passwordHash = await bcrypt.hash("Password123!", 10);

  // Seed Users: Dealer A (30% discount), Dealer B (20% discount), Admin (50% discount)
  await db.collection("adminusers").insertMany([
    {
      _id: 1,
      email: "dealer_a@example.com",
      passwordHash,
      role: "dealer",
      name: "Dealer A",
      firstName: "Dealer",
      lastName: "Alpha",
      phone: "+919876543210",
      isActive: true,
      discountAllocationPercent: 30,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 2,
      email: "dealer_b@example.com",
      passwordHash,
      role: "dealer",
      name: "Dealer B",
      firstName: "Dealer",
      lastName: "Beta",
      phone: "+919876543211",
      isActive: true,
      discountAllocationPercent: 20,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 3,
      email: "admin_user@example.com",
      passwordHash,
      role: "admin",
      name: "Admin User",
      firstName: "Admin",
      lastName: "User",
      phone: "+919876543212",
      isActive: true,
      discountAllocationPercent: 50,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Seed Catalog: HouseType, RoomType, Product with Variants
  await db.collection("housetypes").insertOne({
    _id: 1,
    name: "Luxury Villa",
    description: "Modern smart residential villa",
    isActive: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("roomtypes").insertOne({
    _id: 1,
    name: "Living Room",
    isActive: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("products").insertOne({
    _id: 10,
    name: "Varshil 10 Touch Switch",
    code: "VT-10",
    type: "switch_board",
    price: rootRequire("mongodb").Decimal128.fromString("500.00"),
    isActive: true,
    isMatrix: true,
    matrixDimensions: [
      { name: "Automation", values: ["wifi", "zigbee"] },
      { name: "Finish", values: ["acrylic", "glass"] },
    ],
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("productvariants").insertMany([
    {
      _id: 101,
      productId: 10,
      variantCode: "WIFI-ACRYLIC",
      automationTier: "wifi",
      surfaceFinish: "acrylic",
      config: { series: "wifi", finish: "acrylic", variantCode: "WIFI-ACRYLIC" },
      price: rootRequire("mongodb").Decimal128.fromString("500.00"),
      isActive: true,
      sortOrder: 1,
    },
    {
      _id: 102,
      productId: 10,
      variantCode: "WIFI-GLASS",
      automationTier: "wifi",
      surfaceFinish: "glass",
      config: { series: "wifi", finish: "glass", variantCode: "WIFI-GLASS" },
      price: rootRequire("mongodb").Decimal128.fromString("600.00"),
      isActive: true,
      sortOrder: 2,
    },
  ]);

  // Auth helper
  async function login(email, password = "Password123!", portal = "user") {
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

  const dealerACookie = await login("dealer_a@example.com", "Password123!", "user");
  const dealerBCookie = await login("dealer_b@example.com", "Password123!", "user");
  const adminCookie = await login("admin_user@example.com", "Password123!", "admin");

  let createdQuotationId = null;
  let createdRoomId = null;
  let createdItemId = null;

  function unwrap(json) {
    return json && typeof json === "object" && "data" in json ? json.data : json;
  }

  await assertCase("Quotation Creation: Dealer creates quotation without Sales dependencies", async () => {
    const res = await fetch(`${baseUrl}/api/quotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: dealerACookie,
      },
      body: JSON.stringify({
        clientName: "Mr. Sharma",
        clientAddress: "Mumbai",
        clientPhone: "+919876543210",
        houseTypeId: 1,
      }),
    });

    assert.equal(res.status, 201, "Quotation creation should return 201");
    const quote = unwrap(await res.json());
    assert.ok(quote.id || quote._id);
    createdQuotationId = quote.id || quote._id;
    assert.equal(quote.dealerId, 1);
    assert.equal(quote.assignedSalesId, null, "assignedSalesId must be null");
    assert.equal(quote.allocatedDiscountPercent, 30, "Should snapshot Dealer A allocation (30%)");
  });

  await assertCase("Room Creation: Adds room to quotation", async () => {
    const res = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: dealerACookie,
      },
      body: JSON.stringify({
        roomTypeId: 1,
        customName: "Master Living Room",
      }),
    });

    assert.ok([200, 201].includes(res.status), `Expected 200 or 201, got ${res.status}`);
    const room = unwrap(await res.json());
    assert.ok(room.id);
    createdRoomId = room.id;
    assert.equal(room.quotationId, createdQuotationId);
  });

  await assertCase("Item Creation: Adds matrix variant item via variantConfig", async () => {
    const res = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: dealerACookie,
      },
      body: JSON.stringify({
        quotationRoomId: createdRoomId,
        productId: 10,
        variantConfig: { series: "wifi", finish: "glass" },
        quantity: 1,
      }),
    });

    assert.ok([200, 201].includes(res.status), `Expected 200 or 201, got ${res.status}`);
    const item = unwrap(await res.json());
    assert.ok(item.id);
    createdItemId = item.id;
    assert.equal(item.productVariantId, 102, "Should resolve to WIFI-GLASS variant (id 102)");
    assert.equal(Number(item.unitPrice), 600);
  });

  await assertCase("Item Quantity & Subtotal: Updating quantity reflects in quotation subtotal", async () => {
    const patchRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}/items/${createdItemId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: dealerACookie,
      },
      body: JSON.stringify({
        quantity: 2,
      }),
    });
    assert.equal(patchRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}`, {
      headers: { Cookie: dealerACookie },
    });
    assert.equal(getRes.status, 200);
    const quote = unwrap(await getRes.json());
    // Subtotal must be quantity 2 * 600 = 1200
    assert.equal(quote.subtotal, 1200, "Subtotal must equal quantity * unitPrice (2 * 600 = 1200)");
  });

  await assertCase("Discount Enforcement: Cap validation and earnings calculations", async () => {
    // 1. Exceeding allocation of 30% must fail
    const invalidRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: dealerACookie,
      },
      body: JSON.stringify({
        discountType: "percentage",
        discountValue: 35,
        customerDiscountPercent: 35,
      }),
    });
    assert.equal(invalidRes.status, 400, "Discount exceeding allocation must be rejected with 400");

    // 2. Valid discount of 10% must succeed and set estimated earning to 20% (30% - 10%)
    const validRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: dealerACookie,
      },
      body: JSON.stringify({
        discountType: "percentage",
        discountValue: 10,
        customerDiscountPercent: 10,
      }),
    });
    assert.equal(validRes.status, 200);

    const checkRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}`, {
      headers: { Cookie: dealerACookie },
    });
    const quote = unwrap(await checkRes.json());
    assert.equal(quote.customerDiscountPercent, 10);
    assert.equal(quote.estimatedEarningPercent, 20, "30% allocation - 10% customer discount = 20% earnings");
    // Subtotal 1200 * 20% = 240
    assert.equal(Number(quote.estimatedEarningAmount), 240);
  });

  await assertCase("IDOR Protection: Dealer B cannot access or modify Dealer A's quotation", async () => {
    // GET
    const getRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}`, {
      headers: { Cookie: dealerBCookie },
    });
    assert.equal(getRes.status, 403, "Dealer B reading Dealer A's quotation must return 403");

    // PATCH
    const patchRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: dealerBCookie,
      },
      body: JSON.stringify({ clientName: "Spoofed" }),
    });
    assert.equal(patchRes.status, 403, "Dealer B modifying Dealer A's quotation must return 403");

    // DUPLICATE
    const dupRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}/duplicate`, {
      method: "POST",
      headers: { Cookie: dealerBCookie },
    });
    assert.equal(dupRes.status, 403, "Dealer B duplicating Dealer A's quotation must return 403");
  });

  await assertCase("Quotation Lifecycle: Mark Sent -> Admin Approval -> Edit Locking -> Duplicate", async () => {
    // 1. Mark sent
    const sendRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}/mark-sent`, {
      method: "POST",
      headers: { Cookie: dealerACookie },
    });
    assert.equal(sendRes.status, 200);

    // 2. Admin approves quotation
    const approveRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}/transition`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ action: "approve" }),
    });
    assert.equal(approveRes.status, 200);

    // 3. Approved quotation is locked: edits must fail with 403
    const editRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: dealerACookie,
      },
      body: JSON.stringify({ clientName: "Locked Edit Attempt" }),
    });
    assert.equal(editRes.status, 403, "Approved quotation must be locked against edits");

    // 4. Duplicate approved quotation creates a new Draft
    const cloneRes = await fetch(`${baseUrl}/api/quotations/${createdQuotationId}/duplicate`, {
      method: "POST",
      headers: { Cookie: dealerACookie },
    });
    assert.equal(cloneRes.status, 201, "Cloning approved quotation should return 201");
    const cloned = unwrap(await cloneRes.json());
    assert.equal(cloned.status, "draft", "Cloned quotation must be in draft status");
    assert.equal(cloned.allocatedDiscountPercent, 30, "Cloned quotation has latest dealer allocation");
    assert.notEqual(cloned.id, createdQuotationId, "Cloned quotation has new unique ID");
  });

  console.log("\nAll End-to-End Quotation Workflow tests passed!");
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
