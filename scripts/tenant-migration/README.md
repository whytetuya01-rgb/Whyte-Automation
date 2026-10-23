# Tenant migration: assign legacy records to Company 1

Files: `plan.ts` (read-only planner run, writes `plan.json`), `migrate.mjs` (`check | apply | verify | rollback`),
`app-check.ts` (read-only: what each user context sees through the real models).
Tests: `tests/tenant-migration-executor.test.mjs` (offline unit tests: target classification, plan validation,
journal integrity). The crash / concurrency / isolation scenarios run against local throwaway databases.

**Do not run `apply` against production without the Approver's written go-ahead.** The journal directory must be
outside the repository. The connection string is read ONLY from `WHYTE_MIGRATION_URI` (never from `.env`); set it for
the shell session and unset it afterwards.

## Approved production scope: `data,counters` only
- `data`: `companyId = 1` on records whose `companyId` is missing/null in 13 collections, exact counts enforced from
  `plan.json`, writes bounded to the snapshotted ids. Super Admin accounts are exempt. Nothing else on those documents
  changes (checked by content digest).
- `counters`: `quotationNumber_1_2026` raised to the planned value (raise-only `$max`).
- `accounts` and `indexes` exist for local rehearsals only. On a gated target they are refused and there is no override.
- Never: delete, merge, reseed, change prices/totals/snapshots/soft-delete fields, change roles or indexes on production,
  activate a company. The only extra write is its own lock document (see below), removed when the run ends.

## What counts as a gated (production-like) target
A target is **local** only if all of these hold, otherwise it is **gated**:
1. every host in the URI is loopback and `directConnection=true` is present exactly once;
2. the database name matches `whyte_(rehearsal|audit|drill|s|test|backup_verify)_*`;
3. it is not `whyte_quotation` and not the database the plan was generated from;
4. after connecting, the server identifies itself as this machine (`hello.me`).

A tunnel or forwarded port to production fails (2) and (4), so loopback alone never relaxes anything. A gated target needs
`--allow-remote`, `--confirm-database <name>` (= `--database` = `plan.database`), `--approved-plan-sha256` (of the exact
`plan.json` bytes used), `--backup-archive <file>` and `--approved-backup-sha256`, for `apply` AND `rollback`.
`check` and `verify` need `--allow-remote` only.

```
WHYTE_MIGRATION_URI=<uri> node scripts/tenant-migration/migrate.mjs apply \
  --plan plan.json --database whyte_quotation --journal-dir <outside-repo-dir> --phases data,counters \
  --allow-remote --confirm-database whyte_quotation --approved-plan-sha256 <sha> \
  --backup-archive <file.archive.gz> --approved-backup-sha256 <sha>
```

## Safety mechanisms
- **Plan validation:** database, company, every collection entry, counter names (`quotationNumber_<company>_<year>` of
  company 1 only), numeric targets, counter conflicts and diagnostics are validated; anything unexpected is refused.
- **Preflight:** every precondition of every phase is checked before the snapshot and before the first write. Steps the
  journal calls done are re-verified against the database, never trusted.
- **Snapshot:** `prestate.json` is bound to database, host, plan hash and the database *instance* (collection UUIDs), its
  hash is recorded in the journal, and it is only reused once data writes have started (otherwise it is retaken).
- **Journal:** hash-chained and fsynced. A torn final record is discarded (it was never acknowledged); a corrupt
  interior record, a hash mismatch or a sequence gap is rejected. Rollback stays possible after interrupted writes.
- **Interrupted writes:** an intent without a done is accepted only if the data proves every snapshot record landed with
  unchanged content; a half-written collection is refused and must be rolled back.
- **Locks:** a database lock document (heartbeat; taken over when stale for 2 minutes, or at once when its owner process
  on this machine is gone) stops concurrent executors from any machine or journal directory and is re-checked before
  every write. A local lock file adds a second layer.

## Rollback
`rollback --confirm-rollback` (same gates) restores only the journalled ids to their prior state (field missing vs null),
including half-written collections, and refuses once Company 1 is active unless `--force-after-activation` (Approver's
decision). It never lowers the counter. Full alternative: restore the verified archive into a NEW database and repoint.

## Known limits
- It cannot stop the live application writing during the run. Freeze writers (pause the deployment or make the app's
  database user read-only for the window). Records created meanwhile are not stamped and are reported.
- Writes use majority concern but no transaction; the journal, snapshot and rollback cover a mid-run failure.
- `verify` is a point-in-time check: after normal use, edits to migrated records make its content digest differ.
- Everything was tested on local MongoDB only, never on Atlas.
