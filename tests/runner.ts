/**
 * Whyte Quotation Platform — Unified Automated Test Runner
 * Executes all active unit, integration, validation, and database safety suites.
 */
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";

interface SuiteResult {
  name: string;
  path: string;
  exitCode: number;
  durationMs: number;
  error?: string;
}

const SUITES = [
  "tests/smart-room-template-system.test.ts",
  "tests/room-template-system.test.ts",
  "tests/room-clone-and-presets.test.ts",
  "tests/phase6-space-management.test.ts",
  "tests/phase5-quotation-creation.test.ts",
  "tests/phase3-device-addition.test.ts",
  "tests/quotation-item-pricing.test.ts",
  "tests/tax-settings.test.ts",
  "tests/auth-rate-limit.test.ts",
  "tests/whatsapp-service-security.test.ts",
  "tests/independent-quotation-items.test.ts",
  "tests/phase7-safety-and-failure.test.ts",
  "tests/phase7-db-failure.test.ts",
];

async function runAll() {
  console.log("===============================================================");
  console.log(" Whyte Quotation — Unified Test Suite Execution");
  console.log("===============================================================\n");

  const results: SuiteResult[] = [];
  const startAll = Date.now();

  for (const suite of SUITES) {
    const suiteName = suite.replace(/^tests\//, "").replace(/\.test\.(ts|mjs)$/, "");
    process.stdout.write(`• Running ${suiteName} ... `);

    const start = Date.now();
    const isMjs = suite.endsWith(".mjs");
    const tsNodeScript = resolve(__dirname, "../node_modules/ts-node/dist/bin.js");

    const cmd = process.execPath;
    const args = isMjs
      ? [suite]
      : [
          tsNodeScript,
          "-T",
          "-P",
          "tsconfig.testrun.json",
          "-r",
          "tsconfig-paths/register",
          suite,
        ];

    const proc = spawnSync(cmd, args, {
      cwd: resolve(__dirname, ".."),
      encoding: "utf8",
      shell: false,
      timeout: 45_000,
      env: {
        ...process.env,
        NODE_ENV: "test",
        NEXTAUTH_SECRET: "ci_unified_test_secret_32_characters_long",
        NEXTAUTH_URL: "http://localhost:3000",
        WHATSAPP_BRIDGE_SECRET: "ci_unified_bridge_secret",
      },
    });

    const durationMs = Date.now() - start;

    if (proc.status === 0) {
      console.log(`\x1b[32mPASS\x1b[0m (${(durationMs / 1000).toFixed(2)}s)`);
      results.push({ name: suiteName, path: suite, exitCode: 0, durationMs });
    } else {
      console.log(`\x1b[31mFAIL\x1b[0m (${(durationMs / 1000).toFixed(2)}s)`);
      console.error(proc.stdout || proc.stderr || "Unknown execution error");
      results.push({
        name: suiteName,
        path: suite,
        exitCode: proc.status ?? 1,
        durationMs,
        error: proc.stderr || proc.stdout,
      });
    }
  }

  const totalDuration = ((Date.now() - startAll) / 1000).toFixed(2);
  const passed = results.filter((r) => r.exitCode === 0);
  const failed = results.filter((r) => r.exitCode !== 0);

  console.log("\n===============================================================");
  console.log(` SUMMARY: ${passed.length}/${results.length} suites passed in ${totalDuration}s`);
  console.log("===============================================================\n");

  if (failed.length > 0) {
    console.error(`\x1b[31mFailed Suites:\x1b[0m`);
    for (const f of failed) {
      console.error(`  - ${f.name} (${f.path})`);
    }
    process.exit(1);
  }

  process.exit(0);
}

runAll().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
