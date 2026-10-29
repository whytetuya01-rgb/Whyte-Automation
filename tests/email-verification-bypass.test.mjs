/**
 * Owner email verification is information only by default (REQUIRE_OWNER_EMAIL_VERIFICATION unset): until the
 * sending domain's DNS records exist, a Super Admin can approve a self-registered company whose owner has not opened
 * the verification link, and the review list says so. The gate itself (switch on) is covered by
 * tests/company-onboarding.test.mjs and tests/company-registration.browser.mjs.
 *
 *   node tests/email-verification-bypass.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PASSWORD = "Str0ng!Passw0rd";
let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  const envExample = readFileSync(join(root, ".env.example"), "utf8");
  assert.match(envExample, /REQUIRE_OWNER_EMAIL_VERIFICATION="false"/, "the switch is documented, off");
  const page = readFileSync(join(root, "src", "app", "admin", "(panel)", "companies", "page.tsx"), "utf8");
  assert.ok(/disabled=\{busyId !== null \|\| item\.approvalWaitsForVerification\}/.test(page), "Approve is held back only while the gate is on");
  pass("static guards: the switch is documented (off) and the Approve button follows it");

  delete process.env.REQUIRE_OWNER_EMAIL_VERIFICATION;
  server = await startIsolatedServer("verify-bypass", [{ _id: 1, email: "super@example.com", role: "super_admin", name: "Super" }], { production: true });
  const { db, login, api, baseUrl } = server;
  await db.collection("counters").insertMany([{ _id: "adminUser", seq: 50 }, { _id: "company", seq: 50 }]);
  const superCookie = await login("super@example.com", "admin");

  const body = new FormData();
  for (const [k, v] of Object.entries({ companyName: "Bypass Co", companyEmail: "info@bypass.example", companyPhone: "+91 98765 43210", companyAddress: "12 Main Street, Ahmedabad", ownerName: "Owner Bypass", ownerEmail: "owner@bypass.example", ownerPhone: "9876543210", password: PASSWORD, confirmPassword: PASSWORD })) body.append(k, v);
  const registered = await fetch(`${baseUrl}/api/company/register`, { method: "POST", body });
  assert.equal(registered.status, 201, await registered.text());
  const row = await db.collection("companies").findOne({ name: "Bypass Co" });
  assert.equal(row.registrationStatus, "pending_review");
  assert.equal(row.ownerEmailVerification?.verifiedAt ?? null, null, "the owner has not verified the email");

  const listed = (await api(superCookie, "GET", "/api/platform/company-registrations?status=pending_review")).data.items.find((item) => item.id === row._id);
  assert.equal(listed.ownerEmailVerified, false, "the list still shows the email as not verified");
  assert.equal(listed.approvalWaitsForVerification, false, "but approval is not held back");

  const approved = await api(superCookie, "POST", `/api/platform/company-registrations/${row._id}/approve`);
  assert.ok(approved.status < 300, `approve: ${approved.status} ${approved.text.slice(0, 200)}`);
  assert.equal((await db.collection("companies").findOne({ _id: row._id })).registrationStatus, "approved");
  pass("with the switch off, an unverified self-registration can be approved; the list still shows 'not verified'");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(["--- server output (tail) ---", server.getOutput().slice(-2000)].join(String.fromCharCode(10)));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
