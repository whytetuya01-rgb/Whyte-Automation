/**
 * Offline unit tests for the tenant migration executor's pure logic: target classification, strict argument parsing,
 * plan validation and the crash-safe, hash-chained journal. No database is touched.
 *
 *   node tests/tenant-migration-executor.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Journal, classifyTarget, hostsOf, loopbackOnly, parseArgs, serverIsLocal, validatePlan } from "../scripts/tenant-migration/migrate.mjs";

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };
const throwsMatching = (fn, re) => assert.throws(fn, (e) => re.test(e.message), `expected an error matching ${re}`);

const LOCAL = "mongodb://127.0.0.1:27017/?directConnection=true";

t("loopbackOnly: only exclusively-loopback direct connections pass", () => {
  assert.equal(loopbackOnly(LOCAL), true);
  assert.equal(loopbackOnly("mongodb://localhost:27017/?directConnection=true"), true);
  for (const u of [
    "mongodb://127.0.0.1:27017/",                                        // no directConnection
    "mongodb://127.0.0.1:27017/?directConnection=false",
    "mongodb://127.0.0.1:27017/?directConnection=true&directConnection=false",
    "mongodb://127.0.0.1:27017/?directConnection=false&directConnection=true",
    "mongodb://127.0.0.1:27017/?replicaSet=rs0",
    "mongodb+srv://u:p@cluster0.example.net/x",
    "mongodb://127.0.0.1@evil.example:27017/?directConnection=true",
    "mongodb://127.0.0.1:27017,evil.example:27017/?directConnection=true",
    "mongodb://localhost.evil.com:27017/?directConnection=true",
    "mongodb://LOCALHOST:27017/?directConnection=true",
    "not a uri",
  ]) assert.equal(loopbackOnly(u), false, u);
});

t("classifyTarget: loopback is never enough; the production database and the plan's database are always gated", () => {
  const ok = classifyTarget({ uri: LOCAL, database: "whyte_s_t1", planDatabase: "whyte_quotation" });
  assert.equal(ok.gated, false);
  for (const db of ["whyte_rehearsal_tenant_A", "whyte_audit_x", "whyte_drill_s1", "whyte_test_1", "whyte_backup_verify_20261022"]) assert.equal(classifyTarget({ uri: LOCAL, database: db, planDatabase: "whyte_quotation" }).gated, false, db);
  // a tunnelled production target: loopback URI, production database
  const tunnel = classifyTarget({ uri: "mongodb://127.0.0.1:27018/?directConnection=true", database: "whyte_quotation", planDatabase: "whyte_quotation" });
  assert.equal(tunnel.gated, true);
  assert.ok(tunnel.reasons.some((r) => /production database/.test(r)));
  // other names, other hosts, plan database
  assert.equal(classifyTarget({ uri: LOCAL, database: "whyte_quotation_copy", planDatabase: "whyte_quotation" }).gated, true, "name not on the local-only list");
  assert.equal(classifyTarget({ uri: LOCAL, database: "something", planDatabase: "x" }).gated, true);
  assert.equal(classifyTarget({ uri: LOCAL, database: "whyte_s_t1", planDatabase: "whyte_s_t1" }).gated, true, "the database the plan came from");
  assert.equal(classifyTarget({ uri: "mongodb+srv://u:p@c.example.net/x", database: "whyte_s_t1", planDatabase: "q" }).gated, true);
  assert.equal(classifyTarget({ uri: "mongodb://127.0.0.1:27017/?replicaSet=rs0", database: "whyte_s_t1", planDatabase: "q" }).gated, true);
  assert.equal(classifyTarget({ uri: LOCAL, database: "whyte_s_", planDatabase: "q" }).gated, true, "empty suffix");
  assert.equal(classifyTarget({ uri: LOCAL, database: "whyte_s_a/../whyte_quotation", planDatabase: "q" }).gated, true, "path-like name");
});

t("loopbackOnly: proxy / TLS-file / replica-set URI options never count as a plain local connection", () => {
  for (const o of ["proxyHost=evil.com&proxyPort=1080", "tlsCertificateKeyFile=x", "replicaSet=rs0", "srvServiceName=x", "maxPoolSize=5"]) assert.equal(loopbackOnly(`${LOCAL}&${o}`), false, o);
  assert.equal(loopbackOnly(`${LOCAL}&serverSelectionTimeoutMS=1500&appName=x`), true);
});
t("serverIsLocal: mongos, unreadable hostInfo and a foreign hostInfo hostname are never local", () => {
  assert.equal(serverIsLocal({ msg: "isdbgrid" }, "DESK"), false);
  assert.equal(serverIsLocal({ me: "127.0.0.1:27017", setName: "rs0" }, "DESK", null), false);
  assert.equal(serverIsLocal({ me: "127.0.0.1:27017", setName: "rs0" }, "DESK", "cluster0-shard-00-00.abc.mongodb.net"), false);
  assert.equal(serverIsLocal({ me: "127.0.0.1:27017", setName: "rs0" }, "DESK", "desk"), true);
});
t("serverIsLocal: a tunnel to a remote member is not local", () => {
  assert.equal(serverIsLocal({ me: "127.0.0.1:27017", setName: "rs0" }, "DESK"), true);
  assert.equal(serverIsLocal({ me: "localhost:27017" }, "DESK"), true);
  assert.equal(serverIsLocal({ me: "DESK:27017", setName: "rs0" }, "desk"), true);
  assert.equal(serverIsLocal({ me: "[::1]:27017" }, "DESK"), true);
  assert.equal(serverIsLocal({ isWritablePrimary: true }, "DESK"), true, "standalone: no `me`, no replica set");
  assert.equal(serverIsLocal({ me: "cluster0-shard-00-01.abc12.mongodb.net:27017", setName: "atlas-xyz-shard-0" }, "DESK"), false);
  assert.equal(serverIsLocal({ me: "10.0.0.5:27017", setName: "rs0" }, "DESK"), false);
  assert.equal(serverIsLocal({ setName: "rs0", hosts: ["a:1"] }, "DESK"), false, "a replica set that does not name itself is not trusted");
  assert.equal(serverIsLocal(undefined, "DESK"), false, "no hello at all is never trusted");
  assert.equal(serverIsLocal(null, "DESK"), false);
});

t("hostsOf never exposes credentials", () => {
  assert.equal(hostsOf("mongodb+srv://user:secret@cluster0.example.net/db").includes("secret"), false);
  assert.equal(hostsOf("mongodb+srv://user:secret@cluster0.example.net/db"), "cluster0.example.net");
});

t("parseArgs: unknown flags, --x=y, valueless flags and the removed override flag are rejected", () => {
  assert.equal(parseArgs(["apply", "--database", "d", "--allow-remote"])["allow-remote"], true);
  for (const bad of [["apply", "--nope", "1"], ["apply", "--allow-remote=true"], ["apply", "--database"], ["apply", "--database", "--plan"], ["apply", "stray"], ["apply", "--allow-unapproved-phases"]]) throwsMatching(() => parseArgs(bad), /./);
});

// ───────────── plan validation ─────────────
const names = ["categories", "roomtypes", "housetypes", "housetyperoomtemplates", "products", "productvariants", "productvarianthistories", "adminusers", "quotations", "quotationrooms", "quotationitems", "quotationauditevents", "deletionauditevents"];
const goodPlan = () => ({
  database: "whyte_quotation",
  report: {
    companySlug: "whyte-automations", defaultCompany: { exists: true, id: 1, action: "skip" },
    collections: [...names.map((c) => ({ collection: c, update: 5 })), { collection: "counters", update: 1 }, { collection: "companies", update: 0 }],
    diagnostics: [{ severity: "error", code: "DEFAULT_COMPANY_NOT_ACTIVE" }, { severity: "info", code: "X" }],
  },
  counters: { conflicts: [], entries: [{ counter: "quotationNumber_1_2026", action: "advance", target: 58 }, { counter: "adminUser", action: "keep", target: 26 }] },
});
t("validatePlan accepts the real shape", () => validatePlan(goodPlan(), { database: "whyte_quotation", gated: true }));
t("validatePlan: a gated target must match the plan's own database", () => throwsMatching(() => validatePlan(goodPlan(), { database: "whyte_other", gated: true }), /generated for/));
t("validatePlan: a local rehearsal on another database name is fine", () => validatePlan(goodPlan(), { database: "whyte_s_t1", gated: false }));
for (const [label, mutate, re] of [
  ["missing database", (p) => { delete p.database; }, /database/],
  ["counter of another company", (p) => { p.counters.entries[0].counter = "quotationNumber_2_2026"; }, /not a quotation counter/],
  ["a non-quotation counter being written", (p) => { p.counters.entries[1].action = "advance"; }, /not a quotation counter/],
  ["string counter target", (p) => { p.counters.entries[0].target = "zzz"; }, /bad target/],
  ["negative counter target", (p) => { p.counters.entries[0].target = -1; }, /bad target/],
  ["counter with a leading zero", (p) => { p.counters.entries[0].counter = "quotationNumber_01_2026"; }, /not a quotation counter/],
  ["counter year 0000", (p) => { p.counters.entries[0].counter = "quotationNumber_1_0000"; }, /not a quotation counter/],
  ["duplicate counter entry", (p) => { p.counters.entries.push({ counter: "quotationNumber_1_2026", action: "advance", target: 999999 }); }, /appears twice/],
  ["huge counter target", (p) => { p.counters.entries[0].target = 99999999; }, /bad target/],
  ["fractional counter target", (p) => { p.counters.entries[0].target = 5.5; }, /bad target/],
  ["counter conflict error", (p) => { p.counters.conflicts = [{ severity: "error", code: "COUNTER_X" }]; }, /conflicts/],
  ["conflicts missing", (p) => { delete p.counters.conflicts; }, /conflicts/],
  ["negative update", (p) => { p.report.collections[0].update = -1; }, /bad collection entry/],
  ["string update", (p) => { p.report.collections[0].update = "5"; }, /bad collection entry/],
  ["duplicate collection", (p) => { p.report.collections.push({ collection: "products", update: 1 }); }, /twice/],
  ["missing collection", (p) => { p.report.collections = p.report.collections.filter((c) => c.collection !== "quotations"); }, /no entry for quotations/],
  ["update in a collection the tool does not handle", (p) => { p.report.collections.push({ collection: "roledefinitions", update: 2 }); }, /does not perform/],
  ["extra blocking diagnostic", (p) => { p.report.diagnostics.push({ severity: "error", code: "ORPHAN" }); }, /blocking diagnostics/],
  ["no blocking diagnostic at all", (p) => { p.report.diagnostics = []; }, /blocking diagnostics/],
  ["wrong company id", (p) => { p.report.defaultCompany.id = 2; }, /defaultCompany/],
  ["not an object", (p) => { p.report = null; }, /report/],
]) t(`validatePlan rejects: ${label}`, () => { const p = goodPlan(); mutate(p); throwsMatching(() => validatePlan(p, { database: "whyte_quotation", gated: true }), re); });

// ───────────── journal ─────────────
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "whyte-journal-"));
const fill = (dir, n = 4) => { const j = new Journal(dir); for (let i = 1; i <= n; i += 1) j.append({ step: `data:c${i}`, kind: i % 2 ? "intent" : "done" }); return j; };
const lines = (dir) => fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8").split("\n");

t("journal: chain verifies, seq is gapless, intent/done/inflight work", () => {
  const d = tmp(); const j = new Journal(d);
  j.append({ step: "data:a", kind: "intent" }); assert.equal(j.inflight("data:a"), true);
  j.append({ step: "data:a", kind: "done" }); assert.equal(j.inflight("data:a"), false); assert.equal(j.done("data:a"), true);
  const s = j.scan(); assert.deepEqual(s.records.map((r) => r.seq), [1, 2]); assert.equal(s.torn, false);
});
t("journal: a torn FINAL record (power loss mid-append) is discarded, never an error, and appends continue the chain", () => {
  const d = tmp(); const j = fill(d, 4); const f = path.join(d, "journal.jsonl");
  const full = fs.readFileSync(f); const lastNl = full.lastIndexOf("\n", full.length - 2);
  fs.writeFileSync(f, full.subarray(0, lastNl + 1 + 40)); // cut the 4th record after 40 bytes
  const s = j.scan(); assert.equal(s.torn, "partial"); assert.equal(s.records.length, 3);
  assert.equal(j.done("data:c4"), false, "the torn 'done' is simply not recorded");
  assert.equal(j.inflight("data:c3"), true, "so the step stays in flight and recovery will re-verify it against the database");
  j.append({ step: "data:c4", kind: "done" }); // repairs the tail first
  const s2 = j.scan(); assert.equal(s2.torn, false); assert.equal(s2.records.length, 4); assert.deepEqual(s2.records.map((r) => r.seq), [1, 2, 3, 4]);
  assert.equal(lines(d).filter(Boolean).length, 4, "no garbage line left in the file");
});
t("journal: a complete final record that only lost its newline is accepted, not dropped", () => {
  const d = tmp(); const j = fill(d, 3); const f = path.join(d, "journal.jsonl");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\n$/, ""));
  const s = j.scan(); assert.equal(s.torn, "no-newline"); assert.equal(s.records.length, 3);
  j.append({ step: "x", kind: "info" }); assert.equal(j.scan().records.length, 4);
});
t("journal: interior corruption is rejected (garbage line)", () => {
  const d = tmp(); const j = fill(d, 5); const L = lines(d); L[2] = "{ not json"; fs.writeFileSync(path.join(d, "journal.jsonl"), L.join("\n"));
  throwsMatching(() => j.scan(), /line 3 is corrupt/); throwsMatching(() => j.entries(), /corrupt/); throwsMatching(() => j.append({ step: "x", kind: "info" }), /corrupt/);
});
t("journal: an edited record fails its integrity hash", () => {
  const d = tmp(); const j = fill(d, 5); const L = lines(d); L[1] = L[1].replace('"kind":"done"', '"kind":"info"'); fs.writeFileSync(path.join(d, "journal.jsonl"), L.join("\n"));
  throwsMatching(() => j.scan(), /line 2/);
});
t("journal: a deleted record (sequence gap / broken chain) is rejected", () => {
  const d = tmp(); const j = fill(d, 5); const L = lines(d); L.splice(2, 1); fs.writeFileSync(path.join(d, "journal.jsonl"), L.join("\n"));
  throwsMatching(() => j.scan(), /line 3/);
});
t("journal: swapped records and a truncated head are rejected", () => {
  const d = tmp(); const j = fill(d, 5); const L = lines(d); [L[1], L[2]] = [L[2], L[1]]; fs.writeFileSync(path.join(d, "journal.jsonl"), L.join("\n"));
  throwsMatching(() => j.scan(), /line 2/);
  const d2 = tmp(); const j2 = fill(d2, 5); const L2 = lines(d2); L2.shift(); fs.writeFileSync(path.join(d2, "journal.jsonl"), L2.join("\n"));
  throwsMatching(() => j2.scan(), /line 1/);
});
t("journal: a corrupt record followed by a valid-looking torn tail is still rejected (only the very last record may be torn)", () => {
  const d = tmp(); const j = fill(d, 4); const L = lines(d); L[1] = L[1].slice(0, 30); fs.writeFileSync(path.join(d, "journal.jsonl"), L.join("\n"));
  throwsMatching(() => j.scan(), /line 2/);
});
t("journal: a rollback record resets what counts as done, but the chain stays intact", () => {
  const d = tmp(); const j = new Journal(d);
  j.append({ step: "data:a", kind: "intent" }); j.append({ step: "data:a", kind: "done" }); j.append({ step: "rollback", kind: "done" });
  assert.equal(j.done("data:a"), false); assert.equal(j.entries().length, 0);
  j.append({ step: "data:a", kind: "intent" }); assert.equal(j.inflight("data:a"), true); assert.equal(j.scan().records.length, 4);
});
t("journal: hasDataWrites ignores counter/prestate records (a counters-only run is not a data write)", () => {
  const d = tmp(); const j = new Journal(d);
  j.append({ step: "prestate", kind: "info", sha: "x" }); j.append({ step: "counter:q", kind: "intent" }); j.append({ step: "counter:q", kind: "done" }); j.append({ step: "counters", kind: "done" });
  assert.equal(j.hasDataWrites(), false);
  j.append({ step: "data:products", kind: "intent" }); assert.equal(j.hasDataWrites(), true);
});
t("journal: an entry may not use the chain's own field names (a counter 'prev' value once broke the hash)", () => {
  const d = tmp(); const j = new Journal(d);
  for (const k of ["prev", "hash", "seq", "at", "runId"]) throwsMatching(() => j.append({ step: "counter:x", kind: "intent", [k]: 1 }), /reserved key/);
  j.append({ step: "counter:x", kind: "intent", before: 3, after: 58, target: 58 }); assert.equal(j.scan().records.length, 1);
});
t("journal: read-only scan never modifies the file", () => {
  const d = tmp(); const j = fill(d, 3); const f = path.join(d, "journal.jsonl"); fs.appendFileSync(f, '{"torn":');
  const before = fs.readFileSync(f); j.scan(); j.entries(); assert.deepEqual(fs.readFileSync(f), before);
});

console.log(`\n${passed} checks passed.`);
