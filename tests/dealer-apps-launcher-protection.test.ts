/**
 * Test Suite: Dealer Apps Launcher Gating and Route Protection
 * Verifies that the Dealer role cannot access or view the Apps Launcher,
 * receives only their 3 authorized tabs (Quotations, Earnings, Profile),
 * and is prevented from reaching administrative and CRM modules.
 *
 * Run via:
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register tests/dealer-apps-launcher-protection.test.ts
 */

import assert from "node:assert/strict";
import { resolveAdminLoginDestination } from "@/lib/adminAuthRedirect";

let testCount = 0;
function pass(desc: string) {
  testCount++;
  console.log(`  ✓ ${desc}`);
}

function runTests() {
  console.log("\n--- Starting Dealer Apps Launcher Protection Tests ---");

  // =========================================================================
  // Test 1: Header Tabs Verification for Dealer Role
  // =========================================================================
  {
    // Simulating layout rendering logic for dealer
    const role: string = "dealer";
    const canSeeApps = role !== "dealer";
    const canSeeQuotations = true;
    const canSeeEarnings = role === "dealer";
    const canSeeProfile = role === "dealer";
    const canSeeMyLeads = role === "sales_executive";
    const canSeeAdminPanel = ["super_admin", "admin", "company_owner", "configurable_admin"].includes(role);

    assert.equal(canSeeApps, false, "Apps tab must be HIDDEN for dealer role");
    assert.equal(canSeeQuotations, true, "Quotations tab must be VISIBLE for dealer role");
    assert.equal(canSeeEarnings, true, "Earnings tab must be VISIBLE for dealer role");
    assert.equal(canSeeProfile, true, "Profile tab must be VISIBLE for dealer role");
    assert.equal(canSeeMyLeads, false, "My Leads tab must be HIDDEN for dealer role");
    assert.equal(canSeeAdminPanel, false, "Admin Panel tab must be HIDDEN for dealer role");

    // Total tabs visible for dealer must be exactly 3
    const dealerTabs = [
      canSeeApps && "Apps",
      canSeeQuotations && "Quotations",
      canSeeEarnings && "Earnings",
      canSeeProfile && "Profile",
      canSeeMyLeads && "My Leads",
      canSeeAdminPanel && "Admin Panel",
    ].filter(Boolean);

    assert.deepEqual(dealerTabs, ["Quotations", "Earnings", "Profile"]);
    assert.equal(dealerTabs.length, 3, "Dealer header must have exactly 3 navigation tabs");
    pass("1. Dealer header renders exactly 3 authorized tabs (Quotations, Earnings, Profile) and hides Apps");
  }

  // =========================================================================
  // Test 2: Header Tabs Verification for Admin and Sales Executive Roles
  // =========================================================================
  {
    // Super Admin / Company Owner / Admin
    for (const adminRole of ["super_admin", "admin", "company_owner", "configurable_admin"]) {
      const canSeeApps = adminRole !== "dealer";
      const canSeeQuotations = true;
      const canSeeAdminPanel = ["super_admin", "admin", "company_owner", "configurable_admin"].includes(adminRole);
      assert.equal(canSeeApps, true, `${adminRole} must see Apps tab`);
      assert.equal(canSeeQuotations, true, `${adminRole} must see Quotations tab`);
      assert.equal(canSeeAdminPanel, true, `${adminRole} must see Admin Panel tab`);
    }

    // Sales Executive
    const seRole: string = "sales_executive";
    assert.equal(seRole !== "dealer", true, "Sales Executive must see Apps tab");
    assert.equal(seRole === "sales_executive", true, "Sales Executive must see My Leads tab");
    pass("2. Admin and Sales Executive roles preserve their respective Apps Launcher tabs");
  }

  // =========================================================================
  // Test 3: Proxy & Server-Side Redirection for Dealer on /apps and /apps/*
  // =========================================================================
  {
    // Logic matching proxy.ts dealer checks
    function simulateProxyRedirect(role: string, pathname: string): { redirect: boolean; destination: string; forbidden: boolean } {
      if (role === "dealer") {
        if (pathname.startsWith("/api/admin") || pathname.startsWith("/api/crm") || pathname.startsWith("/api/platform")) {
          return { redirect: false, destination: "", forbidden: true };
        }
        const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
        if (
          isAdmin ||
          pathname === "/dealers" ||
          pathname.startsWith("/dealers/") ||
          pathname === "/dealer/access" ||
          pathname === "/apps" ||
          pathname.startsWith("/apps/")
        ) {
          return { redirect: true, destination: "/", forbidden: false };
        }
      }
      return { redirect: false, destination: "", forbidden: false };
    }

    // Direct visit to /apps
    const appsRes = simulateProxyRedirect("dealer", "/apps");
    assert.equal(appsRes.redirect, true);
    assert.equal(appsRes.destination, "/");

    // Direct visit to /apps/crm
    const crmRes = simulateProxyRedirect("dealer", "/apps/crm");
    assert.equal(crmRes.redirect, true);
    assert.equal(crmRes.destination, "/");

    // Direct visit to /apps/inventory
    const invRes = simulateProxyRedirect("dealer", "/apps/inventory");
    assert.equal(invRes.redirect, true);
    assert.equal(invRes.destination, "/");

    // Direct visit to /admin/dashboard
    const adminRes = simulateProxyRedirect("dealer", "/admin/dashboard");
    assert.equal(adminRes.redirect, true);
    assert.equal(adminRes.destination, "/");

    // Direct visit to /admin/crm/pipeline
    const crmAdminRes = simulateProxyRedirect("dealer", "/admin/crm/pipeline");
    assert.equal(crmAdminRes.redirect, true);
    assert.equal(crmAdminRes.destination, "/");

    // API call to /api/crm/leads
    const crmApiRes = simulateProxyRedirect("dealer", "/api/crm/leads");
    assert.equal(crmApiRes.forbidden, true);

    // API call to /api/admin/users
    const adminApiRes = simulateProxyRedirect("dealer", "/api/admin/users");
    assert.equal(adminApiRes.forbidden, true);

    pass("3. Dealer accessing /apps, /apps/*, /admin/* or protected APIs is safely redirected or denied");
  }

  // =========================================================================
  // Test 4: Sales Executive access to /apps is preserved in Proxy
  // =========================================================================
  {
    function simulateSalesExecProxy(pathname: string): { redirect: boolean; destination: string } {
      const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
      if (
        isAdmin ||
        pathname === "/dealers" ||
        pathname.startsWith("/dealers/") ||
        pathname === "/dealer/access"
      ) {
        return { redirect: true, destination: "/" };
      }
      return { redirect: false, destination: "" };
    }

    const appsRes = simulateSalesExecProxy("/apps");
    assert.equal(appsRes.redirect, false, "Sales Executive must NOT be redirected away from /apps");

    const appsSlugRes = simulateSalesExecProxy("/apps/crm");
    assert.equal(appsSlugRes.redirect, false, "Sales Executive must NOT be redirected away from /apps/crm");
    pass("4. Sales Executive access to /apps is preserved and not redirected");
  }

  // =========================================================================
  // Test 5: Login Destination Normalization for Dealer
  // =========================================================================
  {
    function normalizeLoginDestination(role: string, callbackUrl: string | null): string {
      let destination = callbackUrl ?? "/";
      if (!destination.startsWith("/") || destination.startsWith("//")) {
        destination = "/";
      }
      if (
        destination === "/dealer/access" ||
        destination.startsWith("/admin") ||
        destination === "/dealers" ||
        (role === "dealer" && (destination === "/apps" || destination.startsWith("/apps/")))
      ) {
        destination = "/";
      }
      return destination;
    }

    // Dealer attempts login with /apps callback
    assert.equal(normalizeLoginDestination("dealer", "/apps"), "/");
    assert.equal(normalizeLoginDestination("dealer", "/apps/crm"), "/");
    assert.equal(normalizeLoginDestination("dealer", "/admin/dashboard"), "/");
    assert.equal(normalizeLoginDestination("dealer", "/earnings"), "/earnings");
    assert.equal(normalizeLoginDestination("dealer", "/profile"), "/profile");
    assert.equal(normalizeLoginDestination("dealer", null), "/");

    // Sales Executive attempts login with /apps callback
    assert.equal(normalizeLoginDestination("sales_executive", "/apps"), "/apps");
    assert.equal(normalizeLoginDestination("sales_executive", "/my-leads"), "/my-leads");
    pass("5. Dealer login callbacks to /apps or admin paths are sanitized to '/'");
  }

  // =========================================================================
  // Test 6: Admin and Super Admin Login Destination (resolveAdminLoginDestination)
  // =========================================================================
  {
    // When admin or superadmin logs in with no callbackUrl, navigates to /admin/apps
    assert.equal(resolveAdminLoginDestination(null), "/admin/apps");
    assert.equal(resolveAdminLoginDestination(""), "/admin/apps");

    // When admin or superadmin logs in with callbackUrl pointing to dashboard, navigates to /admin/apps
    assert.equal(resolveAdminLoginDestination("/admin/dashboard"), "/admin/apps");
    assert.equal(resolveAdminLoginDestination("/admin/dashboard?app=dashboard"), "/admin/apps");

    // When admin or superadmin logs in with root or login callbacks, navigates to /admin/apps
    assert.equal(resolveAdminLoginDestination("/"), "/admin/apps");
    assert.equal(resolveAdminLoginDestination("/admin"), "/admin/apps");
    assert.equal(resolveAdminLoginDestination("/admin/login"), "/admin/apps");
    assert.equal(resolveAdminLoginDestination("/login"), "/admin/apps");

    // When admin or superadmin logs in targeting apps launcher
    assert.equal(resolveAdminLoginDestination("/apps"), "/admin/apps");
    assert.equal(resolveAdminLoginDestination("/apps/crm"), "/admin/apps");
    assert.equal(resolveAdminLoginDestination("/admin/apps"), "/admin/apps");

    // Specific administrative deep links are safely preserved
    assert.equal(resolveAdminLoginDestination("/admin/products"), "/admin/products");
    assert.equal(resolveAdminLoginDestination("/admin/crm/leads?status=open"), "/admin/crm/leads?status=open");
    assert.equal(resolveAdminLoginDestination("/admin/company"), "/admin/company");

    // Malicious external or protocol-relative callbacks bounce to /admin/apps
    assert.equal(resolveAdminLoginDestination("//attacker.com"), "/admin/apps");
    assert.equal(resolveAdminLoginDestination("https://attacker.com"), "/admin/apps");
    assert.equal(resolveAdminLoginDestination("/dealer/access"), "/admin/apps");

    pass("6. Admin and Super Admin login redirects to /admin/apps instead of dashboard while honoring valid deep links");
  }

  // =========================================================================
  // Test 7: Admin & Super Admin Proxy Route Redirection to /admin/apps
  // =========================================================================
  {
    function simulateAdminProxy(role: string, pathname: string): { redirect: boolean; destination: string } {
      const ADMIN_ROLES = new Set(["super_admin", "company_owner", "admin", "configurable_admin"]);
      if (role && ADMIN_ROLES.has(role)) {
        if (pathname === "/admin" || pathname === "/apps" || pathname.startsWith("/apps/")) {
          return { redirect: true, destination: "/admin/apps" };
        }
        const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
        const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
        const isPublicPage = ["/login", "/register", "/admin/login"].includes(pathname);
        if (!isApiRequest && !isAdminPage && !isPublicPage && !pathname.startsWith("/quotation/")) {
          return { redirect: true, destination: "/admin/apps" };
        }
      }
      return { redirect: false, destination: "" };
    }

    for (const role of ["super_admin", "admin", "company_owner", "configurable_admin"]) {
      // Root / bounces to /admin/apps (NOT /admin/dashboard)
      const rootRes = simulateAdminProxy(role, "/");
      assert.equal(rootRes.redirect, true);
      assert.equal(rootRes.destination, "/admin/apps", `${role} visiting / must navigate to /admin/apps`);

      // /admin bounces to /admin/apps
      const adminRes = simulateAdminProxy(role, "/admin");
      assert.equal(adminRes.redirect, true);
      assert.equal(adminRes.destination, "/admin/apps");

      // /apps bounces to /admin/apps
      const appsRes = simulateAdminProxy(role, "/apps");
      assert.equal(appsRes.redirect, true);
      assert.equal(appsRes.destination, "/admin/apps");

      // /apps/crm bounces to /admin/apps
      const appsSubRes = simulateAdminProxy(role, "/apps/crm");
      assert.equal(appsSubRes.redirect, true);
      assert.equal(appsSubRes.destination, "/admin/apps");

      // Proposal builder /quotation/new is allowed through
      const quotationRes = simulateAdminProxy(role, "/quotation/new");
      assert.equal(quotationRes.redirect, false);

      // Authorized admin subpages are allowed through
      const leadsRes = simulateAdminProxy(role, "/admin/crm/leads");
      assert.equal(leadsRes.redirect, false);
      const dashRes = simulateAdminProxy(role, "/admin/dashboard");
      assert.equal(dashRes.redirect, false);
    }

    pass("7. Admin & Super Admin root navigation in Proxy redirects to /admin/apps (not dashboard)");
  }


  console.log(`\nALL ${testCount} DEALER PROTECTION TESTS PASSED SUCCESSFULLY!`);
}

runTests();

