import {
  Calendar,
  CalendarCheck,
  Contact,
  Handshake,
  TrendingUp,
  LayoutDashboard,
  Sparkles,
  Calculator,
  CheckSquare,
  Heart,
  ShoppingCart,
  Package,
  Wrench,
  Users,
  Receipt,
  type LucideIcon,
} from "lucide-react";

export type LauncherRole =
  | "dealer"
  | "admin"
  | "super_admin"
  | "company_owner"
  | "configurable_admin"
  | "sales_executive";

export interface LauncherApp {
  slug: string;
  label: string;
  icon: LucideIcon;
  /** Where the tile goes for each role; a role without an entry sees the "coming soon" page. */
  hrefByRole: Partial<Record<LauncherRole, string>>;
}

const ADMINS: readonly LauncherRole[] = [
  "admin",
  "super_admin",
  "company_owner",
  "configurable_admin",
];

function adminOnly(href: string): LauncherApp["hrefByRole"] {
  return Object.fromEntries(ADMINS.map((role) => [role, href]));
}

/** The Odoo-style app grid, in display order (5 per row on desktop). */
export const LAUNCHER_APPS: readonly LauncherApp[] = [
  { slug: "calendar", label: "Calendar", icon: Calendar, hrefByRole: {} },
  { slug: "appointments", label: "Appointments", icon: CalendarCheck, hrefByRole: {} },
  { slug: "contacts", label: "Contacts", icon: Contact, hrefByRole: adminOnly("/admin/dealers") },
  { slug: "crm", label: "CRM", icon: Handshake, hrefByRole: adminOnly("/admin/crm/pipeline") },
  {
    slug: "sales",
    label: "Sales",
    icon: TrendingUp,
    hrefByRole: {
      dealer: "/",
      admin: "/",
      super_admin: "/",
      company_owner: "/",
      configurable_admin: "/",
      sales_executive: "/",
    },
  },
  { slug: "dashboards", label: "Dashboards", icon: LayoutDashboard, hrefByRole: adminOnly("/admin/dashboard") },
  { slug: "ai", label: "AI", icon: Sparkles, hrefByRole: {} },
  { slug: "accounting", label: "Accounting", icon: Calculator, hrefByRole: {} },
  { slug: "project", label: "Project", icon: CheckSquare, hrefByRole: {} },
  { slug: "social-marketing", label: "Social Marketing", icon: Heart, hrefByRole: {} },
  { slug: "purchase", label: "Purchase", icon: ShoppingCart, hrefByRole: {} },
  { slug: "inventory", label: "Inventory", icon: Package, hrefByRole: adminOnly("/admin/products") },
  { slug: "maintenance", label: "Maintenance", icon: Wrench, hrefByRole: {} },
  { slug: "employees", label: "Employees", icon: Users, hrefByRole: adminOnly("/admin/users") },
  { slug: "expenses", label: "Expenses", icon: Receipt, hrefByRole: {} },
];

export function findLauncherApp(slug: string): LauncherApp | undefined {
  return LAUNCHER_APPS.find((app) => app.slug === slug);
}

export function launcherHref(app: LauncherApp, role: string | undefined): string {
  const href = role ? app.hrefByRole[role as LauncherRole] : undefined;
  return href ?? `/apps/${app.slug}`;
}

