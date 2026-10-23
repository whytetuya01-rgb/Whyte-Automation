#!/usr/bin/env node
/**
 * Whyte tenant migration: assign legacy (companyId missing/null) business records to Company 1.
 *
 *   node scripts/tenant-migration/migrate.mjs <check|apply|verify|rollback> --plan plan.json --database NAME \
 *        --journal-dir DIR [--phases data,counters] [remote gates...]
 *
 * WHAT IT NEVER DOES: delete, insert (other than its own lock document), merge, reseed, change prices/totals/snapshots/
 * soft-delete fields, activate a company, change account roles or indexes on a production target, or disable the tenant
 * plugin. It writes nothing unless run as `apply` (or `rollback`).
 *
 * SAFETY MODEL
 *  - The connection string comes ONLY from WHYTE_MIGRATION_URI (never from .env).
 *  - A target is "local" only if ALL hold: every host in the URI is loopback with directConnection=true, the database
 *    name is on the local-only list (whyte_rehearsal_*, whyte_audit_*, whyte_drill_*, whyte_s_*, whyte_test_*,
 *    whyte_backup_verify_*), it is not the production name `whyte_quotation` and not the plan's own database, AND the
 *    connected server identifies itself as this machine (hello.me). A tunnel to production fails the last test even
 *    though its URI says 127.0.0.1. Everything else is "gated".
 *  - Gated targets need --allow-remote, --confirm-database <name> (= --database = plan.database),
 *    --approved-plan-sha256, --backup-archive and --approved-backup-sha256 for apply AND rollback, and are limited to
 *    the approved phases `data,counters` (no override exists). Hashes are checked against the bytes actually used.
 *  - The plan is validated field by field. All preconditions of every phase are checked BEFORE the snapshot and before
 *    the first write. The snapshot is bound to database + host + plan + the database INSTANCE (collection UUIDs), its
 *    hash is journalled, and a snapshot is only reused once data writes started. Writes are bounded to its ids.
 *  - The journal is a hash chain: a torn FINAL record (never acknowledged) is discarded; interior corruption or a
 *    hash mismatch is rejected. Steps marked done are re-verified against the database, never trusted.
 *  - A database lock document (heartbeat, stale takeover) stops concurrent executors even from different machines or
 *    journal directories; it is re-checked before every write. A local lock file adds a second layer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MongoClient, BSON } from "mongodb";

const { EJSON } = BSON;
const COMPANY_ID = 1;
const PROD_DB = "whyte_quotation";
const LOCAL_DB_NAME = /^whyte_(rehearsal|audit|drill|s|test|backup_verify)_[A-Za-z0-9_\-]+$/;
const COUNTER_NAME = /^quotationNumber_([1-9]\d*)_(20\d\d)$/;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MISSING = { $or: [{ companyId: { $exists: false } }, { companyId: null }] };
/** Parent-first. Super Admins (platform accounts) are exempt from ownership by filter. */
export const DATA = [
  ["categories", MISSING],
  ["roomtypes", MISSING],
  ["housetypes", MISSING],
  ["housetyperoomtemplates", MISSING],
  ["products", MISSING],
  ["productvariants", MISSING],
  ["productvarianthistories", MISSING],
  ["adminusers", { $and: [MISSING, { role: { $ne: "super_admin" } }] }],
  ["quotations", MISSING],
  ["quotationrooms", MISSING],
  ["quotationitems", MISSING],
  ["quotationauditevents", MISSING],
  ["deletionauditevents", MISSING],
];
const INDEXES = {
  quotations: { drop: { name: "quotationNumber_1", key: { quotationNumber: 1 }, unique: true }, keep: { name: "companyId_1_quotationNumber_1", key: { companyId: 1, quotationNumber: 1 }, unique: true }, over: ["companyId", "quotationNumber"] },
  roledefinitions: { drop: { name: "key_1", key: { key: 1 }, unique: true }, keep: { name: "companyId_1_key_1", key: { companyId: 1, key: 1 }, unique: true }, over: ["companyId", "key"] },
};
const BOOLEAN_FLAGS = new Set(["allow-remote", "confirm-rollback", "force-after-activation"]);
const VALUE_FLAGS = new Set(["plan", "database", "journal-dir", "phases", "convert-admins", "platform-admin", "confirm-database", "approved-plan-sha256", "backup-archive", "approved-backup-sha256"]);
const APPROVED_REMOTE_PHASES = new Set(["data", "counters"]);
const LOCK_COLL = "__tenant_migration_lock", LOCK_ID = "tenant-backfill-v1", LOCK_STALE_MS = 120_000, LOCK_BEAT_MS = 10_000;

// ───────────────────────── pure helpers (exported for tests) ─────────────────────────
const die = (msg) => { throw new Error(msg); };
const sha256 = (x) => crypto.createHash("sha256").update(x).digest("hex");
const redact = (s) => String(s).replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>");
const fileShaStream = (f) => new Promise((resolve, reject) => {
  const h = crypto.createHash("sha256");
  fs.createReadStream(f).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
});

/** Parses argv strictly: unknown flags, `--x=y` forms and missing values are errors. */
export function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const o = { mode };
  for (let i = 0; i < rest.length; i += 1) {
    if (!rest[i].startsWith("--")) die(`unexpected argument ${rest[i]}`);
    const k = rest[i].slice(2);
    if (BOOLEAN_FLAGS.has(k)) { o[k] = true; continue; }
    if (!VALUE_FLAGS.has(k)) die(`unknown flag --${k}`);
    const v = rest[i + 1];
    if (v === undefined || v.startsWith("--")) die(`--${k} needs a value`);
    o[k] = v; i += 1;
  }
  return o;
}

/** URI-level loopback test. Necessary, NEVER sufficient: a tunnel to production is loopback at this level. */
export function loopbackOnly(uri) {
  if (uri.startsWith("mongodb+srv")) return false;
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)(?:\/[^?]*)?(?:\?(.*))?$/.exec(uri);
  if (!m) return false;
  const q = (m[2] ?? "").split("&").filter(Boolean);
  const ALLOWED_OPTIONS = new Set(["directconnection", "serverselectiontimeoutms", "connecttimeoutms", "sockettimeoutms", "appname", "authsource"]);
  if (q.some((p) => !ALLOWED_OPTIONS.has(p.split("=")[0].toLowerCase()))) return false; // proxyHost, tls*File, replicaSet... never count as a plain local connection
  const dc = q.filter((p) => p.toLowerCase().startsWith("directconnection="));
  if (dc.length !== 1 || dc[0].toLowerCase() !== "directconnection=true") return false; // present exactly once and true
  return m[1].split(",").every((h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h));
}
export const hostsOf = (uri) => (/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri) ?? [])[1] ?? "?";

