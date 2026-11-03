import {
  LayoutDashboard,
  Handshake,
  TrendingUp,
  Package,
  Contact,
  Users,
  Calendar,
  CalendarCheck,
  Sparkles,
  Calculator,
  CheckSquare,
  Heart,
  ShoppingCart,
  Wrench,
  Receipt,
  type LucideIcon,
} from "lucide-react";

export type AppId =
  | "dashboard"
  | "crm"
  | "sales"
  | "inventory"
  | "contacts"
  | "employees"
  | "calendar"
  | "appointments"
  | "ai"
  | "accounting"
  | "project"
  | "social-marketing"
  | "purchase"
  | "maintenance"
  | "expenses"
  | (string & {});

export type AppStatus = "active" | "coming_soon";

export interface AppNavigationEntry {
  id: string;
  label: string;
  shortLabel?: string;
  description: string;
  icon: LucideIcon;
  landingRoute: string;
  /** "*" means full navigation (all authorized menus); otherwise a whitelist of allowed sidebar item hrefs */
  permittedHrefs: readonly string[] | "*";
  status: AppStatus;
  /** Alternate IDs / aliases that resolve to this app (e.g. "dashboards" -> "dashboard") */
  aliases?: readonly string[];
}

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Central typed registry for Whyte Automations modular apps.
 *
 * Each active app maps to a dedicated landing route and an explicit set of permitted
 * sidebar navigation hrefs. When in "dashboard" mode, permittedHrefs is "*", rendering
 * the full authorized menu hierarchy without modification.
 */
export const APP_NAVIGATION_REGISTRY: readonly AppNavigationEntry[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    shortLabel: "Dashboard",
    description: "Complete administration center with all authorized modules",
    icon: LayoutDashboard,
    landingRoute: "/admin/dashboard",
    permittedHrefs: "*",
    status: "active",
    aliases: ["dashboards"],
  },
  {
    id: "crm",
    label: "CRM",
    shortLabel: "CRM",
    description: "Leads, pipeline stages, follow-up scheduling & customer profiles",
    icon: Handshake,
    landingRoute: "/admin/crm/pipeline",
    permittedHrefs: [
      "/admin/crm/pipeline",
      "/admin/crm/leads",
      "/admin/crm/follow-ups",
      "/admin/crm/customers",
      "/admin/crm/sources",
      "/admin/crm/assignment",
    ],
    status: "active",
  },
  {
    id: "sales",
    label: "Sales",
    shortLabel: "Sales",
    description: "Quotations, dispatch deliveries and dealer network operations",
    icon: TrendingUp,
    landingRoute: "/admin/quotations",
    permittedHrefs: [
      "/admin/quotations",
      "/admin/deliveries",
      "/admin/dealers",
    ],
    status: "active",
  },
  {
    id: "inventory",
    label: "Inventory",
    shortLabel: "Inventory",
    description: "Products, categories, tax settings, premises & room definitions",
    icon: Package,
    landingRoute: "/admin/products",
    permittedHrefs: [
      "/admin/products",
      "/admin/categories",
      "/admin/tax-settings",
      "/admin/house-types",
      "/admin/room-types",
    ],
    status: "active",
  },
  {
    id: "contacts",
    label: "Contacts",
    shortLabel: "Contacts",
    description: "Customer contacts and authorized dealer directory",
    icon: Contact,
    landingRoute: "/admin/crm/customers",
    permittedHrefs: [
      "/admin/crm/customers",
      "/admin/dealers",
    ],
    status: "active",
  },
  {
    id: "employees",
    label: "Employees",
    shortLabel: "Employees",
    description: "Staff accounts, security roles and granular permissions",
    icon: Users,
    landingRoute: "/admin/users",
    permittedHrefs: [
      "/admin/users",
      "/admin/roles",
    ],
    status: "active",
  },
  // ── Coming Soon Apps (Preserve Launch Grid State) ──────────────────────────
  {
    id: "calendar",
    label: "Calendar",
    description: "Team schedules, follow-up events and calendar sync",
    icon: Calendar,
    landingRoute: "/apps/calendar",
    permittedHrefs: [],
    status: "coming_soon",
  },
  {
    id: "appointments",
    label: "Appointments",
    description: "Customer consultation booking and meeting management",
    icon: CalendarCheck,
    landingRoute: "/apps/appointments",
    permittedHrefs: [],
    status: "coming_soon",
  },
  {
    id: "ai",
    label: "AI",
    description: "Intelligent lead scoring, quotation automation and insights",
    icon: Sparkles,
    landingRoute: "/apps/ai",
    permittedHrefs: [],
    status: "coming_soon",
  },
  {
    id: "accounting",
    label: "Accounting",
    description: "Financial ledgers, invoices, payments and accounts",
    icon: Calculator,
    landingRoute: "/apps/accounting",
    permittedHrefs: [],
    status: "coming_soon",
  },
  {
    id: "project",
    label: "Project",
    description: "Project management, delivery tracking and milestones",
    icon: CheckSquare,
    landingRoute: "/apps/project",
    permittedHrefs: [],
    status: "coming_soon",
  },
  {
    id: "social-marketing",
    label: "Social Marketing",
    description: "Social media campaigns, outreach and brand engagement",
    icon: Heart,
    landingRoute: "/apps/social-marketing",
    permittedHrefs: [],
    status: "coming_soon",
  },
  {
    id: "purchase",
    label: "Purchase",
    description: "Vendor procurement, purchase orders and bill receipts",
    icon: ShoppingCart,
    landingRoute: "/apps/purchase",
    permittedHrefs: [],
    status: "coming_soon",
  },
  {
    id: "maintenance",
    label: "Maintenance",
    description: "Hardware repairs, servicing tickets and warranty management",
    icon: Wrench,
    landingRoute: "/apps/maintenance",
    permittedHrefs: [],
    status: "coming_soon",
  },
  {
    id: "expenses",
    label: "Expenses",
    description: "Team expense claims, approvals and reimbursements",
    icon: Receipt,
    landingRoute: "/apps/expenses",
    permittedHrefs: [],
    status: "coming_soon",
  },
];

