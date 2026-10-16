/**
 * Read-only validation of a RESTORED rehearsal database against its backup.
 * Loopback only; the database name must start with `whyte_rehearsal_`; it never
 * reads .env and refuses to run if MONGODB_URI is set.
 *
 *   node tests/migration-rehearsal-validation.test.mjs <dbName> --backup=<dir> --mode=pre
 *   node tests/migration-rehearsal-validation.test.mjs <dbName> --backup=<dir> --mode=post
 *
 *   pre   the restored copy is byte-for-byte the backup (counts, ids, every field, indexes)
 *   post  the copy after the (separately approved) backfill: every document and id preserved, nothing but the
 *         approved fields changed, ownership/roles/counters/indexes/room types exactly as decided.
 *
 * Application-level behaviour (Act-as, admin-creation restrictions, registration/login under pending/active,
 * catalog counts through the API, quotation creation) is covered by the existing HTTP tests and by the app-level
 * step in the executor plan; this script is the data-level half.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MongoClient } = require("mongodb");
const { EJSON } = require("bson");

const dbName = process.argv[2];
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const backupDir = arg("backup");
const mode = arg("mode");
assert.ok(/^whyte_rehearsal_[a-z0-9_]+$/.test(dbName ?? ""), "database name must start with whyte_rehearsal_");
assert.ok(backupDir && fs.existsSync(path.join(backupDir, "manifest.json")), "--backup=<dir> with manifest.json is required");
assert.ok(mode === "pre" || mode === "post", "--mode=pre|post");
assert.equal(process.env.MONGODB_URI, undefined, "MONGODB_URI must not be set");

const results = [];
const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(name);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").slice(0, 3).join("\n      ")}`);
  }
};

const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
const backupIndexes = JSON.parse(fs.readFileSync(path.join(backupDir, "indexes.json"), "utf8"));
const readBackup = (name) => fs.readFileSync(path.join(backupDir, `${name}.ejsonl`), "utf8").split("\n").filter(Boolean).map((l) => EJSON.parse(l, { relaxed: false }));
const backup = Object.fromEntries(Object.keys(manifest.collections).map((n) => [n, readBackup(n)]));

const client = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
await client.connect();
const db = client.db(dbName);
const live = {};
for (const n of Object.keys(manifest.collections)) live[n] = await db.collection(n).find({}).sort({ _id: 1 }).toArray();
const canon = (d) => EJSON.stringify(d, { relaxed: false });
const without = (d, fields) => { const c = { ...d }; for (const f of fields) delete c[f]; return c; };
const uniqueIdx = async (n) => (await db.collection(n).indexes()).filter((i) => i.unique && i.name !== "_id_").map((i) => i.name).sort();

const TENANT = ["categories", "roomtypes", "housetypes", "housetyperoomtemplates", "products", "productvariants", "productvarianthistories", "adminusers", "quotations", "quotationrooms", "quotationitems", "quotationauditevents", "deletionauditevents", "roledefinitions"];
const FORMER_SUPER_ADMINS_TO_ADMIN = [8, 9, 10, 11];
const PLATFORM_SUPER_ADMIN = 5;

// ───────────── always: nothing lost, no id changed ─────────────
await check("every collection keeps its document count and every _id", () => {
  for (const [n, docs] of Object.entries(backup)) {
    assert.equal(live[n].length, docs.length, `${n}: ${live[n].length} documents, backup has ${docs.length}`);
    assert.deepEqual(live[n].map((d) => String(d._id)), docs.map((d) => String(d._id)), `${n}: _id set differs`);
  }
});

if (mode === "pre") {
  await check("PRE: every document is byte-identical to the backup", () => {
    for (const [n, docs] of Object.entries(backup)) {
      assert.deepEqual(live[n].map(canon), docs.map(canon), `${n} differs from backup`);
    }
  });
  await check("PRE: index definitions match the backup", async () => {
    for (const n of Object.keys(backup)) {
      const norm = (l) => l.map((i) => JSON.stringify([i.name, i.key, !!i.unique, i.partialFilterExpression ?? null])).sort();
      assert.deepEqual(norm(await db.collection(n).indexes()), norm(backupIndexes[n]), `${n} indexes differ`);
    }
  });
  await check("PRE: still the pre-migration shape (one company, none of the tenant rows owned except the known tagged ones)", () => {
    assert.equal(live.companies.length, 1);
    assert.equal(live.companies[0].status, "pending");
    assert.ok(live.products.every((p) => p.companyId == null));
  });
} else {
  // ───────────── POST: exactly the approved changes ─────────────
  const company = live.companies[0];
  await check("company 1 is unchanged: same slug, still pending", () => {
    assert.equal(live.companies.length, 1);
    assert.deepEqual(live.companies.map(canon), backup.companies.map(canon));
    assert.equal(company._id, 1);
    assert.equal(company.slug, "whyte-automations");
    assert.equal(company.status, "pending", "activation is a separate approval");
  });

  await check("ownership: every tenant record belongs to company 1, except super admins and system role templates", () => {
    for (const n of TENANT) {
      for (const d of live[n]) {
        const exempt = (n === "adminusers" && d.role === "super_admin") || (n === "roledefinitions" && d.isSystem === true && backup.roledefinitions.find((b) => String(b._id) === String(d._id))?.companyId == null);
        if (exempt) {
          assert.ok(d.companyId == null, `${n} ${d._id} must stay company-less`);
        } else {
          assert.equal(d.companyId, 1, `${n} ${d._id} has companyId ${d.companyId}`);
        }
      }
    }
  });

  await check("nothing else changed: each document equals its backup apart from companyId (and, for ids 8-11, role/permissions)", () => {
    for (const n of TENANT) {
      const byId = new Map(backup[n].map((d) => [String(d._id), d]));
      for (const d of live[n]) {
        const before = byId.get(String(d._id));
        const ignore = n === "adminusers" && FORMER_SUPER_ADMINS_TO_ADMIN.includes(Number(d._id)) ? ["companyId", "role", "permissions", "updatedAt"] : ["companyId"];
        assert.equal(canon(without(d, ignore)), canon(without(before, ignore)), `${n} ${d._id} changed beyond the approved fields`);
      }
    }
    for (const n of ["companies", "platformaccesslogs"]) assert.deepEqual(live[n].map(canon), backup[n].map(canon), `${n} must be untouched`);
  });

  await check("accounts: one platform Super Admin (id 5), four company Admins (ids 8-11), dealers keep their role", () => {
    const supers = live.adminusers.filter((u) => u.role === "super_admin");
    assert.deepEqual(supers.map((u) => Number(u._id)), [PLATFORM_SUPER_ADMIN]);
    assert.ok(supers[0].companyId == null);
    for (const id of FORMER_SUPER_ADMINS_TO_ADMIN) {
      const was = backup.adminusers.find((u) => Number(u._id) === id);
      const now = live.adminusers.find((u) => Number(u._id) === id);
      assert.equal(was.role, "super_admin", `backup: ${id} was expected to be a super admin`);
      assert.equal(now.role, "admin");
      assert.equal(now.companyId, 1);
      assert.equal(now.isActive, was.isActive);
    }
    for (const u of backup.adminusers) {
      if (Number(u._id) === PLATFORM_SUPER_ADMIN || FORMER_SUPER_ADMINS_TO_ADMIN.includes(Number(u._id))) continue;
      const now = live.adminusers.find((x) => String(x._id) === String(u._id));
      assert.equal(now.role, u.role, `account ${u._id} role must not change`);
      assert.equal(now.isActive, u.isActive);
    }
    assert.ok(live.adminusers.filter((u) => u.role === "dealer").every((u) => u.companyId === 1));
  });

  await check("references: no new orphan and no cross-company reference (the 9 known orphans are the only dangling ones)", () => {
    const ids = (n) => new Set(live[n].map((d) => String(d._id)));
    const refs = [
      ["products", "categoryId", "categories"], ["productvariants", "productId", "products"], ["productvarianthistories", "productId", "products"],
      ["housetyperoomtemplates", "houseTypeId", "housetypes"], ["housetyperoomtemplates", "roomTypeId", "roomtypes"],
      ["quotations", "houseTypeId", "housetypes"], ["quotationrooms", "quotationId", "quotations"], ["quotationrooms", "roomTypeId", "roomtypes"],
      ["quotationitems", "quotationRoomId", "quotationrooms"], ["quotationitems", "productId", "products"], ["quotationitems", "productVariantId", "productvariants"],
      ["quotationauditevents", "quotationId", "quotations"],
    ];
    const dangling = [];
    for (const [child, field, parent] of refs) {
      const p = ids(parent);
      for (const d of live[child]) if (d[field] != null && !p.has(String(d[field]))) dangling.push(`${child}:${d._id}:${field}=${d[field]}`);
    }
    assert.deepEqual(dangling.sort(), [
      "productvarianthistories:1:productId=329", "productvarianthistories:2:productId=329", "productvarianthistories:3:productId=330",
      "productvarianthistories:4:productId=330", "productvarianthistories:5:productId=330", "productvarianthistories:6:productId=330",
      "products:331:categoryId=9", "quotationauditevents:qa_muxohfaj_epbspc960:quotationId=q_muxohf8v_bm58z4x", "quotationauditevents:qa_mv0egai7_5p11hki60:quotationId=q_mv0egac0_kf969om",
    ].sort());
    // every record still exists (orphans preserved, none deleted or re-pointed)
    for (const id of [331]) assert.equal(live.products.find((p) => Number(p._id) === id).categoryId, 9);
  });

  await check("catalog the tenant-scoped app will see: same product/variant totals as before, all under company 1", () => {
    const active = (n) => live[n].filter((d) => d.isActive === true && d.isDeleted !== true && d.companyId === 1).length;
    const was = (n) => backup[n].filter((d) => d.isActive === true && d.isDeleted !== true).length;
    assert.equal(active("products"), was("products"));
    assert.equal(active("productvariants"), was("productvariants"));
    assert.equal(live.products.length, backup.products.length);
    assert.equal(live.productvariants.length, backup.productvariants.length);
  });

  await check("room types: all 79 present, activation flags untouched (duplicates NOT inactivated)", () => {
    assert.equal(live.roomtypes.length, 79);
    for (const r of backup.roomtypes) assert.equal(live.roomtypes.find((x) => String(x._id) === String(r._id)).isActive, r.isActive, `roomtype ${r._id} isActive changed`);
  });

  await check("quotation numbers: all preserved, unique per company, counters above every issued number", () => {
    assert.deepEqual(live.quotations.map((q) => q.quotationNumber), backup.quotations.map((q) => q.quotationNumber));
    const seen = new Set();
    for (const q of live.quotations) { const k = `${q.companyId}|${q.quotationNumber}`; assert.ok(!seen.has(k), `duplicate ${k}`); seen.add(k); }
    const max = Math.max(...live.quotations.filter((q) => q.companyId === 1 && /^QT-2026-\d+$/.test(q.quotationNumber)).map((q) => Number(q.quotationNumber.slice(-3))));
    const c = live.counters.find((x) => x._id === "quotationNumber_1_2026");
    assert.ok(c && c.seq >= max, `counter ${c?.seq} must be >= ${max}`);
    assert.ok(live.counters.find((x) => x._id === "quotationNumber_2026"), "legacy counter is kept, not deleted");
    for (const b of backup.counters) assert.ok(live.counters.find((x) => String(x._id) === String(b._id))?.seq >= Number(b.seq), `counter ${b._id} must never go backwards`);
  });

  await check("indexes: uniqueness is per company (quotations, role definitions); old global unique indexes are gone", async () => {
    assert.deepEqual(await uniqueIdx("quotations"), ["companyId_1_quotationNumber_1"]);
    assert.deepEqual(await uniqueIdx("roledefinitions"), ["companyId_1_key_1"]);
    assert.ok((await uniqueIdx("adminusers")).some((n) => /email/.test(n)), "email stays globally unique");
  });
}

await client.close();
console.log(`\nMigration rehearsal validation (${mode}): ${results.length} passed, ${failures.length} failed.`);
process.exit(failures.length ? 1 : 0);