/**
 * Decides whether a target is local or gated BEFORE connecting. Local needs a loopback URI AND a local-only database
 * name that is neither the production database nor the plan's database. Everything else is gated.
 */
export function classifyTarget({ uri, database, planDatabase }) {
  const reasons = [];
  if (!loopbackOnly(uri)) reasons.push("the URI is not an exclusively-loopback direct connection");
  if (database === PROD_DB) reasons.push(`'${PROD_DB}' is the production database`);
  if (planDatabase && database === planDatabase) reasons.push("it is the database the plan was generated from");
  if (!LOCAL_DB_NAME.test(database)) reasons.push("the name is not on the local-only list");
  return { gated: reasons.length > 0, reasons };
}

/** hello.me names the server as it knows itself. A tunnel to Atlas reports its *.mongodb.net member, not this machine. */
export function serverIsLocal(hello, hostname = os.hostname(), hostInfoName) {
  if (!hello || typeof hello !== "object") return false;
  if (hello.msg === "isdbgrid") return false; // a mongos (sharded / many hosted clusters) is never "this machine"
  if (hostInfoName === null) return false; // hostInfo could not be read: not provably local
  if (typeof hostInfoName === "string" && hostInfoName.toLowerCase() !== String(hostname).toLowerCase()) return false;
  const me = String(hello.me ?? "");
  if (!me) return !hello?.setName && !hello?.hosts; // standalone servers do not report `me`
  const host = me.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === String(hostname).toLowerCase();
}

/** Field-by-field validation of plan.json. Throws on anything unexpected; returns nothing. */
export function validatePlan(plan, { database, gated }) {
  const bad = (m) => die(`plan.json invalid: ${m}`);
  if (!plan || typeof plan !== "object") bad("not an object");
  if (typeof plan.database !== "string" || !plan.database) bad("missing 'database'");
  if (gated && plan.database !== database) bad(`it was generated for '${plan.database}', not '${database}'`);
  const r = plan.report;
  if (!r || typeof r !== "object") bad("missing 'report'");
  if (typeof r.companySlug !== "string" || !r.companySlug) bad("missing companySlug");
  if (r.defaultCompany?.id !== COMPANY_ID) bad(`defaultCompany.id must be ${COMPANY_ID}`);
  if (!Array.isArray(r.collections)) bad("collections is not a list");
  const seen = new Set();
  for (const c of r.collections) {
    if (typeof c?.collection !== "string" || !Number.isSafeInteger(c.update) || c.update < 0) bad(`bad collection entry ${JSON.stringify(c)?.slice(0, 80)}`);
    if (seen.has(c.collection)) bad(`collection ${c.collection} appears twice`);
    seen.add(c.collection);
  }
  for (const [name] of DATA) if (!seen.has(name)) bad(`no entry for ${name}`);
  const covered = new Set([...DATA.map(([c]) => c), "counters"]);
  const stray = r.collections.filter((c) => !covered.has(c.collection) && c.update > 0);
  if (stray.length) bad(`it wants updates this tool does not perform: ${stray.map((c) => `${c.collection}=${c.update}`).join(", ")}`);
  if (!Array.isArray(r.diagnostics)) bad("diagnostics is not a list");
  const errs = r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
  if (JSON.stringify(errs) !== JSON.stringify(["DEFAULT_COMPANY_NOT_ACTIVE"])) bad(`unexpected blocking diagnostics: ${errs.join(",") || "(none)"}`);
  const cs = plan.counters;
  if (!cs || !Array.isArray(cs.entries) || !Array.isArray(cs.conflicts)) bad("counters.entries / counters.conflicts missing");
  const conflictErrors = cs.conflicts.filter((c) => c?.severity !== "info" && c?.severity !== "warning");
  if (conflictErrors.length) bad(`counter plan has conflicts: ${conflictErrors.map((c) => c?.code ?? "?").join(",")}`);
  const names = cs.entries.map((e) => e?.counter);
  if (new Set(names).size !== names.length) bad("a counter appears twice");
  for (const e of cs.entries) {
    if (typeof e?.counter !== "string" || !["create", "advance", "keep"].includes(e.action)) bad(`bad counter entry ${JSON.stringify(e)?.slice(0, 80)}`);
    if (e.action === "create" || e.action === "advance") {
      const m = COUNTER_NAME.exec(e.counter);
      if (!m || Number(m[1]) !== COMPANY_ID) bad(`counter '${e.counter}' is not a quotation counter of company ${COMPANY_ID}`);
      if (!Number.isSafeInteger(e.target) || e.target < 0 || e.target > 1_000_000) bad(`counter '${e.counter}' has a bad target`);
    }
  }
}

