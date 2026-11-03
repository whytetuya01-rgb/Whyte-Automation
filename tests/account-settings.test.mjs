/**
 * My account time zone through the real API (production-mode server + throwaway local MongoDB):
 *   - everyone starts on Asia/Kolkata; a person can choose another zone, go back to the default, and nothing else changes;
 *   - invalid names are refused; only the signed-in person's own setting can be read or changed;
 *   - the choice applies at once (the app's 30-second session cache is NOT switched off here) and decides how the Follow-ups
 *     list splits overdue / today / upcoming for that person, while other people keep their own.
 *
 *   node tests/account-settings.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

const DAY = 24 * 3600 * 1000;
const dateKey = (date, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const dayNumber = (key) => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY);
const expected = (due, now, timeZone) => ({
  bucket: due < now ? "overdue" : dateKey(due, timeZone) === dateKey(now, timeZone) ? "today" : "upcoming",
  dayOffset: dayNumber(dateKey(due, timeZone)) - dayNumber(dateKey(now, timeZone)),
});

try {
  server = await startIsolatedServer("acctz", [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super" },
    { _id: 2, email: "admin@example.com", role: "admin", name: "Admin A", companyId: 10 },
    { _id: 3, email: "other@example.com", role: "admin", name: "Admin Two", companyId: 10 },
    { _id: 4, email: "dealer@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
    { _id: 5, email: "salesexec@example.com", role: "sales_executive", name: "Sam Sales", companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 10, name: "Acme Homes", slug: "c10", status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = {
    admin: await login("admin@example.com", "admin"),
    other: await login("other@example.com", "admin"),
    super: await login("super@example.com", "admin"),
    dealer: await login("dealer@example.com", "user"),
    sales: await login("salesexec@example.com", "user"),
  };
  const get = (cookie) => api(cookie, "GET", "/api/account/settings");
  const patch = (cookie, body) => api(cookie, "PATCH", "/api/account/settings", body);
  const stored = async (id) => (await db.collection("adminusers").findOne({ _id: id })).timeZone;

  // ═══ default ═══
  const first = await get(c.admin);
  assert.equal(first.status, 200, first.text?.slice(0, 200));
  assert.deepEqual(first.data.timeZone, { chosen: null, effective: "Asia/Kolkata", default: "Asia/Kolkata" });
  assert.deepEqual(first.data.profile, { name: "Admin A", email: "admin@example.com", role: "admin" });
  assert.equal(await stored(2), undefined, "nothing is stored until they choose");
  pass("everyone starts on Asia/Kolkata with nothing stored");

  // ═══ choose, normalise, reset ═══
  const ny = await patch(c.admin, { timeZone: "America/New_York" });
  assert.equal(ny.status, 200, ny.text?.slice(0, 200));
  assert.deepEqual(ny.data.timeZone, { chosen: "America/New_York", effective: "America/New_York", default: "Asia/Kolkata" });
  assert.equal(await stored(2), "America/New_York");
  assert.equal((await get(c.admin)).data.timeZone.chosen, "America/New_York");
  assert.equal((await patch(c.admin, { timeZone: "asia/calcutta" })).data.timeZone.chosen, "Asia/Kolkata", "the same zone is always written one way");
  assert.equal((await patch(c.admin, { timeZone: "europe/london" })).data.timeZone.chosen, "Europe/London", "case is corrected");
  const reset = await patch(c.admin, { timeZone: null });
  assert.deepEqual(reset.data.timeZone, { chosen: null, effective: "Asia/Kolkata", default: "Asia/Kolkata" });
  assert.equal(await stored(2), undefined, "back to the default removes the stored value");
  pass("a person can choose a zone, it is written one standard way, and null goes back to the default");

  // ═══ refusals ═══
  await patch(c.admin, { timeZone: "Asia/Dubai" });
  for (const [label, body] of [["unknown zone", { timeZone: "Mars/Olympus" }], ["an offset", { timeZone: "+05:30" }], ["an abbreviation", { timeZone: "IST" }], ["empty", { timeZone: "" }], ["a number", { timeZone: 5 }], ["missing", {}], ["someone else's id", { timeZone: "Asia/Dubai", userId: 3 }], ["another field", { timeZone: "Asia/Dubai", role: "company_owner" }]]) {
    assert.equal((await patch(c.admin, body)).status, 400, label);
  }
  assert.equal((await patch(c.admin, { timeZone: "Mars/Olympus" })).json.error.field, "timeZone");
  assert.equal(await stored(2), "Asia/Dubai", "refused requests changed nothing");
  assert.equal((await db.collection("adminusers").findOne({ _id: 2 })).role, "admin", "and no other field can be changed here");
  pass("unknown zones, offsets, abbreviations, malformed bodies and extra fields are refused and change nothing");

  // ═══ whose setting ═══
  assert.equal((await get(c.other)).data.timeZone.chosen, null, "another person's setting is not affected");
  assert.equal(await stored(3), undefined);
  assert.equal((await get(c.dealer)).status, 403, "dealers have no account page");
  assert.equal((await patch(c.dealer, { timeZone: "Asia/Dubai" })).status, 403);
  assert.equal((await get(c.sales)).status, 403, "Sales Executives have no admin panel");
  assert.equal((await fetch(`${baseUrl}/api/account/settings`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/account/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ timeZone: "Asia/Dubai" }) })).status, 401);
  const superSet = await patch(c.super, { timeZone: "Europe/Paris" });
  assert.equal(superSet.status, 200, superSet.text?.slice(0, 200));
  assert.equal(await stored(1), "Europe/Paris", "the platform Super Admin has a setting too");
  pass("each person reads and changes only their own setting; dealers and Sales Executives have none; signed out is refused");

  // ═══ it decides today / overdue / upcoming, at once ═══
  const stamp = new Date();
  const offsetsHours = [-30, -1, 1, 5, 10, 14, 20, 26, 40, 60];
  await db.collection("leads").insertMany(offsetsHours.map((h, i) => ({
    _id: `ld_tz_${i}`, companyId: 10, referenceNumber: `LD-2026-${6000 + i}`, customerName: `Zone ${h}h`, status: "contacted", priority: "medium",
    createdBy: 2, createdAt: stamp, updatedAt: stamp, nextFollowUpAt: new Date(stamp.getTime() + h * 3600_000),
  })));
  const check = async (cookie, zone) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = new Date();
      const list = await api(cookie, "GET", "/api/crm/follow-ups?pageSize=100");
      const after = new Date();
      assert.equal(list.status, 200, list.text?.slice(0, 200));
      assert.equal(list.data.timeZone, zone, "the list says which zone it used");
      // the clock may have crossed midnight in that zone while asking: try again
      if (dateKey(before, zone) !== dateKey(after, zone)) continue;
      const rows = new Map(list.data.data.map((row) => [row.id, row]));
      const tally = { overdue: 0, today: 0, upcoming: 0 };
      offsetsHours.forEach((h, i) => {
        const want = expected(new Date(stamp.getTime() + h * 3600_000), before, zone);
        const row = rows.get(`ld_tz_${i}`);
        assert.ok(row, `lead ${i} is listed`);
        assert.deepEqual([row.bucket, row.dayOffset], [want.bucket, want.dayOffset], `${zone}: ${h}h from creation`);
        tally[want.bucket] += 1;
      });
      assert.deepEqual(list.data.summary, tally, `${zone}: the tab counts follow the same zone`);
      return;
    }
    assert.fail("the clock kept crossing midnight");
  };
  await check(c.other, "Asia/Kolkata");
  const zones = ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Los_Angeles"];
  const shapes = [];
  for (const zone of zones) {
    assert.equal((await patch(c.admin, { timeZone: zone })).status, 200);
    await check(c.admin, zone); // straight away: the 30-second session cache does not hide the change
    shapes.push(JSON.stringify(offsetsHours.map((h) => expected(new Date(stamp.getTime() + h * 3600_000), new Date(), zone))));
  }
  shapes.push(JSON.stringify(offsetsHours.map((h) => expected(new Date(stamp.getTime() + h * 3600_000), new Date(), "Asia/Kolkata"))));
  assert.ok(new Set(shapes).size > 1, "the zones split the same follow-ups differently, so this test can tell them apart");
  await check(c.other, "Asia/Kolkata"); // and the other person is unaffected
  await patch(c.admin, { timeZone: null });
  await check(c.admin, "Asia/Kolkata");
  pass("the chosen zone decides overdue / today / upcoming and the tab counts for that person only, immediately, and going back to the default restores India");

  console.log(`\nALL ${count} ACCOUNT SETTINGS TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  process.exit(exitCode);
}
