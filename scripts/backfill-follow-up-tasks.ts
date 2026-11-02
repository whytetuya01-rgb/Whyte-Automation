/**
 * Gives every lead that already has a follow-up date a follow-up task with an owner (see src/lib/followUpBackfill.ts).
 *
 * Safe by default:
 *   - A dry run (the default) is read-only. It does not even let Mongoose create collections or indexes, which it would
 *     otherwise do for every model on connecting. Add --apply to write.
 *   - It never reads .env files: the database is the MONGODB_URI you set for this one command.
 *   - It refuses any database that is not on this machine unless you pass --allow-remote AND set
 *     FOLLOW_UP_BACKFILL_APPROVED=yes. That is for the day the live run has been approved; do not do it before.
 *
 * Local database:
 *   MONGODB_URI=mongodb://127.0.0.1:27017/whyte_dev npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register scripts/backfill-follow-up-tasks.ts [--apply] [--company=1,6]
 *
 * The app does not need this to have run: an old follow-up is adopted automatically the first time it is changed.
 */
export {}; // a module of its own (the scripts must not share one global scope)

const uri = process.env.MONGODB_URI ?? "";
const apply = process.argv.includes("--apply");
const allowRemote = process.argv.includes("--allow-remote");
// --company=1,6 limits the run to those company ids.
const companyArg = process.argv.find((arg) => arg.startsWith("--company="));
const companyIds = companyArg ? companyArg.slice("--company=".length).split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0) : undefined;

const host = (uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/:,?]+)/)?.[1] ?? "").toLowerCase();
const database = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)?.[1] ?? "(default)";
const isLocal = ["127.0.0.1", "localhost", "::1"].includes(host);

async function main() {
  if (!uri) {
    console.error("MONGODB_URI is not set. Set it for this command (this script does not read .env files).");
    process.exit(2);
  }
  if (!isLocal && !(allowRemote && process.env.FOLLOW_UP_BACKFILL_APPROVED === "yes")) {
    console.error(`Refusing to run against ${host}: it is not a database on this machine.`);
    console.error("A run against a remote database needs --allow-remote and FOLLOW_UP_BACKFILL_APPROVED=yes, and must be approved first.");
    process.exit(2);
  }
  if (companyArg && (!companyIds || companyIds.length === 0)) {
    console.error("--company needs one or more company ids, e.g. --company=1,6");
    process.exit(2);
  }

  // Turned off BEFORE anything connects: connecting must not create collections or indexes behind a dry run's back.
  process.env.MONGOOSE_AUTO_INDEX = "0";
  const { backfillFollowUpTasks } = await import("../src/lib/followUpBackfill");
  const { connectMongoDB } = await import("../src/lib/mongodb");
  const { FollowUpTask } = await import("../src/models");

  console.log(`Database: ${database} on ${host}${isLocal ? "" : "  (REMOTE)"}`);
  console.log(apply ? "Mode: APPLY (writes follow-up tasks)" : "Mode: dry run (read-only; nothing is written; add --apply to write)");
  if (companyIds) console.log(`Companies: ${companyIds.join(", ")}`);

  if (apply) {
    // Writing tasks is the one case where the collection and its one-open-task index should exist first (this creates
    // only that collection's index, nothing else).
    await connectMongoDB();
    await FollowUpTask.createIndexes();
  }

  const report = await backfillFollowUpTasks({ apply, companyIds });
  for (const company of report.companies) {
    if (company.leadsWithDate === 0 && company.staleTasks === 0) continue;
    console.log(`\n${company.companyName} (company ${company.companyId})`);
    console.log(`  leads with a follow-up date: ${company.leadsWithDate}`);
    console.log(`  already have a task:         ${company.alreadyHaveTask}`);
    console.log(`  ${apply ? "tasks created:" : "tasks to create:"}            ${company.created}`);
    console.log(`  ${apply ? "dates corrected:" : "dates to correct:"}          ${company.dateCorrected}`);
    console.log(`  open tasks without a date:   ${company.staleTasks}`);
    if (company.needsOwner.length > 0) console.log(`  NO OWNER FOUND (left alone): ${company.needsOwner.join(", ")}`);
  }
  console.log(`\nTotals: ${JSON.stringify(report.totals)}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Backfill failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
