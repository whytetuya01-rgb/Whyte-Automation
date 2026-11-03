# Index deployment

## Why this exists

Mongoose, by default, creates every model's collection and indexes when the app connects. In development that is
convenient. In production it means a normal page request can start building an index (a unique index on a large
collection can slow or block writes, or fail on duplicates) at a moment nobody chose.

So **in production the app creates no collection and no index by itself.** (`src/lib/mongoIndexPolicy.ts`,
`src/lib/mongodb.ts`.) Indexes are created only by the controlled command below, which:

- only ever **adds** missing indexes. It never drops, rebuilds or changes an existing index;
- refuses to build a missing **unique** index if the data already contains duplicates for that key;
- refuses any database that is not on this machine unless you pass `--allow-remote` **and** set an approval variable;
- never reads `.env` files. The database is the `MONGODB_URI` you set for that one command.

| Setting                  | Effect                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| unset                    | automatic everywhere except `NODE_ENV=production`                                        |
| `MONGOOSE_AUTO_INDEX=1`  | force automatic (throwaway test databases only)                                          |
| `MONGOOSE_AUTO_INDEX=0`  | force off                                                                                |

The app logs one line on first connect: `[mongodb] index policy: controlled …` or `automatic …`.

## What the app does when an index is missing

Only the index that a feature's **correctness** depends on is checked, and only at the moment it matters:

- `followuptasks.one_open_task_per_lead` (unique, partial) is checked when a request would **create** a follow-up
  task (a new lead with a follow-up date, setting a date, rescheduling or finishing an old follow-up, finishing one with a
  next date). If it is missing the request stops with **HTTP 503** and a message pointing here, and changes nothing.
  Leads without a follow-up date, other lead edits, the Follow-ups screens, cancelling and reassigning keep working.
- A failed check is re-checked after 10 seconds, so deploying the index fixes the running app without a restart.

Everything else works without its secondary indexes, only more slowly.

## Procedure

Run from the repository root. Windows PowerShell shown; use the same variables in any shell.

1. **See what the code declares** (no database needed):

   ```
   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register scripts/indexes.ts list
   ```

2. **Audit** the target database (read-only). Add `--check-unique` to look for duplicates that would stop a unique index:

   ```
   $env:MONGODB_URI = "<the database to audit>"
   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register scripts/indexes.ts audit --check-unique
   ```

   A database that is not local is refused unless you add `--allow-remote` and set `INDEX_AUDIT_APPROVED=yes`.
   Output marks each index `OK`, `MISSING` or `CONFLICT` (an index with that name exists but is defined differently:
   the tool leaves it alone and tells you).

3. **Plan** (still changes nothing). Choose models explicitly or take everything missing:

   ```
   ... scripts/indexes.ts apply --models=FollowUpTask
   ... scripts/indexes.ts apply --all-missing
   ```

4. **Apply** only after the plan has been approved:

   ```
   $env:INDEX_DEPLOY_APPROVED = "yes"
   ... scripts/indexes.ts apply --models=FollowUpTask --apply --allow-remote
   ```

5. **Verify** by running the audit again: nothing `MISSING`.

Recommended order: `FollowUpTask` first (the app depends on its unique index), then the rest with `--all-missing`.
Build large collections' indexes outside business hours.

## Collections and indexes added by the recent work

These are new, so on a production database they do not exist until the procedure is run:

| Model                 | Collection             | Declared indexes | Notes                                                      |
| --------------------- | ---------------------- | ---------------- | ---------------------------------------------------------- |
| `FollowUpTask`        | `followuptasks`        | 5                | `one_open_task_per_lead` is unique + partial; required     |
| `LeadAssignmentRule`  | `leadassignmentrules`  | 1                |                                                            |
| `Notification`        | `notifications`        | 8                |                                                            |
| `PriceChangeBatch`    | `pricechangebatches`   | 2                | Bulk pricing / Excel import history (not required for correctness) |
| `VariantPriceChange`  | `variantpricechanges`  | 4                | Per-variant before/after price history                     |
| `GoogleCalendarConnection` | `googlecalendarconnections` | 4       | `one_google_connection_per_user`, `one_user_per_google_account` (unique) are required before anyone can connect Google |
| `CalendarEventLink`   | `calendareventlinks`   | 5                | `one_link_per_task_and_connection` (unique) is required before anyone can connect Google |
| CRM (`Lead`, `Customer`, `CrmActivity`, `LeadSource`, `CalendarFeed`, …) | see `list` | | If these collections are also new in production, run `--all-missing` |

Use `list` for the authoritative current numbers (32 models, 203 declared indexes at the time of writing).

## Transactions

Follow-up writes must be all-or-nothing, so in production they **require** MongoDB transactions (a replica set; Atlas
clusters are). If the database cannot do them the request fails with HTTP 503 and changes nothing. It never quietly falls
back to separate writes. Outside production a plain standalone `mongod` still works and logs a warning once.