/** Hash-chained, crash-safe journal. A torn final record is discarded; interior corruption is rejected. */
export class Journal {
  constructor(dir) { this.file = path.join(dir, "journal.jsonl"); this.runId = crypto.randomBytes(6).toString("hex"); }
  static hashOf(prev, body) { return sha256(`${prev}\n${JSON.stringify(body)}`); }
  /** Reads and verifies the whole chain. Returns every valid record plus where valid data ends. */
  scan() {
    if (!fs.existsSync(this.file)) return { records: [], validBytes: 0, torn: false, size: 0 };
    const buf = fs.readFileSync(this.file);
    const text = buf.toString("utf8");
    const parts = text.split("\n");
    const tail = parts.pop(); // "" when the file ends with a newline, else an unterminated (possibly torn) last record
    const records = [];
    let prev = "0".repeat(64), offset = 0;
    const accept = (line, lineNo) => {
      let rec;
      try { rec = JSON.parse(line); } catch { return false; }
      const { prev: p, hash, ...body } = rec;
      if (p !== prev || hash !== Journal.hashOf(p, body) || body.seq !== records.length + 1) return false;
      records.push(rec); prev = hash; return true;
    };
    for (let i = 0; i < parts.length; i += 1) {
      if (!accept(parts[i], i + 1)) die(`journal line ${i + 1} is corrupt or fails its integrity check: refusing to continue (interior corruption is never ignored)`);
      offset += Buffer.byteLength(parts[i]) + 1;
    }
    let torn = false;
    if (tail) {
      if (accept(tail, parts.length + 1)) { offset += Buffer.byteLength(tail); torn = "no-newline"; } // complete record, newline lost
      else torn = "partial"; // a record that was never acknowledged: safe to discard
    }
    return { records, validBytes: offset, torn, size: buf.length, lastHash: prev };
  }
  /** Truncates a torn tail (or adds the lost newline) so the next append starts on a clean boundary. */
  repair() {
    const s = this.scan();
    if (s.torn === "partial") { const fd = fs.openSync(this.file, "r+"); try { fs.ftruncateSync(fd, s.validBytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    else if (s.torn === "no-newline") { const fd = fs.openSync(this.file, "a"); try { fs.writeSync(fd, "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    return this.scan();
  }
  append(entry) {
    for (const k of ["prev", "hash", "seq", "at", "runId"]) if (k in entry) die(`journal entry uses the reserved key '${k}'`);
    const s = this.repair();
    const body = { seq: s.records.length + 1, at: new Date().toISOString(), runId: this.runId, ...entry };
    const prev = s.records.length ? s.records.at(-1).hash : "0".repeat(64);
    const line = JSON.stringify({ prev, hash: Journal.hashOf(prev, body), ...body }) + "\n";
    const created = !fs.existsSync(this.file);
    const fd = fs.openSync(this.file, "a", 0o600);
    try { fs.writeSync(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (created) { try { const dfd = fs.openSync(path.dirname(this.file), "r"); fs.fsyncSync(dfd); fs.closeSync(dfd); } catch { /* not available on every platform */ } }
  }
  /** Valid records since the last completed rollback (a rollback resets what counts as done). */
  entries() {
    const all = this.scan().records;
    let from = 0;
    all.forEach((e, i) => { if (e.step === "rollback" && e.kind === "done") from = i + 1; });
    return all.slice(from);
  }
  done(step) { return this.entries().some((e) => e.step === step && e.kind === "done"); }
  /** Intent journalled but never completed: the process died (or lost the connection) around that write. */
  inflight(step) { const e = this.entries(); return e.some((x) => x.step === step && x.kind === "intent") && !e.some((x) => x.step === step && x.kind === "done"); }
  hasDataWrites() { return this.entries().some((e) => String(e.step).startsWith("data:") && (e.kind === "intent" || e.kind === "done")); }
  anyStep(prefix) { return this.entries().some((e) => String(e.step).startsWith(prefix)); }
}

const stripFor = (coll, convertedIds) => (doc) => {
  const { companyId, ...rest } = doc; // eslint-disable-line no-unused-vars
  if (coll === "adminusers" && convertedIds.has(doc._id)) { delete rest.role; delete rest.permissions; }
  return rest;
};
async function digestOf(db, coll, filter, transform = (d) => d) {
  const h = crypto.createHash("sha256");
  let n = 0;
  for await (const d of db.collection(coll).find(filter).sort({ _id: 1 })) { h.update(EJSON.stringify(transform(d), { relaxed: false })); h.update("\n"); n += 1; }
  return { n, sum: h.digest("hex") };
}
const NOT_OURS = { companyId: { $nin: [null, COMPANY_ID] } }; // records already owned by ANOTHER company
const idsOf = (p) => [...p.missingIds, ...p.nullIds];

/** Proves that a collection's snapshot ids are all stamped with company 1 and that their content is unchanged. */
async function landed(db, coll, p, conv) {
  const ids = idsOf(p);
  if (ids.length === 0) return true;
  const owned = await db.collection(coll).countDocuments({ _id: { $in: ids }, companyId: COMPANY_ID });
  if (owned !== ids.length) return false;
  return (await digestOf(db, coll, { _id: { $in: ids } }, stripFor(coll, conv))).sum === p.idsDigest;
}

/** Identifies the database INSTANCE (collection UUIDs change on restore/recreate), so a snapshot of one cannot be used on another. */
async function dbFingerprint(db) {
  const names = new Set([...DATA.map(([c]) => c), "counters", "companies"]);
  const cols = (await db.listCollections({}, { nameOnly: false }).toArray()).filter((c) => names.has(c.name));
  return sha256(JSON.stringify(cols.map((c) => [c.name, (() => { try { return c.info?.uuid?.toString("hex") ?? String(c.info?.uuid); } catch { return "?"; } })()]).sort()));
}

// ───────────────────────── configuration and gates ─────────────────────────
async function loadConfig(args) {
  if (!["check", "apply", "verify", "rollback"].includes(args.mode)) die("usage: migrate.mjs <check|apply|verify|rollback> --plan plan.json --database NAME --journal-dir DIR [options]");
  const uri = process.env.WHYTE_MIGRATION_URI;
  if (!uri) die("WHYTE_MIGRATION_URI is not set (this tool never reads the application's .env)");
  if (!args.database) die("--database is required");
  const phases = new Set(String(args.phases ?? "data").split(",").map((s) => s.trim()).filter(Boolean));
  if (phases.size === 0) die("--phases is empty");
  for (const p of phases) if (!["data", "counters", "accounts", "indexes"].includes(p)) die(`unknown phase '${p}'`);
  const convert = args["convert-admins"] ? String(args["convert-admins"]).split(",").map((s) => Number(s)) : [];
  if (convert.some((n) => !Number.isInteger(n) || n <= 0)) die("--convert-admins must be a comma list of numeric ids");
  if (phases.has("accounts") && convert.length === 0) die("phase 'accounts' needs --convert-admins <ids>");
  if (convert.length && !phases.has("accounts")) die("--convert-admins is only valid together with the 'accounts' phase");
  const platformAdminId = Number(args["platform-admin"] ?? 5);
  if (!Number.isInteger(platformAdminId) || platformAdminId <= 0) die("--platform-admin must be a numeric id");
  if (convert.includes(platformAdminId)) die(`refusing to convert the platform Super Admin (id ${platformAdminId})`);
  if (!args["journal-dir"]) die("--journal-dir is required");
  fs.mkdirSync(path.resolve(args["journal-dir"]), { recursive: true });
  const dir = fs.realpathSync.native(path.resolve(args["journal-dir"])); // native: expands 8.3 short names and aliases on Windows
  const repo = fs.realpathSync.native(REPO_ROOT);
  if ((dir + path.sep).toLowerCase().startsWith((repo + path.sep).toLowerCase())) die("--journal-dir must be OUTSIDE the git repository");
  let planBytes = null, plan = null;
  if (["check", "apply", "rollback"].includes(args.mode) || args.plan) {
    if (!args.plan) die("--plan plan.json is required");
    planBytes = fs.readFileSync(args.plan);          // hash and parse the SAME bytes
    plan = JSON.parse(planBytes.toString("utf8"));
  }
  const cls = classifyTarget({ uri, database: args.database, planDatabase: plan?.database });
  const gated = cls.gated;
  if (gated && args["allow-remote"] !== true) die(`gated target (${cls.reasons.join("; ")}): needs --allow-remote and the other gates`);
  if (plan) validatePlan(plan, { database: args.database, gated });
  if (gated) {
    if (args.mode === "apply" || args.mode === "rollback") await remoteGates(args, planBytes);
    if (args.mode === "apply" || args.mode === "rollback") {
      const unapproved = [...phases].filter((p) => !APPROVED_REMOTE_PHASES.has(p));
      if (unapproved.length) die(`phase(s) ${unapproved.join(",")} are not approved for a gated target (approved scope: data,counters); there is no override`);
    }
    if (args["platform-admin"] && platformAdminId !== 5) die("--platform-admin cannot be changed on a gated target");
  }
  return { uri, database: args.database, phases, convert, platformAdminId, dir, plan, planSha: planBytes ? sha256(planBytes) : null, gated, reasons: cls.reasons, args };
}

async function remoteGates(args, planBytes) {
  const missing = ["confirm-database", "approved-plan-sha256", "backup-archive", "approved-backup-sha256"].filter((k) => !args[k]);
  if (missing.length) die(`gated target refused. Missing: ${missing.map((m) => "--" + m).join(", ")}`);
  if (args["confirm-database"] !== args.database) die("--confirm-database does not equal --database");
  if (!planBytes) die("--plan is required");
  if (sha256(planBytes) !== args["approved-plan-sha256"]) die("plan.json does not match --approved-plan-sha256: the reviewed plan is not the plan being applied");
  if (!fs.existsSync(args["backup-archive"])) die("--backup-archive file not found");
  if ((await fileShaStream(args["backup-archive"])) !== args["approved-backup-sha256"]) die("backup archive SHA-256 does not match --approved-backup-sha256");
}

const expectedUpdates = (plan) => Object.fromEntries(plan.report.collections.map((c) => [c.collection, c.update]));

async function gates(db, cfg, say) {
  const company = await db.collection("companies").findOne({ _id: COMPANY_ID });
  if (!company || company.slug !== cfg.plan.report.companySlug) die("company 1 is missing or its slug differs from the plan");
  if (company.status !== "pending") die(`company 1 status is '${company.status}'; this migration expects 'pending' and never changes it`);
  say(`GATE company 1 '${company.slug}' exists, status pending (left untouched)`);
  const platform = await db.collection("adminusers").findOne({ _id: cfg.platformAdminId });
  if (!platform || platform.role !== "super_admin" || (platform.companyId !== undefined && platform.companyId !== null)) die(`platform admin ${cfg.platformAdminId} must be a Super Admin without a company`);
  say(`GATE platform Super Admin ${cfg.platformAdminId} has no company (never converted)`);
  const exp = expectedUpdates(cfg.plan);
  const states = {};
  for (const [coll, filter] of DATA) states[coll] = { remaining: await db.collection(coll).countDocuments(filter), total: await db.collection(coll).countDocuments({}), expected: exp[coll] };
  return { company, states };
}

// ───────────────────────── database lock ─────────────────────────
async function acquireDbLock(db, journal, say) {
  const coll = db.collection(LOCK_COLL);
  const owner = `${os.hostname()}:${process.pid}:${journal.runId}`;
  const stamp = () => new Date();
  try {
    await coll.insertOne({ _id: LOCK_ID, owner, startedAt: stamp(), heartbeat: stamp() });
  } catch (e) {
    if (e.code !== 11000) throw e;
    const cur = await coll.findOne({ _id: LOCK_ID });
    const age = cur ? Date.now() - new Date(cur.heartbeat).getTime() : Infinity;
    if (cur && !Number.isFinite(age)) die("the database lock document is malformed (no valid heartbeat); remove it by hand once no executor is running");
    // an owner on THIS machine whose process no longer exists cannot be running: take over at once; anyone else must go silent for LOCK_STALE_MS
    const [ownerHost, ownerPid] = String(cur?.owner ?? "").split(":");
    let ownerDead = false;
    if (cur && ownerHost === os.hostname() && /^\d+$/.test(ownerPid ?? "")) { try { process.kill(Number(ownerPid), 0); } catch (e) { ownerDead = e.code === "ESRCH"; } }
    if (cur && age < LOCK_STALE_MS && !ownerDead) die(`another migration executor holds the database lock (${cur.owner}, last heartbeat ${Math.round(age / 1000)}s ago). Only one may run, from any machine.`);
    if (!cur) die("the database lock vanished while acquiring it; retry");
    const took = await coll.findOneAndUpdate({ _id: LOCK_ID, owner: cur.owner, heartbeat: cur.heartbeat }, { $set: { owner, startedAt: stamp(), heartbeat: stamp() } });
    if (!took) die("lost the race for a stale database lock; retry");
    say(`LOCK   took over a stale database lock (${cur.owner}, ${ownerDead ? "its process no longer exists" : `silent for ${Math.round(age / 1000)}s`})`);
  }
  const timer = setInterval(() => { coll.updateOne({ _id: LOCK_ID, owner }, { $set: { heartbeat: stamp() } }).catch(() => {}); }, LOCK_BEAT_MS);
  timer.unref();
  return {
    /** Re-checked before EVERY write: if someone else owns the lock now, nothing further is written. */
    async assertHeld() { const cur = await coll.findOne({ _id: LOCK_ID }); if (!cur || cur.owner !== owner) die("the database lock is no longer held by this run: stopping before any further write"); },
    async release() {
      clearInterval(timer);
      await coll.deleteOne({ _id: LOCK_ID, owner }).catch(() => {});
      if ((await coll.countDocuments({}).catch(() => 1)) === 0) await coll.drop().catch(() => {}); // leave no trace behind
    },
  };
}

// ───────────────────────── snapshot (bound to this run and this database instance) ─────────────────────────
const identityOf = (cfg) => ({ database: cfg.database, hostHash: sha256(hostsOf(cfg.uri)), planSha: cfg.planSha });
function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { const dfd = fs.openSync(path.dirname(file), "r"); fs.fsyncSync(dfd); fs.closeSync(dfd); } catch { /* directory fsync is not available everywhere */ }
}

/** Loads prestate.json and checks it against the journal (its hash was journalled) and this run. Returns null when absent. */
function loadPrestate(cfg, journal, requirePlanBinding = true) {
  const file = path.join(cfg.dir, "prestate.json");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const marker = journal.entries().filter((e) => e.step === "prestate").at(-1);
  if (marker && marker.sha !== sha256(text)) die("prestate.json does not match the hash recorded in the journal (edited or damaged). Refusing to use it.");
  const pre = JSON.parse(text);
  const id = identityOf(cfg);
  if (pre.identity.database !== id.database || pre.identity.hostHash !== id.hostHash) die("this journal directory belongs to a different database/host. Use a fresh --journal-dir.");
  if (requirePlanBinding && cfg.planSha && pre.identity.planSha !== id.planSha) die("this journal directory was created for a different plan.json. Use a fresh --journal-dir.");
  return { pre, hasMarker: Boolean(marker), file };
}

/** Decides what to do with an existing snapshot BEFORE preflight. Returns the usable snapshot or null (take a new one). */
async function resolvePrestate(db, cfg, journal, canMutate) {
  const loaded = loadPrestate(cfg, journal);
  const entries = journal.entries();
  if (!loaded) {
    if (entries.some((e) => e.step !== "rollback")) die("the journal directory has entries but no snapshot: refusing to guess. Use a fresh --journal-dir.");
    return null;
  }
  const { pre, hasMarker, file } = loaded;
  if (JSON.stringify(pre.converted ?? []) !== JSON.stringify(cfg.convert)) die("--convert-admins differs from the first run in this journal directory. Use a fresh --journal-dir.");
  if (pre.identity.dbFingerprint && pre.identity.dbFingerprint !== (await dbFingerprint(db))) die("the database was recreated or restored since this snapshot was taken (collection UUIDs changed). Use a fresh --journal-dir.");
  // a snapshot nobody has acted on (no data write journalled, or its journal marker is gone) is stale: never trust it
  if (!hasMarker || (cfg.phases.has("data") && !journal.hasDataWrites())) { if (canMutate) fs.renameSync(file, `${file}.stale-${Date.now()}`); return null; } // read-only `check` only reports it as stale
  return pre;
}

async function takeSnapshot(db, cfg, journal) {
  const conv = new Set(cfg.convert);
  const pre = { takenAt: new Date().toISOString(), identity: { ...identityOf(cfg), dbFingerprint: await dbFingerprint(db) }, phases: [...cfg.phases], collections: {}, counters: {}, accounts: {}, indexes: {}, converted: cfg.convert };
  const exp = expectedUpdates(cfg.plan);
  for (const [coll, filter] of DATA) {
    const docs = await db.collection(coll).find(filter).project({ companyId: 1 }).sort({ _id: 1 }).toArray();
    const ids = docs.map((d) => d._id);
    if (ids.length !== exp[coll]) die(`${coll}: the snapshot found ${ids.length} records to stamp but the plan says ${exp[coll]}. Nothing was written.`);
    pre.collections[coll] = {
      missingIds: docs.filter((d) => !("companyId" in d)).map((d) => d._id),
      nullIds: docs.filter((d) => "companyId" in d).map((d) => d._id),
      total: await db.collection(coll).countDocuments({}),
      ownedBefore: await db.collection(coll).countDocuments({ companyId: COMPANY_ID }),
      othersBefore: await db.collection(coll).countDocuments(NOT_OURS),
      idsDigest: ids.length ? (await digestOf(db, coll, { _id: { $in: ids } }, stripFor(coll, conv))).sum : null,
      digestFull: (await digestOf(db, coll, {})).sum,
    };
  }
  for (const e of cfg.plan.counters.entries.filter((x) => x.action === "create" || x.action === "advance")) {
    const d = await db.collection("counters").findOne({ _id: e.counter });
    pre.counters[e.counter] = d ? { existed: true, seq: d.seq } : { existed: false };
  }
  for (const id of cfg.convert) {
    const d = await db.collection("adminusers").findOne({ _id: id });
    pre.accounts[id] = d ? { role: d.role, companyId: d.companyId ?? null, hadCompanyId: "companyId" in d, permissions: d.permissions ?? null, hadPermissions: "permissions" in d } : null;
  }
  for (const coll of Object.keys(INDEXES)) pre.indexes[coll] = (await db.collection(coll).indexes()).map((i) => ({ name: i.name, key: i.key, unique: !!i.unique }));
  const text = JSON.stringify(pre);
  writeAtomic(path.join(cfg.dir, "prestate.json"), text);
  journal.append({ step: "prestate", kind: "info", sha: sha256(text) });
  return pre;
}

// ───────────────────────── preflight: EVERYTHING is validated before the first write ─────────────────────────
async function preflight(db, cfg, journal, st, pre, say) {
  const conv = new Set(cfg.convert);
  if (cfg.phases.has("data")) {
    if (journal.done("data")) {
      if (!pre) die("the journal says data was applied but there is no usable snapshot to verify it against");
      for (const [coll] of DATA) if (!(await landed(db, coll, pre.collections[coll], conv))) die(`${coll}: the journal says this was applied but the database does not show it (restored or changed since?). Nothing was written. Use verify, and a fresh --journal-dir for a new run.`);
    } else {
      for (const [coll] of DATA) {
        const s = st[coll];
        if (s.remaining === s.expected) continue; // untouched, as planned (an intent without a write counts too)
        if (s.remaining === 0 && pre && (journal.done(`data:${coll}`) || journal.inflight(`data:${coll}`))) {
          if (!(await landed(db, coll, pre.collections[coll], conv))) die(`${coll}: a previous write cannot be proven complete (not every snapshot record is stamped, or content differs). Nothing was written; roll back.`);
          continue;
        }
        die(`${coll}: ${s.remaining} records need a company but the approved plan says ${s.expected}${s.remaining === 0 ? " and nothing proves this tool stamped them" : ""}. Nothing was written; data changed since the plan (a half-written collection must be rolled back).`);
      }
      // a resumed run: every collection still to be written must still match its snapshot exactly (no swap of records)
      if (pre) for (const [coll, filter] of DATA) {
        if (journal.done(`data:${coll}`) || st[coll].remaining === 0) continue;
        const ids = idsOf(pre.collections[coll]);
        const n = ids.length ? await db.collection(coll).countDocuments({ $and: [filter, { _id: { $in: ids } }] }) : 0;
        if (n !== ids.length) die(`${coll}: the records still to stamp differ from the snapshot (${n}/${ids.length}); the data changed since it was taken. Nothing was written.`);
      }
    }
  }
  if (cfg.phases.has("counters")) {
    for (const e of cfg.plan.counters.entries.filter((x) => x.action === "create" || x.action === "advance")) {
      const seq = (await db.collection("counters").findOne({ _id: e.counter }))?.seq ?? 0;
      if (typeof seq !== "number") die(`counter ${e.counter} holds a non-numeric value. Nothing was written.`);
      if (journal.done("counters")) { if (seq < e.target) die(`the journal says counters were applied but ${e.counter} is ${seq}, below ${e.target}. Nothing was written.`); }
      else if (seq > e.target) die(`counter ${e.counter} is ${seq}, already above the planned ${e.target}. Nothing was written.`);
    }
  }
  if (cfg.phases.has("accounts")) {
    for (const id of cfg.convert) {
      const d = await db.collection("adminusers").findOne({ _id: id });
      if (journal.done("accounts")) { if (!d || d.role !== "admin" || d.companyId !== COMPANY_ID) die(`the journal says accounts were converted but user ${id} is not an admin of company 1. Nothing was written.`); }
      else if (!d || d.role !== "super_admin" || (d.companyId !== undefined && d.companyId !== null)) die(`user ${id} is not a company-less Super Admin. Nothing was written.`);
    }
  }
  if (cfg.phases.has("indexes") && !journal.done("indexes")) {
    for (const [coll, def] of Object.entries(INDEXES)) {
      const all = await db.collection(coll).indexes();
      const cur = all.find((i) => i.name === def.drop.name), keep = all.find((i) => i.name === def.keep.name);
      if (!cur || !cur.unique || JSON.stringify(cur.key) !== JSON.stringify(def.drop.key)) die(`${coll}.${def.drop.name} is not the expected global unique index. Nothing was written.`);
      if (!keep || !keep.unique || JSON.stringify(keep.key) !== JSON.stringify(def.keep.key)) die(`${coll}.${def.keep.name} (per-company unique) is missing. Nothing was written.`);
      const dupes = await db.collection(coll).aggregate([{ $group: { _id: Object.fromEntries(def.over.map((f) => [f, `$${f}`])), n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
      if (dupes.length) die(`${coll}: duplicate (${def.over.join(",")}) groups exist. Nothing was written.`);
    }
  }
  say("PREFLIGHT every precondition of every selected phase holds (completed steps re-verified against the database); first write follows");
}

// ───────────────────────── phases ─────────────────────────
async function phaseData(db, cfg, journal, pre, st, lock, say) {
  const conv = new Set(cfg.convert);
  if (journal.done("data")) return say("DATA   already applied (re-verified against the database in preflight)");
  for (const [coll, filter] of DATA) {
    const s = st[coll], p = pre.collections[coll];
    const ids = idsOf(p);
    if (s.remaining === 0 && (journal.done(`data:${coll}`) || journal.inflight(`data:${coll}`))) {
      if (!(await landed(db, coll, p, conv))) die(`${coll}: cannot be proven complete. STOP and follow the rollback plan.`);
      if (!journal.done(`data:${coll}`)) { journal.append({ step: `data:${coll}`, kind: "done", modified: ids.length, recovered: true }); say(`  recov ${coll.padEnd(24)} an interrupted write was verified complete (${ids.length} records, content identical) and journalled`); }
      else say(`  skip ${coll.padEnd(24)} done earlier (re-verified)`);
      continue;
    }
    if (s.remaining !== s.expected) die(`${coll}: ${s.remaining} records need a company but the approved plan says ${s.expected}. Nothing written for it.`);
    if (s.expected === 0) { journal.append({ step: `data:${coll}`, kind: "done", modified: 0 }); say(`  ok   ${coll.padEnd(24)} nothing to do`); continue; }
    await lock.assertHeld();
    journal.append({ step: `data:${coll}`, kind: "intent", expected: s.expected });
    // bounded to the snapshot's ids: a record that appeared after the snapshot can never be stamped by this run
    const res = await db.collection(coll).updateMany({ $and: [filter, { _id: { $in: ids } }] }, { $set: { companyId: COMPANY_ID } });
    if (res.matchedCount !== ids.length || res.modifiedCount !== ids.length) die(`${coll}: matched ${res.matchedCount} / modified ${res.modifiedCount}, expected ${ids.length}. STOP: do not re-run; follow the rollback plan.`);
    if (!(await landed(db, coll, p, conv))) die(`${coll}: post-check failed (not every snapshot record is stamped, or content differs). STOP.`);
    const stray = await db.collection(coll).countDocuments(filter);
    journal.append({ step: `data:${coll}`, kind: "done", modified: res.modifiedCount, newLegacyLooking: stray });
    say(`  done ${coll.padEnd(24)} ${String(res.modifiedCount).padStart(5)} records -> company ${COMPANY_ID} (content otherwise identical)${stray ? `  WARNING: ${stray} new legacy-looking record(s) appeared since the plan and were NOT touched` : ""}`);
  }
  journal.append({ step: "data", kind: "done" });
}

async function phaseCounters(db, cfg, journal, lock, say) {
  if (journal.done("counters")) return say("COUNTERS already applied (re-verified against the database in preflight)");
  for (const e of cfg.plan.counters.entries.filter((x) => x.action === "create" || x.action === "advance")) {
    const before = await db.collection("counters").findOne({ _id: e.counter });
    const prev = before?.seq ?? 0;
    if (prev > e.target) die(`counter ${e.counter} is ${prev}, already above the planned ${e.target}`);
    await lock.assertHeld();
    journal.append({ step: `counter:${e.counter}`, kind: "intent", target: e.target, before: prev });
    await db.collection("counters").updateOne({ _id: e.counter }, { $max: { seq: e.target } }, { upsert: true });
    const after = (await db.collection("counters").findOne({ _id: e.counter }))?.seq;
    if (typeof after !== "number" || after < Math.max(prev, e.target)) die(`counter ${e.counter}: ${prev} -> ${after}, expected at least ${Math.max(prev, e.target)}`);
    journal.append({ step: `counter:${e.counter}`, kind: "done", before: prev, after, target: e.target });
    say(`  counter ${e.counter}: ${prev} -> ${after} (raise-only)`);
  }
  journal.append({ step: "counters", kind: "done" });
}

async function phaseAccounts(db, cfg, journal, lock, say) {
  if (journal.done("accounts")) return say("ACCOUNTS already applied (re-verified)");
  for (const id of cfg.convert) {
    const d = await db.collection("adminusers").findOne({ _id: id });
    if (!d || d.role !== "super_admin" || (d.companyId !== undefined && d.companyId !== null)) die(`user ${id} is not a company-less Super Admin; refusing`);
    await lock.assertHeld();
    journal.append({ step: `account:${id}`, kind: "intent", from: "super_admin", to: "admin" });
    const r = await db.collection("adminusers").updateOne({ _id: id, role: "super_admin" }, { $set: { role: "admin", companyId: COMPANY_ID, permissions: [] } });
    if (r.matchedCount !== 1 || r.modifiedCount !== 1) die(`account ${id}: matched ${r.matchedCount} modified ${r.modifiedCount}`);
    journal.append({ step: `account:${id}`, kind: "done" });
    say(`  account ${id}: super_admin -> admin of company ${COMPANY_ID}`);
  }
  journal.append({ step: "accounts", kind: "done" });
}

async function phaseIndexes(db, cfg, journal, lock, say) {
  if (journal.done("indexes")) return say("INDEXES already applied");
  for (const [coll, def] of Object.entries(INDEXES)) {
    await lock.assertHeld();
    journal.append({ step: `index:${coll}`, kind: "intent" });
    await db.collection(coll).dropIndex(def.drop.name);
    await db.collection(coll).createIndex(def.drop.key, { name: def.drop.name }); // immediately: never leave the lookup index missing
    journal.append({ step: `index:${coll}`, kind: "done" });
    say(`  index ${coll}: ${def.drop.name} unique -> non-unique (per-company unique ${def.keep.name} kept)`);
  }
  journal.append({ step: "indexes", kind: "done" });
}

// ───────────────────────── verify / rollback ─────────────────────────
async function verify(db, cfg, journal, say) {
  const loaded = loadPrestate(cfg, journal, false) ?? die("no prestate.json in --journal-dir: nothing to verify against");
  const pre = loaded.pre;
  if (pre.identity.dbFingerprint && pre.identity.dbFingerprint !== (await dbFingerprint(db))) die("the database was recreated or restored since this snapshot was taken: verify would be meaningless");
  const conv = new Set(pre.converted ?? []);
  const results = [];
  const check = (ok, label) => { results.push(ok); say(`  ${ok ? "PASS" : "FAIL"}  ${label}`); };
  for (const [coll, filter] of DATA) {
    const p = pre.collections[coll];
    const ids = idsOf(p);
    const remaining = await db.collection(coll).countDocuments(filter);
    const total = await db.collection(coll).countDocuments({});
    const ownedNow = await db.collection(coll).countDocuments({ companyId: COMPANY_ID });
    const othersNow = await db.collection(coll).countDocuments(NOT_OURS);
    const converted = coll === "adminusers" ? [...conv].filter((id) => journal.done(`account:${id}`)).length : 0; // converted Super Admins are legitimately owned by company 1 too
    const ok = remaining === 0 && (await landed(db, coll, p, conv)) && othersNow === p.othersBefore && ownedNow >= p.ownedBefore + ids.length + converted && (total !== p.total || ownedNow === p.ownedBefore + ids.length + converted);
    check(ok, `${coll}: ${ids.length} legacy records owned by company ${COMPANY_ID}, none left, other companies' records unchanged (${othersNow}), content of the migrated records identical except companyId${total === p.total ? "" : `; collection grew by ${total - p.total} since`}`);
  }
  const company = await db.collection("companies").findOne({ _id: COMPANY_ID });
  check(company?.status === "pending" || cfg.args["force-after-activation"] === true, `company 1 status is '${company?.status}' (activation is a separate approval)`);
  const done = journal.entries().filter((e) => e.kind === "done" && String(e.step).startsWith("counter:"));
  for (const [name, c] of Object.entries(pre.counters)) {
    const now = (await db.collection("counters").findOne({ _id: name }))?.seq;
    const mark = done.find((e) => e.step === `counter:${name}`);
    check(mark ? now >= mark.target : now === c.seq, `counter ${name} = ${now}${mark ? ` (>= the applied target ${mark.target})` : " (unchanged: counters phase not applied)"}`);
  }
  for (const [id, a] of Object.entries(pre.accounts)) {
    const d = await db.collection("adminusers").findOne({ _id: Number(id) });
    const converted = journal.done(`account:${id}`);
    check(a ? (converted ? d?.role === "admin" && d.companyId === COMPANY_ID : d?.role === a.role) : true, `account ${id} is ${converted ? "converted to admin of company 1" : `still ${a?.role}`}`);
  }
  for (const [coll, def] of Object.entries(INDEXES)) {
    if (!journal.anyStep("index:")) break;
    const idx = (await db.collection(coll).indexes()).find((i) => i.name === def.drop.name);
    check(Boolean(idx) && !idx.unique && (await db.collection(coll).indexes()).some((i) => i.name === def.keep.name && i.unique), `index ${coll}.${def.drop.name} is non-unique and ${def.keep.name} (per-company unique) is kept`);
  }
  check(results.every(Boolean), "OVERALL");
  return results.every(Boolean);
}

async function rollback(db, cfg, journal, lock, say) {
  if (cfg.args["confirm-rollback"] !== true) die("rollback needs --confirm-rollback");
  const loaded = loadPrestate(cfg, journal) ?? die("no prestate.json in --journal-dir: nothing to roll back");
  const pre = loaded.pre;
  if (pre.identity.dbFingerprint && pre.identity.dbFingerprint !== (await dbFingerprint(db))) die("the database was recreated or restored since this snapshot was taken: a rollback with it would be wrong");
  if (cfg.gated && (journal.anyStep("account:") || journal.anyStep("index:"))) die("the journal shows account or index steps, which are not approved for a gated target. Resolve them by hand.");
  const company = await db.collection("companies").findOne({ _id: COMPANY_ID });
  if (company?.status !== "pending" && cfg.args["force-after-activation"] !== true) die(`company 1 is '${company?.status}': a rollback now would strip ownership from live tenant data. Needs --force-after-activation and the Approver's decision.`);
  say("ROLLBACK restores only the records this tool changed (by journalled id), never anything else");
  for (const [coll] of DATA) { // data first: it is the part that matters
    if (!journal.done(`data:${coll}`) && !journal.inflight(`data:${coll}`)) continue; // completed AND interrupted (half-written) collections
    const p = pre.collections[coll];
    await lock.assertHeld();
    if (p.missingIds.length) await db.collection(coll).updateMany({ _id: { $in: p.missingIds }, companyId: COMPANY_ID }, { $unset: { companyId: "" } });
    if (p.nullIds.length) await db.collection(coll).updateMany({ _id: { $in: p.nullIds }, companyId: COMPANY_ID }, { $set: { companyId: null } });
    const total = await db.collection(coll).countDocuments({});
    const full = total === p.total ? (await digestOf(db, coll, {})).sum === p.digestFull : null;
    const outside = Math.max(0, (await db.collection(coll).countDocuments({ companyId: COMPANY_ID })) - p.ownedBefore);
    say(`  ${coll.padEnd(24)} ${idsOf(p).length} records restored; ${full === null ? `count changed since (${p.total} -> ${total}), exact digest not comparable` : full ? "collection is byte-identical to before" : "DIGEST DIFFERS from before"}${outside ? `; ${outside} record(s) outside the snapshot are owned by company 1 (created since: left untouched)` : ""}`);
  }
  for (const [id, a] of Object.entries(pre.accounts)) {
    if (!a || !(journal.done(`account:${id}`) || journal.inflight(`account:${id}`))) continue;
    const set = { role: a.role }, unset = {};
    if (a.hadCompanyId) set.companyId = a.companyId; else unset.companyId = "";
    if (a.hadPermissions) set.permissions = a.permissions; else unset.permissions = "";
    await lock.assertHeld();
    await db.collection("adminusers").updateOne({ _id: Number(id), companyId: COMPANY_ID }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    say(`  account ${id}: restored to ${a.role}`);
  }
  for (const [name, c] of Object.entries(pre.counters)) {
    if (!journal.done(`counter:${name}`) && !journal.inflight(`counter:${name}`)) continue;
    say(`  counter ${name}: NOT lowered (the application may already have issued numbers from it; lowering could duplicate quotation numbers). Value before: ${c.existed ? c.seq : "did not exist"}`);
  }
  if (journal.anyStep("index:")) { // ANY index step, including a crash between two collections
    for (const [coll, def] of Object.entries(INDEXES)) {
      try {
        const idx = (await db.collection(coll).indexes()).find((i) => i.name === def.drop.name);
        if (idx?.unique) continue; // untouched
        const field = Object.keys(def.drop.key)[0];
        const dupes = await db.collection(coll).aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
        if (dupes.length) { say(`  index ${coll}: duplicates exist now, NOT recreating the global unique ${def.drop.name}`); continue; }
        await lock.assertHeld();
        if (idx) await db.collection(coll).dropIndex(def.drop.name);
        await db.collection(coll).createIndex(def.drop.key, { name: def.drop.name, unique: true });
        say(`  index ${coll}: ${def.drop.name} unique restored`);
      } catch (e) { say(`  index ${coll}: could not restore (${redact(e.message)}); fix by hand`); }
    }
  }
  journal.append({ step: "rollback", kind: "done" });
  fs.renameSync(path.join(cfg.dir, "prestate.json"), path.join(cfg.dir, `prestate.rolledback-${Date.now()}.json`)); // a later apply takes a fresh snapshot
}

// ───────────────────────── main ─────────────────────────
function acquireFileLock(dir) {
  const file = path.join(dir, "run.lock");
  const take = () => { const fd = fs.openSync(file, "wx", 0o600); fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); fs.closeSync(fd); };
  try { take(); } catch {
    let alive = true; // a lock left by a process that no longer exists on THIS machine is stale and may be taken over
    try { process.kill(JSON.parse(fs.readFileSync(file, "utf8")).pid, 0); } catch (e) { if (e.code === "ESRCH") alive = false; }
    if (alive) die(`another apply/rollback is running (${file}). Run one at a time.`);
    fs.unlinkSync(file);
    try { take(); } catch { die(`could not take ${file}`); }
  }
  return () => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args);
  const say = (l) => console.log(l);
  const writes = args.mode === "apply" || args.mode === "rollback";
  const releaseFile = writes ? acquireFileLock(cfg.dir) : () => {};
  const client = new MongoClient(cfg.uri, { serverSelectionTimeoutMS: 15000, appName: `whyte-tenant-migration-${args.mode}`, ...(writes ? { writeConcern: { w: "majority", journal: true } } : { readPreference: args.mode === "verify" ? "primary" : "secondaryPreferred" }) });
  let lock = null;
  try {
    await client.connect();
    const db = client.db(cfg.database);
    // the connected server must be what the classification assumed
    const hello = await client.db("admin").command({ hello: 1 });
    const hostInfoName = (await client.db("admin").command({ hostInfo: 1 }).catch(() => null))?.system?.hostname ?? null;
    const local = serverIsLocal(hello, os.hostname(), hostInfoName);
    if (!cfg.gated && !local) die(`ambiguous target: the URI says loopback but the server identifies itself as '${hello.me}'. That is a tunnel or a forwarded port. Treat it as a gated target: pass the remote gates and use the real database name.`);
    const journal = new Journal(cfg.dir);
    if (writes) journal.repair(); // read-only modes never touch the journal; scan() already tolerates a torn tail
    say(`MODE ${args.mode.toUpperCase()} database=${cfg.database} host=${hostsOf(cfg.uri).replace(/^[^@]*@/, "")} target=${cfg.gated ? "GATED" : "local"}${cfg.gated ? ` (${cfg.reasons.join("; ")})` : ""} phases=${[...cfg.phases].join(",")}`);
    if (args.mode === "verify") { process.exitCode = (await verify(db, cfg, journal, say)) ? 0 : 1; return; }
    if (writes) lock = await acquireDbLock(db, journal, say);
    if (args.mode === "rollback") { await rollback(db, cfg, journal, lock, say); return; }
    const { states } = await gates(db, cfg, say);
    for (const [c, s] of Object.entries(states)) say(`  ${c.padEnd(24)} total ${String(s.total).padStart(5)}  needs company ${String(s.remaining).padStart(5)}  plan says ${String(s.expected).padStart(5)} ${s.remaining === s.expected ? "OK" : "MISMATCH"}`);
    const existing = await resolvePrestate(db, cfg, journal, args.mode === "apply");
    await preflight(db, cfg, journal, states, existing, say);
    if (args.mode === "check") { say("CHECK complete: nothing was written."); return; }
    const pre = existing ?? (await takeSnapshot(db, cfg, journal));
    journal.append({ step: "apply", kind: "start", phases: [...cfg.phases] });
    if (cfg.phases.has("data")) await phaseData(db, cfg, journal, pre, states, lock, say);
    if (cfg.phases.has("counters")) await phaseCounters(db, cfg, journal, lock, say);
    if (cfg.phases.has("accounts")) await phaseAccounts(db, cfg, journal, lock, say);
    if (cfg.phases.has("indexes")) await phaseIndexes(db, cfg, journal, lock, say);
    journal.append({ step: "apply", kind: "complete" });
    say("APPLY complete. Company 1 status was not changed. Run `verify` next.");
  } finally {
    if (lock) await lock.release().catch(() => {});
    await client.close().catch(() => {});
    releaseFile();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => { console.error("STOPPED:", redact(e.message)); process.exit(1); });
}