/**
 * Returns all active apps that appear in the App Switcher.
 */
export function getActiveApps(): AppNavigationEntry[] {
  return APP_NAVIGATION_REGISTRY.filter((app) => app.status === "active");
}

/**
 * Resolves an app identifier or alias to its canonical app ID.
 * Defaults to "dashboard" if not found or empty.
 */
export function resolveAppId(rawId: string | null | undefined): string {
  if (!rawId) return "dashboard";
  const normalized = rawId.trim().toLowerCase();
  const match = APP_NAVIGATION_REGISTRY.find(
    (app) => app.id === normalized || app.aliases?.includes(normalized)
  );
  return match ? match.id : "dashboard";
}

/**
 * Retrieves the full AppNavigationEntry for a given ID or alias.
 * Always returns a valid entry (falls back to dashboard).
 */
export function getAppById(rawId: string | null | undefined): AppNavigationEntry {
  const canonicalId = resolveAppId(rawId);
  return (
    APP_NAVIGATION_REGISTRY.find((app) => app.id === canonicalId) ||
    APP_NAVIGATION_REGISTRY[0] // fallback to dashboard
  );
}

/**
 * Determines a predictable default app based solely on the current URL pathname.
 * Used for direct deep links where no explicit `?app=` parameter or session storage exists.
 */
export function getDefaultAppForRoute(pathname: string): AppNavigationEntry {
  if (!pathname || pathname === "/" || pathname === "/admin/dashboard") {
    return getAppById("dashboard");
  }

  if (pathname.startsWith("/admin/crm")) {
    return getAppById("crm");
  }

  if (
    pathname.startsWith("/admin/quotations") ||
    pathname.startsWith("/admin/deliveries")
  ) {
    return getAppById("sales");
  }

  if (
    pathname.startsWith("/admin/products") ||
    pathname.startsWith("/admin/categories") ||
    pathname.startsWith("/admin/tax-settings") ||
    pathname.startsWith("/admin/house-types") ||
    pathname.startsWith("/admin/room-types")
  ) {
    return getAppById("inventory");
  }

  if (pathname.startsWith("/admin/dealers")) {
    return getAppById("sales");
  }

  if (pathname.startsWith("/admin/users") || pathname.startsWith("/admin/roles")) {
    return getAppById("employees");
  }

  // All other admin routes (activity, company profile, theme, etc.) default to full dashboard
  return getAppById("dashboard");
}

/**
 * Filters the standard sidebar NavGroups according to the selected App's permitted menu hrefs.
 * When the app has permittedHrefs: "*", all groups and items are preserved.
 * When specific permittedHrefs are provided, only matching items are kept; groups with 0 items are removed.
 */
export function filterNavGroupsForApp(
  groups: readonly NavGroup[],
  app: AppNavigationEntry
): NavGroup[] {
  if (app.permittedHrefs === "*") {
    // Full navigation: return all groups untouched
    return [...groups];
  }

  const allowedSet = new Set(app.permittedHrefs);

  return groups
    .map((group) => {
      const filteredItems = group.items.filter((item) => allowedSet.has(item.href));
      return {
        ...group,
        items: filteredItems,
      };
    })
    .filter((group) => group.items.length > 0);
}

/**
 * Formats a navigation href to preserve the currently active app context as a URL query param.
 * If targetAppId is "dashboard", the `?app=dashboard` parameter ensures that subsequent
 * navigations retain the full-sidebar mode.
 */
export function formatAppHref(href: string, appId: string | null | undefined): string {
  if (!href) return href;
  if (!appId) return href;

  const resolved = resolveAppId(appId);
  // Separate existing hash and query if any
  const [baseAndQuery, hash] = href.split("#");
  const [base, queryString] = baseAndQuery.split("?");

  const params = new URLSearchParams(queryString || "");
  params.set("app", resolved);

  const newUrl = `${base}?${params.toString()}`;
  return hash ? `${newUrl}#${hash}` : newUrl;
}

