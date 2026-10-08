import assert from "node:assert/strict";
import { createRunner, startIsolatedServer } from "./helpers/isolatedServer.mjs";

/**
 * Phase 1 regression suite:
 *  1. Catalog / company / upload writes are Super Admin / Admin only (a
 *     dealer session gets 403, an anonymous request gets 401, admin and
 *     super_admin keep working).
 *  2. Dealer-visible responses never contain `cost` / `purchaseTaxPercent`;
 *     admin-visible responses still do.
 *  3. A deactivated account's existing session stops working (session/role
 *     revalidation), and a role change on the DB record is honoured too.
 *
 * SESSION_ACTOR_CACHE_TTL_MS=0 is set before the isolated server starts so
 * test (3) observes a deactivation on the very next request instead of
 * waiting out the real 30s production cache window.
 */
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";

const { assertCase, summary } = createRunner();
let server;
const { Decimal128 } = await import("./helpers/isolatedServer.mjs");

function containsKey(value, key) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => containsKey(v, key));
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((v) => containsKey(v, key));
}

try {
  server = await startIsolatedServer("roleguards", [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 20 },
    { _id: 2, email: "dealer_b@example.com", role: "dealer", name: "Dealer B", discountAllocationPercent: 20 },
    { _id: 3, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    { _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
  ]);
  const { db, login, api, baseUrl } = server;

  await db.collection("categories").insertOne({
    _id: 1,
    name: "Switches",
    level: 1,
    parentId: null,
    sortOrder: 1,
    isActive: true,
    variantTiers: [],
    variantFinishes: [],
  });
  await db.collection("products").insertOne({
    _id: 1,
    name: "Test Switch",
    code: "TS-1",
    type: "switch_board",
    categoryId: 1,
    unit: "pcs",
    isActive: true,
    sortOrder: 1,
    isMatrix: false,
    matrixDimensions: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection("productvariants").insertOne({
    _id: 1,
    productId: 1,
    variantCode: "TS-1-V1",
    config: {},
    price: Decimal128.fromString("118.00"),
    priceWithoutTax: Decimal128.fromString("100.00"),
    taxPercent: Decimal128.fromString("18.00"),
    cost: Decimal128.fromString("60.00"),
    purchaseTaxPercent: Decimal128.fromString("18.00"),
    isActive: true,
    sortOrder: 1,
  });
  await db.collection("housetypes").insertOne({
    _id: 1,
    name: "Test House",
    isActive: true,
    sortOrder: 1,
  });
  await db.collection("roomtypes").insertOne({
    _id: 1,
    name: "Test Room",
    isActive: true,
    sortOrder: 1,
  });

  const dealer = await login("dealer_a@example.com", "user");
  const admin = await login("admin_user@example.com", "admin");
  const superAdmin = await login("super_admin@example.com", "admin");

  // ───────────────────────────── 1. Role guards ─────────────────────────────

  const WRITE_ENDPOINTS = [
    ["POST", "/api/products", { name: "x", type: "switch_board", categoryId: 1, unit: "pcs", variants: [] }],
    ["PATCH", "/api/products/1", { name: "renamed" }],
    ["DELETE", "/api/products/1", undefined],
    ["GET", "/api/products/1/variants", undefined],
    ["POST", "/api/products/1/variants", { variantCode: "X", price: 10 }],
    ["PATCH", "/api/products/1/variants", { variants: [] }],
    ["DELETE", "/api/products/1/variants/1", undefined],
    ["GET", "/api/products/1/variants/matrix", undefined],
    ["POST", "/api/products/1/variants/restore", { historyId: 1, variantCode: "X", price: 10 }],
    ["GET", "/api/product-variants/1", undefined],
    ["PATCH", "/api/product-variants/1", { price: 10 }],
    ["DELETE", "/api/product-variants/1", undefined],
    ["POST", "/api/categories", { name: "x", level: 1 }],
    ["PATCH", "/api/categories/1", { name: "x" }],
    ["DELETE", "/api/categories/1", undefined],
    ["POST", "/api/room-types", { name: "x" }],
    ["PATCH", "/api/room-types/1", { name: "x" }],
    ["DELETE", "/api/room-types/1", undefined],
    ["POST", "/api/house-types", { name: "x" }],
    ["PATCH", "/api/house-types/1", { name: "x" }],
    ["PATCH", "/api/company", { name: "x", phone: "+919876543210", address: "x" }],
    ["POST", "/api/upload", undefined],
    ["DELETE", "/api/upload", { publicId: "whyte/products/x" }],
  ];

  for (const [method, path, body] of WRITE_ENDPOINTS) {
    await assertCase(`Dealer forbidden: ${method} ${path}`, async () => {
      const res = await api(dealer, method, path, body);
      assert.equal(res.status, 403, `expected 403, got ${res.status}: ${res.text}`);
    });
  }

  for (const [method, path] of WRITE_ENDPOINTS) {
    await assertCase(`Anonymous unauthorized: ${method} ${path}`, async () => {
      const res = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(res.status, 401, `expected 401, got ${res.status}`);
    });
  }

  await assertCase("Admin allowed: GET /api/products/1/variants", async () => {
    const res = await api(admin, "GET", "/api/products/1/variants");
    assert.equal(res.status, 200, res.text);
  });

  await assertCase("Super Admin allowed: POST /api/categories", async () => {
    const res = await api(superAdmin, "POST", "/api/categories", { name: "New Category", level: 1 });
    assert.equal(res.status, 201, res.text);
  });

  await assertCase("Super Admin allowed: PATCH /api/company", async () => {
    const res = await api(superAdmin, "PATCH", "/api/company", { name: "Whyte", phone: "+919876543210", address: "Ahmedabad" });
    assert.ok([200, 201].includes(res.status), res.text);
  });

  await assertCase("Dealer still allowed: GET /api/products (read-only catalog)", async () => {
    const res = await api(dealer, "GET", "/api/products");
    assert.equal(res.status, 200, res.text);
  });

  await assertCase("Dealer still allowed: GET /api/categories (read-only catalog)", async () => {
    const res = await api(dealer, "GET", "/api/categories");
    assert.equal(res.status, 200, res.text);
  });

  // ─────────────────────────── 2. Cost redaction ────────────────────────────

  await assertCase("Dealer response never contains cost/purchaseTaxPercent: GET /api/products", async () => {
    const res = await api(dealer, "GET", "/api/products");
    assert.equal(res.status, 200, res.text);
    assert.equal(containsKey(res.json, "cost"), false, "cost leaked to dealer");
    assert.equal(containsKey(res.json, "purchaseTaxPercent"), false, "purchaseTaxPercent leaked to dealer");
  });

  await assertCase("Admin response still contains cost/purchaseTaxPercent: GET /api/products", async () => {
    const res = await api(admin, "GET", "/api/products?all=true");
    assert.equal(res.status, 200, res.text);
    assert.equal(containsKey(res.json, "cost"), true, "cost missing for admin");
    assert.equal(containsKey(res.json, "purchaseTaxPercent"), true, "purchaseTaxPercent missing for admin");
  });

  await assertCase("Dealer response never contains cost/purchaseTaxPercent: GET /api/products/1", async () => {
    const res = await api(dealer, "GET", "/api/products/1");
    assert.equal(res.status, 200, res.text);
    assert.equal(containsKey(res.json, "cost"), false);
    assert.equal(containsKey(res.json, "purchaseTaxPercent"), false);
  });

  let dealerQuotationId;
  let dealerRoomId;
  let dealerItemId;

  await assertCase("Dealer creates quotation + room + item: unitPrice correct, no cost leak", async () => {
    const quote = await api(dealer, "POST", "/api/quotations", { clientName: "Redaction Test Client" });
    assert.equal(quote.status, 201, quote.text);
    dealerQuotationId = quote.data.id;

    const room = await api(dealer, "POST", `/api/quotations/${dealerQuotationId}/rooms`, { roomTypeId: 1, customName: "Room 1" });
    assert.ok([200, 201].includes(room.status), room.text);
    dealerRoomId = room.data.id;

    const item = await api(dealer, "POST", `/api/quotations/${dealerQuotationId}/items`, {
      quotationRoomId: dealerRoomId,
      productId: 1,
      quantity: 1,
    });
    assert.equal(item.status, 201, item.text);
    dealerItemId = item.data.id;
    assert.equal(Number(item.data.unitPrice), 118, "unitPrice should resolve to the variant's price");
    assert.equal(containsKey(item.json, "cost"), false, "cost leaked on item creation response");
    assert.equal(containsKey(item.json, "purchaseTaxPercent"), false);
  });

  await assertCase("Dealer PATCHing item quantity: response still has no cost leak", async () => {
    const res = await api(dealer, "PATCH", `/api/quotations/${dealerQuotationId}/items/${dealerItemId}`, { quantity: 2 });
    assert.equal(res.status, 200, res.text);
    assert.equal(containsKey(res.json, "cost"), false);
    assert.equal(containsKey(res.json, "purchaseTaxPercent"), false);
  });

  await assertCase("Dealer GET quotation: no cost leak", async () => {
    const res = await api(dealer, "GET", `/api/quotations/${dealerQuotationId}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(containsKey(res.json, "cost"), false);
    assert.equal(containsKey(res.json, "purchaseTaxPercent"), false);
  });

  // Phase 3 (Step 3.1) deliberately stopped embedding `cost`/`purchaseTaxPercent`
  // on a quotation item's product/variant snapshot AT ALL, for every role —
  // not because of role-based redaction, but because nothing ever reads
  // margin data from a quoted item (grep-verified: no admin screen in the
  // quotation editor, review, or admin quotations list displays it), and the
  // full catalog variant it used to duplicate there was the actual payload
  // bloat Step 3.1 removed. Admins still see cost exactly where it is
  // actually used — the catalog endpoints below — which Phase 3 did not touch.
  await assertCase("Admin GET of a quotation: no item carries cost (removed for every role in Phase 3)", async () => {
    const res = await api(admin, "GET", `/api/quotations/${dealerQuotationId}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(containsKey(res.json, "cost"), false, "quotation items should never carry cost, for any role, after Phase 3");
  });

  // ───────────────────────── 3. Session revalidation ────────────────────────

  await assertCase("Deactivated dealer: existing session stops working on the next request", async () => {
    const before = await api(dealer, "GET", "/api/categories");
    assert.equal(before.status, 200, before.text);

    await db.collection("adminusers").updateOne({ _id: 1 }, { $set: { isActive: false } });

    const after = await api(dealer, "GET", "/api/categories");
    assert.equal(after.status, 401, `expected 401 after deactivation, got ${after.status}: ${after.text}`);
  });

  await assertCase("Reactivated dealer: session works again", async () => {
    await db.collection("adminusers").updateOne({ _id: 1 }, { $set: { isActive: true } });
    const res = await api(dealer, "GET", "/api/categories");
    assert.equal(res.status, 200, res.text);
  });

  await assertCase("Role changed on the DB record: stale-role session stops working", async () => {
    await db.collection("adminusers").updateOne({ _id: 1 }, { $set: { role: "admin" } });
    const res = await api(dealer, "GET", "/api/categories");
    assert.equal(res.status, 401, `expected 401 after role change, got ${res.status}: ${res.text}`);
    // restore for hygiene, though the database is thrown away at teardown
    await db.collection("adminusers").updateOne({ _id: 1 }, { $set: { role: "dealer" } });
  });

  // NOTE: the `(app)` route has a `loading.tsx`, so Next.js streams it behind
  // a Suspense boundary — the HTTP response starts as 200 with a loading
  // shell before the async layout (which runs the revalidation check below)
  // resolves, and a *real* browser then acts on the redirect instruction
  // embedded in that stream. A plain `fetch()` here cannot observe that the
  // same way an API route's top-level status code can, so page-level
  // revalidation is exercised at the unit level instead: it calls the exact
  // same `isSessionActorStillValid` already proven correct by every API-level
  // case above, from the same two-line `if (!(await isSessionActorStillValid(...)))
  // redirect(...)` pattern added to `(app)/layout.tsx`, `admin/(panel)/layout.tsx`
  // and `dealer/access/page.tsx`.

  if (summary() > 0) process.exitCode = 1;
} catch (error) {
  console.error("SETUP/RUN ERROR:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(process.exitCode ?? 0);
}
