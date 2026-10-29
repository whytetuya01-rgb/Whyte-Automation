/**
 * Dashboard & Analytics regression and correctness test suite.
 *
 * Checks:
 * 1. Date range resolution for 7d, 30d, 90d, 1y, all.
 * 2. Static tenant-isolation guards (no unscoped queries in dashboard page).
 * 3. Demo-mode development flags & synthetic CRM fixture safety.
 * 4. Metric calculation helpers (approval rate, financial derivation, dealer earnings).
 *
 * Run with:
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/dashboard-analytics.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDateRange } from "../src/lib/adminDashboardData";
import { getDemoCrmAnalytics, isDemoModeAllowed } from "../src/lib/dashboard/demoData";
import { deriveQuotationFinancials } from "../src/lib/quotationTotals";
import { calculateDealerEarning, resolveCustomerDiscountPercent } from "../src/lib/dealerEarnings";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function run() {
  console.log("Starting Dashboard & Analytics Tests...\n");

  // ── 1. Date Range Resolution ──
  test("resolveDateRange: 7d produces correct 7-day bounds and prior interval", () => {
    const fixedNow = new Date("2026-10-29T12:00:00Z");
    const res = resolveDateRange("7d", fixedNow);
    assert.equal(res.key, "7d");
    assert.equal(res.label, "Last 7 days");
    assert.ok(res.start);
    assert.equal(res.end.getTime(), fixedNow.getTime());
    const diffDays = Math.round((res.end.getTime() - res.start!.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diffDays, 7);
    assert.ok(res.priorStart);
    assert.equal(res.priorEnd?.getTime(), res.start?.getTime());
  });

  test("resolveDateRange: 30d produces 30-day interval", () => {
    const fixedNow = new Date("2026-10-29T12:00:00Z");
    const res = resolveDateRange("30d", fixedNow);
    assert.equal(res.key, "30d");
    const diffDays = Math.round((res.end.getTime() - res.start!.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diffDays, 30);
  });

  test("resolveDateRange: 90d produces 90-day interval", () => {
    const fixedNow = new Date("2026-10-29T12:00:00Z");
    const res = resolveDateRange("90d", fixedNow);
    assert.equal(res.key, "90d");
    const diffDays = Math.round((res.end.getTime() - res.start!.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diffDays, 90);
  });

  test("resolveDateRange: 1y produces current year start in IST", () => {
    const fixedNow = new Date("2026-10-29T12:00:00Z");
    const res = resolveDateRange("1y", fixedNow);
    assert.equal(res.key, "1y");
    assert.ok(res.start);
    assert.ok(res.start.toISOString().includes("2026-01-01") || res.start.toISOString().includes("2025-12-31"));
    assert.ok(res.priorStart);
  });

  test("resolveDateRange: all has null start date", () => {
    const fixedNow = new Date("2026-10-29T12:00:00Z");
    const res = resolveDateRange("all", fixedNow);
    assert.equal(res.key, "all");
    assert.equal(res.start, null);
    assert.equal(res.priorStart, null);
  });

  // ── 2. Demo Mode Safeguards ──
  test("isDemoModeAllowed obeys environment variable guards", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDemo = process.env.DASHBOARD_DEMO_DATA;
    const envObj = process.env as Record<string, string | undefined>;

    try {
      envObj.NODE_ENV = "production";
      delete envObj.DASHBOARD_DEMO_DATA;
      assert.equal(isDemoModeAllowed(), false, "Must be disabled in production by default");

      envObj.DASHBOARD_DEMO_DATA = "true";
      assert.equal(isDemoModeAllowed(), true, "Allowed when DASHBOARD_DEMO_DATA is true");

      envObj.NODE_ENV = "development";
      delete envObj.DASHBOARD_DEMO_DATA;
      assert.equal(isDemoModeAllowed(), true, "Allowed in development");
    } finally {
      envObj.NODE_ENV = originalEnv;
      if (originalDemo !== undefined) envObj.DASHBOARD_DEMO_DATA = originalDemo;
      else delete envObj.DASHBOARD_DEMO_DATA;
    }
  });

  test("getDemoCrmAnalytics produces strictly marked synthetic preview data", () => {
    const demo = getDemoCrmAnalytics();
    assert.equal(demo.isDemo, true);
    assert.ok(demo.summary.totalLeads > 0);
    assert.ok(demo.stages.length >= 4);
    assert.ok(demo.sources.length >= 3);
    assert.ok(demo.salespeople.length >= 2);

    // Sum of source percentages should approximate 100%
    const totalPercentage = demo.sources.reduce((sum, s) => sum + s.percentage, 0);
    assert.equal(totalPercentage, 100);
  });

  // ── 3. Static Tenant-Isolation Regression Guards ──
  test("dashboard/page.tsx does NOT run unscoped queries for company business metrics", () => {
    const dashboardPagePath = join(__dirname, "../src/app/admin/(panel)/dashboard/page.tsx");
    const content = readFileSync(dashboardPagePath, "utf8");

    // The legacy leak was: runUnscoped("platform-admin", () => Promise.all([getAdminDashboardData(), ...]))
    const hasUnscopedDashboard = /runUnscoped\s*\(\s*["']platform-admin["']\s*,\s*\(\)\s*=>\s*Promise\.all\(\s*\[\s*getAdminDashboardData/.test(content);
    assert.equal(hasUnscopedDashboard, false, "Dashboard page must never run unscoped queries for company metrics");
  });

  test("api/admin/dashboard route enforces tenant isolation and session authorization", () => {
    const apiRoutePath = join(__dirname, "../src/app/api/admin/dashboard/route.ts");
    const content = readFileSync(apiRoutePath, "utf8");

    assert.ok(content.includes("withSession"), "API route must require authenticated session");
    assert.ok(content.includes("withTenant"), "API route must wrap execution with withTenant");
    assert.ok(content.includes("actor.role === \"dealer\""), "API route must forbid dealer role from admin analytics");
  });

  // ── 4. Metric Calculation Sanity ──
  test("deriveQuotationFinancials calculates correct grand total with tax and discount", () => {
    const financials = deriveQuotationFinancials({
      subtotal: 100000,
      discountType: "percentage",
      discountValue: "10",
      customerDiscountPercent: 10,
      allocatedDiscountPercent: 20,
    });
    // Subtotal 1,00,000, 10% discount = 90,000 net, 18% GST (16,200) = 1,06,200 grand total
    assert.equal(financials.subtotal, 100000);
    assert.equal(financials.discountAmount, 10000);
    assert.equal(financials.netSubtotal, 90000);
    assert.equal(financials.totalGstAmount, 16200);
    assert.equal(financials.grandTotal, 106200);
  });

  test("calculateDealerEarning computes correct confirmed earning", () => {
    const result = calculateDealerEarning({
      subtotal: 100000,
      allocatedPercent: 25,
      customerPercent: 10,
    });
    // 25% - 10% = 15% earning on 1,00,000 = 15,000
    assert.equal(result.earningPercent, 15);
    assert.equal(result.earningAmount, 15000);
  });

  console.log(`\nAll ${passed} tests passed successfully!`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

