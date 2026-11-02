/**
 * Controlled index deployment (see docs/index-deployment.md).
 *
 * In production the app never creates collections or indexes by itself; this command is the only thing that does, and it
 * only ever ADDS missing indexes. It never drops, rebuilds or changes an existing index.
 *
 *   list                      what every model declares (no database needed)
 *   audit                     read-only: declared vs existing indexes, per model; add --check-unique to also look for
 *                             duplicates that would make a missing UNIQUE index fail to build
 *   apply                     shows the plan; add --apply to create the missing indexes. Needs --models=A,B or --all-missing
 *
 * Options: --models=FollowUpTask,GoogleCalendarConnection   --check-unique   --apply   --all-missing   --json
 *
 * It never reads .env files: the database is the MONGODB_URI you set for this one command. Any database that is not on this
 * machine is refused unless you pass --allow-remote AND set INDEX_AUDIT_APPROVED=yes (audit) or INDEX_DEPLOY_APPROVED=yes
 * (apply), which you do only after the run has been approved.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/whyte_dev npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register scripts/indexes.ts audit --check-unique
 */
export {}; // a module of its own (the scripts must not share one global scope)

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const command = args.find((arg) => !arg.startsWith("--")) ?? "audit";

const uri = process.env.MONGODB_URI ?? "";
const host = (uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/:,?]+)/)?.[1] ?? "").toLowerCase();
const database = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)?.[1] ?? "(default)";
const isLocal = ["127.0.0.1", "localhost", "::1"].includes(host);
const asJson = flag("json");

const say = (line = "") => {
  if (!asJson) console.log(line);
};

const describeKeys = (keys: Record<string, number | string>) => `{ ${Object.entries(keys).map(([field, direction]) => `${field}: ${direction}`).join(", ")} }`;

async function main() {
  if (!["list", "audit", "apply"].includes(command)) {
    console.error(`Unknown command "${command}". Use list, audit or apply.`);
    process.exit(2);
  }

  // Nothing here may create collections or indexes as a side effect of connecting.
  process.env.MONGOOSE_AUTO_INDEX = "0";
  const lib = await import("./lib/indexAudit");
  const wanted = value("models")?.split(",").map((name) => name.trim()).filter(Boolean);
  let models = await lib.loadAllModels();
  if (wanted) {
    const unknown = wanted.filter((name) => !models.some((model) => model.modelName === name));
    if (unknown.length > 0) {
      console.error(`Unknown model(s): ${unknown.join(", ")}. Known: ${models.map((model) => model.modelName).join(", ")}`);
      process.exit(2);
    }
    models = models.filter((model) => wanted.includes(model.modelName));
  }

  if (command === "list") {
    const listing = models.map((model) => ({ model: model.modelName, collection: model.collection.collectionName, indexes: lib.declaredIndexes(model) }));
    if (asJson) console.log(JSON.stringify(listing, null, 2));
    else {
      for (const entry of listing) {
        say(`${entry.model} (${entry.collection}): ${entry.indexes.length} declared`);
        for (const index of entry.indexes) say(`    ${index.name}  ${describeKeys(index.keys)}${index.unique ? "  UNIQUE" : ""}${index.partialFilterExpression ? "  PARTIAL" : ""}${index.sparse ? "  SPARSE" : ""}${index.expireAfterSeconds !== undefined ? "  TTL" : ""}`);
      }
      say(`\n${listing.length} models, ${listing.reduce((sum, entry) => sum + entry.indexes.length, 0)} declared indexes.`);
    }
    process.exit(0);
  }

  const approval = command === "apply" && flag("apply") ? "INDEX_DEPLOY_APPROVED" : "INDEX_AUDIT_APPROVED";
  if (!uri) {
    console.error("MONGODB_URI is not set. Set it for this command (this script does not read .env files).");
    process.exit(2);
  }
  if (!isLocal && !(flag("allow-remote") && process.env[approval] === "yes")) {
    console.error(`Refusing to run against ${host}: it is not a database on this machine.`);
    console.error(`A run against a remote database needs --allow-remote and ${approval}=yes, and must be approved first.`);
    process.exit(2);
  }
  if (command === "apply" && !wanted && !flag("all-missing")) {
    console.error("apply needs to know what to create: --models=A,B or --all-missing. (Nothing was changed.)");
    process.exit(2);
  }

  const { connectMongoDB } = await import("../src/lib/mongodb");
  await connectMongoDB();
  say(`Database: ${database} on ${host}${isLocal ? "" : "  (REMOTE)"}`);
  say(command === "apply" && flag("apply") ? "Mode: APPLY (creates missing indexes only; drops and rebuilds nothing)" : "Mode: read-only (nothing is written)");

  const checkUnique = flag("check-unique") || command === "apply";
  const audits = [];
  for (const model of models) audits.push(await lib.auditModel(model, { checkUnique }));

  if (!asJson) {
    for (const audit of audits) {
      const problems = audit.findings.filter((finding) => finding.status !== "present" && finding.status !== "present_under_another_name").length + audit.extra.length;
      if (problems === 0 && command !== "audit") continue;
      say(`\n${audit.model} (${audit.collection}) ${audit.collectionExists ? `${audit.documents ?? 0} documents` : "collection does not exist yet"}`);
      for (const finding of audit.findings) {
        const label = { present: "ok       ", present_under_another_name: "ok (name)", missing: "MISSING  ", conflict: "CONFLICT " }[finding.status];
        const notes = [finding.declared.unique ? "unique" : "", finding.declared.partialFilterExpression ? "partial" : "", finding.declared.sparse ? "sparse" : "", finding.declared.expireAfterSeconds !== undefined ? "ttl" : ""].filter(Boolean).join(" ");
        const duplicates = finding.duplicateGroups ? `  !! ${finding.duplicateGroups} duplicate group(s): a build would fail` : "";
        const conflict = finding.status === "conflict" && finding.existing ? `  existing "${finding.existing.name}" differs; left untouched` : "";
        say(`  ${label} ${finding.declared.name}  ${describeKeys(finding.declared.keys)}${notes ? `  [${notes}]` : ""}${duplicates}${conflict}`);
      }
      for (const extra of audit.extra) say(`  extra     ${extra.name}  ${describeKeys(extra.key)}  (not declared; kept)`);
    }
  }

  const summary = lib.summarize(audits);
  let failed = false;
  const applied = [];
  if (command === "apply" && flag("apply")) {
    for (const model of models) {
      const result = await lib.createMissingIndexes(model);
      applied.push(result);
      if (result.skipped.length > 0) failed = true;
      if (!asJson && (result.created.length > 0 || result.skipped.length > 0)) {
        say(`\n${result.model}: created ${result.created.length}${result.created.length ? ` (${result.created.join(", ")})` : ""}`);
        for (const skipped of result.skipped) say(`  NOT created ${skipped.name}: ${skipped.reason}`);
      }
    }
  }

  if (asJson) console.log(JSON.stringify({ database, host, summary, audits, applied }, null, 2));
  else {
    say(`\nSummary: ${summary.models} models, ${summary.declared} declared indexes: ${summary.present} present, ${summary.missing} missing (${summary.uniqueMissing} unique), ${summary.conflicts} conflicting, ${summary.extra} extra (kept).`);
    if (summary.uniqueWithDuplicates > 0) say(`WARNING: ${summary.uniqueWithDuplicates} missing unique index(es) would fail to build because documents already share the key.`);
    if (command === "apply" && !flag("apply")) say("This was the plan only. Add --apply to create the missing indexes.");
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("Index command failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
