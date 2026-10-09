import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Quotation creator / dealer assignment / audit integration tests.
 *
 * Runs an isolated Next.js dev server against a throwaway database on the LOCAL
 * loopback MongoDB (same safety model as quotation-workflow.test.mjs). It never
 * touches the application's real database.
 */

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootRequire = createRequire(join(repo, "package.json"));
const { MongoClient, Decimal128 } = rootRequire("mongodb");
const bcrypt = rootRequire("bcryptjs");

function checkSafeTarget(uri, dbName) {
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "mongodb:", "test MongoDB must use mongodb://");
  assert.equal(parsed.hostname, "127.0.0.1", "test MongoDB host must be loopback");
  assert.equal(parsed.port, "27017", "test MongoDB port must be local default");
  assert.equal(parsed.username, "", "test MongoDB must not include credentials");
  assert.equal(parsed.pathname, `/${dbName}`, "URI database must match generated test database");
  assert.match(dbName, /^whyte_quotation_ownership_test_[0-9]{8}_[a-f0-9]{12}$/);
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
  const deadline = Date.now() + 180_000;
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

const dbName = `whyte_quotation_ownership_test_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(6).toString("hex")}`;
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

  tempRoot = await mkdtemp(join(tmpdir(), "whyte-ownership-isolated-"));
  await mkdir(join(tempRoot, ".next-ownership-test"));
  await cp(join(repo, "src"), join(tempRoot, "src"), { recursive: true });
  await symlink(join(repo, "node_modules"), join(tempRoot, "node_modules"), "junction");
  await symlink(join(repo, "public"), join(tempRoot, "public"), "junction");
  await copyFile(join(repo, "tsconfig.json"), join(tempRoot, "tsconfig.json"));
  await copyFile(join(repo, "postcss.config.mjs"), join(tempRoot, "postcss.config.mjs"));
  await writeFile(join(tempRoot, "package.json"), JSON.stringify({ private: true, scripts: { dev: "next dev --webpack" } }));
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
    PHASE3_TEST_DIST_DIR: ".next-ownership-test",
  };

  const { spawn } = await import("node:child_process");
  child = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], { cwd: tempRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
  child.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

  await waitForServer(baseUrl, child, () => serverOutput);
  console.log(`Isolated Next.js server ready at ${baseUrl}. Starting ownership tests...`);

  const db = mongo.db(dbName);
  const now = new Date();
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const user = (id, email, role, name, extra = {}) => ({
    _id: id,
    email,
    passwordHash,
    role,
    name,
    isActive: true,
    discountAllocationPercent: 0,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });

  await db.collection("adminusers").insertMany([
    user(1, "dealer_a@example.com", "dealer", "Dealer A", { discountAllocationPercent: 30 }),
    user(2, "dealer_b@example.com", "dealer", "Dealer B", { discountAllocationPercent: 20 }),
    user(3, "admin_user@example.com", "admin", "Admin User"),
    user(4, "super_admin@example.com", "super_admin", "Super Admin"),
    user(5, "dealer_off@example.com", "dealer", "Dealer Inactive", { isActive: false }),
  ]);

  async function login(email, portal) {
    const cookieStore = new Map();
    const remember = (response) => {
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0];
        cookieStore.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      }
    };
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
    assert.equal(csrfResponse.status, 200);
    remember(csrfResponse);
    const csrf = (await csrfResponse.json()).csrfToken;
    const callback = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: [...cookieStore].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: new URLSearchParams({
        csrfToken: csrf,
        email,
        password: "Password123!",
        portal,
        callbackUrl: `${baseUrl}/`,
        json: "true",
      }).toString(),
      redirect: "manual",
    });
    remember(callback);
    return [...cookieStore].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  const dealerA = await login("dealer_a@example.com", "user");
  const dealerB = await login("dealer_b@example.com", "user");
  const admin = await login("admin_user@example.com", "admin");
  const superAdmin = await login("super_admin@example.com", "admin");

  const unwrap = (json) => (json && typeof json === "object" && "data" in json ? json.data : json);

  async function api(cookie, method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, data: unwrap(json) };
  }

  const stored = (id) => db.collection("quotations").findOne({ _id: id });
  const eventsOf = (id) => db.collection("quotationauditevents").find({ quotationId: id }).sort({ performedOn: 1 }).toArray();
  const actions = async (id) => (await eventsOf(id)).map((e) => e.action);

  let saSelfId, saAssignedId, adminAssignedId, dealerOwnId;

  await assertCase("1. Super Admin creates quotation for self", async () => {
    const before = Date.now();
    const res = await api(superAdmin, "POST", "/api/quotations", { clientName: "Self Client" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    saSelfId = res.data.id;
    const doc = await stored(saSelfId);
    assert.equal(doc.createdBy, "4");
    assert.equal(doc.dealerId, null);
    assert.equal(doc.assignedBy ?? null, null);
    assert.equal(doc.assignedOn ?? null, null);
    assert.ok(doc.createdAt.getTime() >= before - 2000 && doc.createdAt.getTime() <= Date.now() + 2000);
  });

  await assertCase("15. quotation_created audit event exists (and no assignment event for self)", async () => {
    const events = await eventsOf(saSelfId);
    assert.deepEqual(events.map((e) => e.action), ["quotation_created"]);
    assert.equal(events[0].performedBy, 4);
    assert.equal(events[0].performedByName, "Super Admin");
    assert.ok(events[0].performedOn instanceof Date);
  });

  await assertCase("2. Super Admin creates quotation and assigns Dealer A", async () => {
    const res = await api(superAdmin, "POST", "/api/quotations", { clientName: "Assigned Client", dealerId: 1 });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    saAssignedId = res.data.id;
    const doc = await stored(saAssignedId);
    assert.equal(doc.createdBy, "4", "createdBy must stay the Super Admin, never the dealer");
    assert.equal(doc.dealerId, 1);
    assert.equal(doc.assignedBy, 4);
    assert.ok(doc.assignedOn instanceof Date);
    assert.equal(doc.allocatedDiscountPercent, 30);
  });

  await assertCase("16. quotation_assigned audit event exists with the dealer", async () => {
    const events = await eventsOf(saAssignedId);
    assert.deepEqual(events.map((e) => e.action), ["quotation_created", "quotation_assigned"]);
    assert.equal(events[1].performedBy, 4);
    assert.equal(events[1].previousValue, null);
    assert.equal(events[1].newValue.dealerId, 1);
    assert.equal(events[1].newValue.dealerName, "Dealer A");
  });

  await assertCase("3. Admin creates quotation and assigns Dealer A", async () => {
    const res = await api(admin, "POST", "/api/quotations", { clientName: "Admin Assigned", dealerId: 1 });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    adminAssignedId = res.data.id;
    const doc = await stored(adminAssignedId);
    assert.equal(doc.createdBy, "3");
    assert.equal(doc.dealerId, 1);
    assert.equal(doc.assignedBy, 3);
  });

  await assertCase("4. Dealer creates quotation (owns it, no assignment act)", async () => {
    const res = await api(dealerA, "POST", "/api/quotations", { clientName: "Dealer Own" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    dealerOwnId = res.data.id;
    const doc = await stored(dealerOwnId);
    assert.equal(doc.createdBy, "1");
    assert.equal(doc.dealerId, 1);
    assert.equal(doc.assignedBy ?? null, null);
    assert.equal(doc.assignedOn ?? null, null);
    assert.deepEqual(await actions(dealerOwnId), ["quotation_created"]);
  });

  await assertCase("5. Assigned quotation appears for Dealer A (assigned and self-created)", async () => {
    const res = await api(dealerA, "GET", "/api/quotations");
    assert.equal(res.status, 200);
    const ids = res.data.map((q) => q.id);
    assert.ok(ids.includes(saAssignedId));
    assert.ok(ids.includes(adminAssignedId));
    assert.ok(ids.includes(dealerOwnId));
    assert.ok(!ids.includes(saSelfId), "Super Admin's own quotation must not leak to a dealer");
  });

  await assertCase("6. Assigned quotation does not appear for Dealer B", async () => {
    const res = await api(dealerB, "GET", "/api/quotations");
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, []);
  });

  await assertCase("6b. Dealer cannot widen the list with createdBy / dealerId / mine params", async () => {
    const res = await api(dealerB, "GET", `/api/quotations?dealerId=1&createdBy=4&mine=true`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, []);
    const resA = await api(dealerA, "GET", `/api/quotations?dealerId=2`);
    assert.ok(resA.data.length >= 3, "Dealer A still sees only their own scope, not another dealer's");
  });

  await assertCase("7. Dealer cannot assign to another dealer at creation", async () => {
    const res = await api(dealerA, "POST", "/api/quotations", { clientName: "Sneaky", dealerId: 2 });
    assert.equal(res.status, 403, JSON.stringify(res.json));
    assert.equal(await db.collection("quotations").countDocuments({ clientName: "Sneaky" }), 0);
  });

  await assertCase("7b. Dealer naming themselves is accepted and stays theirs", async () => {
    const res = await api(dealerA, "POST", "/api/quotations", { clientName: "Self Named", dealerId: 1 });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const doc = await stored(res.data.id);
    assert.equal(doc.dealerId, 1);
    assert.equal(doc.assignedBy ?? null, null);
  });

  await assertCase("8/12. Client cannot spoof createdBy", async () => {
    const res = await api(dealerA, "POST", "/api/quotations", { clientName: "Spoof", createdBy: "4" });
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.equal(await db.collection("quotations").countDocuments({ clientName: "Spoof" }), 0);
  });

  await assertCase("9/11. Client cannot spoof createdOn / assignedOn / createdAt", async () => {
    for (const field of ["createdOn", "createdAt", "assignedOn"]) {
      const res = await api(superAdmin, "POST", "/api/quotations", {
        clientName: `Spoof ${field}`,
        [field]: "2001-01-01T00:00:00.000Z",
      });
      assert.equal(res.status, 400, `${field}: ${JSON.stringify(res.json)}`);
    }
  });

  await assertCase("10/13. Client cannot spoof assignedBy / assignedTo", async () => {
    for (const field of ["assignedBy", "assignedTo"]) {
      const res = await api(superAdmin, "POST", "/api/quotations", {
        clientName: `Spoof ${field}`,
        dealerId: 1,
        [field]: 2,
      });
      assert.equal(res.status, 400, `${field}: ${JSON.stringify(res.json)}`);
    }
    const ok = await api(superAdmin, "POST", "/api/quotations", { clientName: "Assigned By Check", dealerId: 2 });
    assert.equal((await stored(ok.data.id)).assignedBy, 4, "assignedBy always comes from the session");
  });

  await assertCase("PATCH cannot rewrite ownership or audit fields", async () => {
    for (const body of [{ createdBy: "1" }, { assignedBy: 1 }, { assignedOn: "2001-01-01" }, { dealerId: 2 }, { createdAt: "2001-01-01" }]) {
      const res = await api(superAdmin, "PATCH", `/api/quotations/${saAssignedId}`, body);
      assert.equal(res.status, 400, `${JSON.stringify(body)} -> ${res.status}`);
    }
    const doc = await stored(saAssignedId);
    assert.equal(doc.createdBy, "4");
    assert.equal(doc.dealerId, 1);
  });

  await assertCase("14. Dealer cannot fetch another dealer's quotation directly", async () => {
    const detail = await api(dealerB, "GET", `/api/quotations/${saAssignedId}`);
    assert.equal(detail.status, 403);
    const activity = await api(dealerB, "GET", `/api/quotations/${saAssignedId}/activity`);
    assert.equal(activity.status, 403);
    const patch = await api(dealerB, "PATCH", `/api/quotations/${saAssignedId}`, { clientName: "Hijack" });
    assert.equal(patch.status, 403);
    const own = await api(dealerA, "GET", `/api/quotations/${saAssignedId}`);
    assert.equal(own.status, 200);
    assert.equal(own.data.createdByUser.name, "Super Admin");
    assert.equal(own.data.dealer.name, "Dealer A");
  });

  await assertCase("Dealer cannot call the assign endpoint (own or other quotations)", async () => {
    const own = await api(dealerA, "POST", `/api/quotations/${dealerOwnId}/assign`, { dealerId: 2 });
    assert.equal(own.status, 403);
    const other = await api(dealerB, "POST", `/api/quotations/${saAssignedId}/assign`, { dealerId: 2 });
    assert.equal(other.status, 403);
    assert.equal((await stored(dealerOwnId)).dealerId, 1);
  });

  await assertCase("17. Reassignment records previous and new dealer", async () => {
    const res = await api(superAdmin, "POST", `/api/quotations/${saAssignedId}/assign`, { dealerId: 2 });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const doc = await stored(saAssignedId);
    assert.equal(doc.dealerId, 2);
    assert.equal(doc.assignedBy, 4);
    assert.equal(doc.createdBy, "4", "reassigning never changes createdBy");
    assert.equal(doc.allocatedDiscountPercent, 20, "allocation snapshot follows the new dealer");
    const events = await eventsOf(saAssignedId);
    const last = events[events.length - 1];
    assert.equal(last.action, "quotation_reassigned");
    assert.equal(last.previousValue.dealerId, 1);
    assert.equal(last.previousValue.dealerName, "Dealer A");
    assert.equal(last.newValue.dealerId, 2);
    assert.equal(last.performedBy, 4);
  });

  await assertCase("Previous dealer loses access after reassignment; new dealer gains it", async () => {
    assert.equal((await api(dealerA, "GET", `/api/quotations/${saAssignedId}`)).status, 403);
    assert.equal((await api(dealerB, "GET", `/api/quotations/${saAssignedId}`)).status, 200);
  });

  await assertCase("Admin can reassign; inactive dealer and unknown dealer are rejected", async () => {
    const inactive = await api(admin, "POST", `/api/quotations/${saAssignedId}/assign`, { dealerId: 5 });
    assert.equal(inactive.status, 400, JSON.stringify(inactive.json));
    const adminAsDealer = await api(admin, "POST", `/api/quotations/${saAssignedId}/assign`, { dealerId: 3 });
    assert.equal(adminAsDealer.status, 404, "an admin user is not a dealer");
    const ok = await api(admin, "POST", `/api/quotations/${saAssignedId}/assign`, { dealerId: 1 });
    assert.equal(ok.status, 200);
    assert.equal((await stored(saAssignedId)).assignedBy, 3);
  });

  await assertCase("Unassign records quotation_unassigned and clears assignment", async () => {
    const res = await api(superAdmin, "POST", `/api/quotations/${saAssignedId}/assign`, { dealerId: null });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const doc = await stored(saAssignedId);
    assert.equal(doc.dealerId, null);
    assert.equal(doc.assignedBy ?? null, null);
    assert.equal(doc.assignedOn ?? null, null);
    assert.equal(doc.allocatedDiscountPercent, 0);
    const events = await eventsOf(saAssignedId);
    assert.deepEqual(events.map((e) => e.action), [
      "quotation_created",
      "quotation_assigned",
      "quotation_reassigned",
      "quotation_reassigned",
      "quotation_unassigned",
    ]);
    assert.equal(events[4].previousValue.dealerId, 1);
    assert.equal(events[4].newValue, null);
  });

  await assertCase("Assigning an unassigned self-owned quotation records quotation_assigned", async () => {
    const res = await api(superAdmin, "POST", `/api/quotations/${saSelfId}/assign`, { dealerId: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(await actions(saSelfId), ["quotation_created", "quotation_assigned"]);
    const same = await api(superAdmin, "POST", `/api/quotations/${saSelfId}/assign`, { dealerId: 1 });
    assert.equal(same.data.changed, false);
    assert.equal((await actions(saSelfId)).length, 2, "no event for a no-op assignment");
  });

  await assertCase("Creator keeps read access (not edit access) after an admin moves their quotation", async () => {
    const created = await api(dealerA, "POST", "/api/quotations", { clientName: "Moves Away" });
    const id = created.data.id;
    const moved = await api(admin, "POST", `/api/quotations/${id}/assign`, { dealerId: 2 });
    assert.equal(moved.status, 200);
    assert.equal((await stored(id)).createdBy, "1");
    assert.equal((await api(dealerA, "GET", `/api/quotations/${id}`)).status, 200);
    assert.ok((await api(dealerA, "GET", "/api/quotations")).data.some((q) => q.id === id));
    assert.equal((await api(dealerA, "PATCH", `/api/quotations/${id}`, { clientName: "Edit" })).status, 403);
    assert.equal((await api(dealerB, "PATCH", `/api/quotations/${id}`, { clientName: "Edit By Owner" })).status, 200);
  });

  await assertCase("Admin list shows creator and dealer names; creator/dealer filters work", async () => {
    const all = await api(superAdmin, "GET", "/api/quotations");
    assert.equal(all.status, 200);
    const row = all.data.find((q) => q.id === adminAssignedId);
    assert.equal(row.createdByUser.name, "Admin User");
    assert.equal(row.dealer.name, "Dealer A");
    assert.equal(row.assignedByUser.name, "Admin User");

    const byCreator = await api(superAdmin, "GET", "/api/quotations?createdBy=3");
    assert.ok(byCreator.data.length >= 1 && byCreator.data.every((q) => q.createdBy === "3"));
    const mine = await api(superAdmin, "GET", "/api/quotations?mine=true");
    assert.ok(mine.data.length >= 1 && mine.data.every((q) => q.createdBy === "4"));
    const byDealer = await api(superAdmin, "GET", "/api/quotations?dealerId=1");
    assert.ok(byDealer.data.length >= 1 && byDealer.data.every((q) => q.dealerId === 1));
  });

  await assertCase("Activity endpoint is read-only", async () => {
    const res = await api(superAdmin, "GET", `/api/quotations/${saSelfId}/activity`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.map((e) => e.action), ["quotation_created", "quotation_assigned"]);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const attempt = await api(superAdmin, method, `/api/quotations/${saSelfId}/activity`, {});
      assert.equal(attempt.status, 405, `${method} must not be allowed`);
    }
    assert.equal((await eventsOf(saSelfId)).length, 2);
  });

  await assertCase("Audit history outlives its quotation and has no write API", async () => {
    // Exercised through the application's own model layer (same code the routes use).
    const events = await eventsOf(saSelfId);
    assert.ok(events.length > 0);
    const res = await fetch(`${baseUrl}/api/quotations/${saSelfId}`, { method: "DELETE", headers: { Cookie: superAdmin } });
    assert.equal(res.status, 200, "deleting a quotation is allowed");
    assert.equal((await eventsOf(saSelfId)).length, 2, "audit history outlives the quotation");
  });

  await assertCase("Status changes are audited (mark-sent, approve)", async () => {
    const created = await api(dealerA, "POST", "/api/quotations", { clientName: "Lifecycle" });
    const id = created.data.id;
    // mark-sent/approve require at least one product (tests/quotation-status-product-gate.test.mjs),
    // so the fixture needs a room holding an item before it can leave draft.
    await db.collection("quotationrooms").insertOne({ _id: 9001, quotationId: id, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() });
    await db.collection("quotationitems").insertOne({ _id: 9001, quotationRoomId: 9001, productId: 1, productVariantId: null, quantity: 1, unitPrice: Decimal128.fromString("1000.00"), sortOrder: 0 });
    assert.equal((await api(dealerA, "POST", `/api/quotations/${id}/mark-sent`)).status, 200);
    assert.equal((await api(admin, "POST", `/api/quotations/${id}/transition`, { action: "approve" })).status, 200);
    const events = await eventsOf(id);
    assert.deepEqual(events.map((e) => e.action), ["quotation_created", "status_changed", "quotation_approved"]);
    assert.deepEqual(events[1].previousValue, { status: "draft" });
    assert.deepEqual(events[1].newValue, { status: "sent" });
    assert.equal(events[2].performedBy, 3);
    const locked = await api(superAdmin, "POST", `/api/quotations/${id}/assign`, { dealerId: 2 });
    assert.equal(locked.status, 403, "approved quotations cannot be reassigned");
  });

  await assertCase("18. Clone creates a new creator and a fresh audit trail", async () => {
    const clone = await api(dealerA, "POST", `/api/quotations/${dealerOwnId}/duplicate`);
    assert.equal(clone.status, 201, JSON.stringify(clone.json));
    const newId = clone.data.id;
    assert.notEqual(newId, dealerOwnId);
    const doc = await stored(newId);
    const original = await stored(dealerOwnId);
    assert.equal(doc.createdBy, "1");
    assert.equal(doc.dealerId, 1);
    assert.equal(doc.assignedBy ?? null, null);
    assert.notEqual(doc.quotationNumber, original.quotationNumber);
    assert.ok(doc.createdAt.getTime() >= original.createdAt.getTime());
    assert.equal(doc.clonedFromQuotationId, dealerOwnId);
    const events = await eventsOf(newId);
    assert.deepEqual(events.map((e) => e.action), ["quotation_cloned"]);
    assert.equal(events[0].metadata.clonedFromQuotationId, dealerOwnId);
    assert.deepEqual(await actions(dealerOwnId), ["quotation_created"], "original history is untouched");
  });

  await assertCase("Clone by admin: assign to a dealer, keep for self, or inherit", async () => {
    const toDealer = await api(admin, "POST", `/api/quotations/${dealerOwnId}/duplicate`, { dealerId: 2 });
    assert.equal(toDealer.status, 201, JSON.stringify(toDealer.json));
    let doc = await stored(toDealer.data.id);
    assert.equal(doc.createdBy, "3");
    assert.equal(doc.dealerId, 2);
    assert.equal(doc.assignedBy, 3);
    assert.deepEqual(await actions(toDealer.data.id), ["quotation_cloned", "quotation_assigned"]);

    const forSelf = await api(admin, "POST", `/api/quotations/${dealerOwnId}/duplicate`, { dealerId: null });
    doc = await stored(forSelf.data.id);
    assert.equal(doc.dealerId, null);
    assert.equal(doc.createdBy, "3");
    assert.deepEqual(await actions(forSelf.data.id), ["quotation_cloned"]);

    const inherited = await api(admin, "POST", `/api/quotations/${dealerOwnId}/duplicate`);
    doc = await stored(inherited.data.id);
    assert.equal(doc.dealerId, 1, "previous behaviour: the clone stays with the original dealer");
    assert.equal(doc.createdBy, "3");
  });

  await assertCase("Dealer cannot clone onto another dealer or clone someone else's quotation", async () => {
    const other = await api(dealerA, "POST", `/api/quotations/${dealerOwnId}/duplicate`, { dealerId: 2 });
    assert.equal(other.status, 403);
    const foreign = await api(dealerB, "POST", `/api/quotations/${dealerOwnId}/duplicate`);
    assert.equal(foreign.status, 403);
  });

  await assertCase("Historical quotations without ownership fields stay usable", async () => {
    const legacyId = "q_legacy_000001";
    await db.collection("quotations").insertOne({
      _id: legacyId,
      quotationNumber: "QT-2025-001",
      clientName: "Legacy Client",
      status: "draft",
      dealerId: 1,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    });
    const detail = await api(dealerA, "GET", `/api/quotations/${legacyId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.createdByUser, null);
    assert.equal(detail.data.assignedBy ?? null, null);
    assert.equal(detail.data.assignedOn ?? null, null);
    const activity = await api(dealerA, "GET", `/api/quotations/${legacyId}/activity`);
    assert.deepEqual(activity.data, []);
    const list = await api(superAdmin, "GET", "/api/quotations");
    assert.ok(list.data.some((q) => q.id === legacyId));
  });

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\n${results.length - failed.length}/${results.length} ownership tests passed.`);
  if (failed.length > 0) {
    process.exitCode = 1;
    for (const f of failed) console.log(`  FAILED: ${f.name}: ${f.detail}`);
  }
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
  process.exit(process.exitCode ?? 0);
}
