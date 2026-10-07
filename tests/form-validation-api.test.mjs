import assert from "node:assert/strict";
import { createRunner, startIsolatedServer } from "./helpers/isolatedServer.mjs";

/** Server-side enforcement of email / phone / GSTIN rules on every form endpoint. */
const { assertCase, summary } = createRunner();
let server;
const GOOD_GST = "27AAPFU0939F1ZV";

try {
  server = await startIsolatedServer("forms", [
    { _id: 1, email: "dealer_a@example.com", role: "dealer", name: "Dealer A", firstName: "Dealer", lastName: "A", discountAllocationPercent: 10 },
    { _id: 3, email: "admin_user@example.com", role: "admin", name: "Admin User" },
    { _id: 4, email: "super_admin@example.com", role: "super_admin", name: "Super Admin" },
  ]);
  const { db, login, api, baseUrl } = server;
  const dealer = await login("dealer_a@example.com", "user");
  const superAdmin = await login("super_admin@example.com", "admin");
  const post = (cookie, path, body) => api(cookie, "POST", path, body);
  const rejects = (res, field) => {
    assert.equal(res.status, 400, `${res.status} ${res.text}`);
    if (field) assert.match(res.text, new RegExp(field, "i"));
  };

  await assertCase("Quotation create: invalid client email / phone / GSTIN are rejected", async () => {
    rejects(await post(dealer, "/api/quotations", { clientName: "X", clientEmail: "not-an-email" }), "email");
    rejects(await post(dealer, "/api/quotations", { clientName: "X", clientPhone: "call me" }), "phone");
    rejects(await post(dealer, "/api/quotations", { clientName: "X", clientGstNumber: "27AAPFU0939F1ZX" }), "GSTIN");
    assert.equal(await db.collection("quotations").countDocuments({ clientName: "X" }), 0);
  });

  await assertCase("Quotation create/update: valid values are normalised and saved", async () => {
    const created = await post(dealer, "/api/quotations", {
      clientName: "Valid Client", clientEmail: "  Client@Example.COM ", clientPhone: "+91 98765 43210", clientGstNumber: "27aapfu0939f1zv",
    });
    assert.equal(created.status, 201, created.text);
    const stored = await db.collection("quotations").findOne({ _id: created.data.id });
    assert.equal(stored.clientEmail, "client@example.com");
    assert.equal(stored.clientGstNumber, GOOD_GST);
    assert.equal(stored.clientPhone, "+91 98765 43210");
    rejects(await api(dealer, "PATCH", `/api/quotations/${created.data.id}`, { clientEmail: "bad@" }), "email");
    rejects(await api(dealer, "PATCH", `/api/quotations/${created.data.id}`, { clientGstNumber: "123" }), "GSTIN");
    const cleared = await api(dealer, "PATCH", `/api/quotations/${created.data.id}`, { clientEmail: "", clientGstNumber: "" });
    assert.equal(cleared.status, 200, cleared.text);
  });

  await assertCase("Dealer registration: email, mobile and GSTIN are enforced", async () => {
    const base = { firstName: "Reg", lastName: "User", password: "Password123!", address: "Ahmedabad", contactNumber: "9876543210" };
    rejects(await post("", "/api/admin/register", { ...base, email: "nope" }), "email");
    rejects(await post("", "/api/admin/register", { ...base, email: "reg1@example.com", contactNumber: "12345" }), "mobile");
    rejects(await post("", "/api/admin/register", { ...base, email: "reg1@example.com", gstNumber: "27AAPFU0939F1ZX" }), "GSTIN");
    const ok = await post("", "/api/admin/register", { ...base, email: "Reg1@Example.com", gstNumber: GOOD_GST.toLowerCase() });
    assert.equal(ok.status, 201, ok.text);
    const stored = await db.collection("adminusers").findOne({ email: "reg1@example.com" });
    assert.equal(stored.contactNumber, "+91 98765 43210");
    assert.equal(stored.gstNumber, GOOD_GST);
  });

  await assertCase("Dealer profile update: contact and GSTIN are enforced", async () => {
    rejects(await api(dealer, "PATCH", "/api/dealer/profile", { contactNumber: "12345" }), "mobile");
    rejects(await api(dealer, "PATCH", "/api/dealer/profile", { gstNumber: "BADGST" }), "GSTIN");
    const ok = await api(dealer, "PATCH", "/api/dealer/profile", { contactNumber: "98765 43210", gstNumber: GOOD_GST });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await db.collection("adminusers").findOne({ _id: 1 })).contactNumber, "+91 98765 43210");
  });

  await assertCase("Admin dealer edit: contact and GSTIN are enforced", async () => {
    rejects(await api(superAdmin, "PATCH", "/api/admin/dealers/1", { contactNumber: "abc" }), "mobile");
    rejects(await api(superAdmin, "PATCH", "/api/admin/dealers/1", { gstNumber: "27AAPFU0939F1ZX" }), "GSTIN");
    const ok = await api(superAdmin, "PATCH", "/api/admin/dealers/1", { contactNumber: "9123456780", gstNumber: GOOD_GST });
    assert.equal(ok.status, 200, ok.text);
  });

  await assertCase("Company settings: email, phone and GSTIN are enforced", async () => {
    const base = { name: "Whyte", phone: "+91 98765 43210", address: "Ahmedabad", email: "info@whyte.co.in", gstNumber: GOOD_GST };
    rejects(await api(superAdmin, "PATCH", "/api/company", { ...base, email: "info@" }), "email");
    rejects(await api(superAdmin, "PATCH", "/api/company", { ...base, phone: "xx" }), "phone");
    rejects(await api(superAdmin, "PATCH", "/api/company", { ...base, gstNumber: "27AAPFU0939F1ZX" }), "GSTIN");
    const ok = await api(superAdmin, "PATCH", "/api/company", base);
    assert.ok([200, 201].includes(ok.status), ok.text);
  });

  if (summary() > 0) process.exitCode = 1;
} catch (error) {
  console.error("SETUP/RUN ERROR:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(process.exitCode ?? 0);
}
