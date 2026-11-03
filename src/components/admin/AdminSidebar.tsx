"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Tag,
  Home,
  DoorOpen,
  FileText,
  Building2,
  LogOut,
  Store,
  Activity,
  ShieldCheck,
  Users,
  Palette,
  Building,
  Receipt,
  Percent,
  FileSpreadsheet,
  CalendarClock,
  Send,
  Kanban,
  UserCheck,
  Contact,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { canSeeAdminNavItem, toAdminNavRole } from "@/lib/adminNav";
import { useConfirmSignOut } from "@/components/shared/SignOutButton";
import { usePageLoading } from "@/components/providers/NavigationLoaderProvider";
import AnimatedNavItem from "./sidebar/AnimatedNavItem";
import { useAppNavigation } from "./AppNavigationContext";
import { filterNavGroupsForApp } from "@/lib/appNavigationRegistry";
import AppSwitcher from "./sidebar/AppSwitcher";
import AnimatedIcon, { NAV_ICON_ANIMATION_BY_HREF } from "./sidebar/AnimatedIcon";
import CollapsedTooltip from "./sidebar/CollapsedTooltip";
import { DURATION, EASE, STAGGER_S } from "./sidebar/motionTokens";

interface NavGroup {
  title: string;
  items: {
    href: string;
    label: string;
    icon: React.ElementType;
  }[];
}

const navGroups: NavGroup[] = [
  {
    title: "OVERVIEW",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "CATALOG MANAGEMENT",
    items: [
      { href: "/admin/products", label: "Products", icon: Package },
      { href: "/admin/categories", label: "Categories", icon: Tag },
      { href: "/admin/tax-settings", label: "GST & HSN/SAC", icon: Receipt },
      { href: "/admin/pricing", label: "Bulk Pricing", icon: Percent },
      { href: "/admin/import-export", label: "Import / Export", icon: FileSpreadsheet },
      { href: "/admin/house-types", label: "Premices Types", icon: Home },
      { href: "/admin/room-types", label: "Room Types", icon: DoorOpen },
    ],
  },
  {
    title: "CRM & LEADS",
    items: [
      { href: "/admin/crm/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/admin/crm/leads", label: "Leads", icon: UserCheck },
      { href: "/admin/crm/follow-ups", label: "Follow-ups", icon: CalendarClock },
      { href: "/admin/crm/customers", label: "Customers", icon: Contact },
      { href: "/admin/crm/sources", label: "Lead Sources", icon: SlidersHorizontal },
      { href: "/admin/crm/assignment", label: "Assignment Rules", icon: Workflow },
    ],
  },
  {
    title: "PROPOSALS & DEALERS",
    items: [
      { href: "/admin/quotations", label: "Quotations", icon: FileText },
      { href: "/admin/deliveries", label: "Deliveries", icon: Send },
      { href: "/admin/dealers", label: "Dealers", icon: Store },
    ],
  },
  {
    title: "OVERSIGHT",
    items: [
      { href: "/admin/companies", label: "Companies", icon: Building },
      { href: "/admin/activity", label: "Activity Log", icon: Activity },
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/roles", label: "Roles & Permissions", icon: ShieldCheck },
    ],
  },
  {
    title: "SYSTEM SETTINGS",
    items: [
      { href: "/admin/company", label: "Company Profile", icon: Building2 },
      { href: "/admin/theme", label: "Theme & Branding", icon: Palette },
    ],
  },
];

/** Entrance: fade + rise 6px. `custom` is the row's delay in seconds. */
const rowVariants = {
  hidden: { opacity: 0, y: 6 },
  show: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay, duration: DURATION.base, ease: EASE },
  }),
};

/** Label/title fade used by collapse: out in the first 120ms, back in once the width settles. */
const collapseFade = {
  initial: { opacity: 0, x: -6 },
  animate: { opacity: 1, x: 0, transition: { delay: DURATION.layout, duration: DURATION.base, ease: EASE } },
  exit: { opacity: 0, x: -6, transition: { duration: 0.12, ease: EASE } },
};

export default function AdminSidebar({
  onClose,
  collapsed = false,
  entranceDelay = 0,
}: {
  onClose?: () => void;
  /** Desktop icon-rail mode. */
  collapsed?: boolean;
  /** Extra delay before the entrance stagger (mobile: wait for the drawer to settle). */
  entranceDelay?: number;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { activeApp, formatHref } = useAppNavigation();
  const { startFullscreenLoading } = usePageLoading();
  const reduceMotion = useReducedMotion();

  const confirmSignOut = useConfirmSignOut("/admin/login");

  const handleSignOut = () => {
    void confirmSignOut(startFullscreenLoading);
  };

  const userName = session?.user?.name || "Administrator";
  const userEmail = session?.user?.email || "";
  const rawRole = (session?.user as { role?: string })?.role;
  const userPermissions = (session?.user as { permissions?: string[] })?.permissions ?? [];
  const currentRole = toAdminNavRole(rawRole);
  const userRole =
    currentRole === "super_admin"
      ? "Super Admin"
      : currentRole === "company_owner"
      ? "Company Owner"
      : currentRole === "configurable_admin"
      ? "Configurable Admin"
      : "Admin";

  // Entrance plays once per mount — the sidebar lives in the persistent panel
  // layout, so route changes never replay it. A group title shares its first
  // item's slot, which keeps the whole entrance under ~700ms.
  const entranceInitial = reduceMotion ? false : "hidden";
  let rowIndex = 0;
  const nextDelay = () => entranceDelay + rowIndex++ * STAGGER_S;

  return (
    <aside data-admin-sidebar="" className="w-full bg-[#111111] flex flex-col h-full border-r border-[#1E1E22] select-none">
      <AppSwitcher collapsed={collapsed} onNavigate={onClose} />
      {/* Scrollable Navigation Groups — layoutScroll keeps the gliding indicator correct while scrolled. */}
      <motion.nav layoutScroll className="flex-1 p-3 sm:p-4 space-y-6 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {filterNavGroupsForApp(navGroups, activeApp).map((group) => {
          const visibleItems = group.items.filter((item) => canSeeAdminNavItem(item.href, currentRole, userPermissions));
          if (visibleItems.length === 0) return null;
          const groupDelay = entranceDelay + rowIndex * STAGGER_S;
          return (
            <div key={group.title} className="space-y-1.5">
              <motion.div
                variants={rowVariants}
                custom={groupDelay}
                initial={entranceInitial}
                animate="show"
                className="relative h-4"
              >
                <AnimatePresence initial={false}>
                  {!collapsed ? (
                    <motion.div key="title" {...collapseFade} className="absolute inset-0 flex items-center gap-2 px-3">
                      <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-[#666672]">
                        {group.title}
                      </span>
                      <motion.span
                        aria-hidden="true"
                        className="h-px flex-1 origin-left bg-white/15"
                        initial={reduceMotion ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ delay: groupDelay + 0.15, duration: DURATION.base, ease: EASE }}
                      />
                    </motion.div>
                  ) : (
                    <motion.span
                      key="divider"
                      aria-hidden="true"
                      className="absolute left-[14px] top-1/2 h-px w-4 bg-white/15"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { delay: 0.12, duration: DURATION.fast } }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    />
                  )}
                </AnimatePresence>
                {collapsed && <span className="sr-only">{group.title}</span>}
              </motion.div>

              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/admin/dashboard" && pathname.startsWith(item.href));
                  return (
                    <motion.div
                      key={item.href}
                      variants={rowVariants}
                      custom={nextDelay()}
                      initial={entranceInitial}
                      animate="show"
                    >
                      <AnimatedNavItem
                        href={formatHref(item.href)}
                        label={item.label}
                        icon={item.icon}
                        animation={NAV_ICON_ANIMATION_BY_HREF[item.href] ?? "generic"}
                        isActive={isActive}
                        collapsed={collapsed}
                        onNavigate={onClose}
                      />
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </motion.nav>

      {/* User Profile & Sign Out Footer — fades up last. */}
      <motion.div
        variants={rowVariants}
        custom={entranceDelay + rowIndex * STAGGER_S}
        initial={entranceInitial}
        animate="show"
        className="p-3.5 border-t border-[#1E1E22] shrink-0 bg-[#0A0A0C] space-y-2"
      >
        <CollapsedTooltip label={`${userName} · ${userRole}`} enabled={collapsed}>
          <Link
            href="/admin/account"
            onClick={onClose}
            aria-label={`My account (${userName})`}
            data-testid="sidebar-account-link"
            className="profile-card-glow group flex items-center gap-2.5 px-2 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 transition-colors hover:bg-white/[0.06] outline-hidden focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-[var(--color-admin-primary-on-dark,#D85B83)]"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--color-admin-primary-on-dark,#D85B83)]/20 border border-[var(--color-admin-primary-on-dark,#D85B83)]/40 text-[var(--color-admin-primary-on-dark,#D85B83)] flex items-center justify-center font-bold text-xs shrink-0 transition-[translate] duration-[var(--motion-fast)] ease-[var(--motion-ease)] group-hover:-translate-y-px">
              {userName.charAt(0).toUpperCase()}
            </div>
            <AnimatePresence initial={false} mode="popLayout">
              {!collapsed && (
                <motion.div key="profile-text" {...collapseFade} className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-bold text-white truncate">{userName}</p>
                    <span className="role-chip-shimmer text-[9px] font-bold text-[var(--color-admin-primary-on-dark,#D85B83)] bg-[var(--color-admin-primary-on-dark,#D85B83)]/10 border border-[var(--color-admin-primary-on-dark,#D85B83)]/20 px-1.5 py-0.2 rounded-md uppercase tracking-wider shrink-0">
                      {userRole}
                    </span>
                  </div>
                  {userEmail && (
                    <p className="text-[11px] text-neutral-400 truncate">{userEmail}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </Link>
        </CollapsedTooltip>

        <CollapsedTooltip label="Sign Out" enabled={collapsed}>
          <button
            onClick={handleSignOut}
            aria-label={collapsed ? "Sign Out" : undefined}
            className={cn(
              "nav-anim-trigger group flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-neutral-400 hover:text-white hover:bg-red-500/10 hover:border-red-500/30 w-full cursor-pointer border border-transparent",
              "outline-hidden transition-[color,background-color,border-color,scale] duration-[var(--motion-fast)] ease-[var(--motion-ease)] active:scale-[0.98] focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-[var(--color-admin-primary-on-dark,#D85B83)]"
            )}
          >
            <AnimatedIcon
              icon={LogOut}
              animation="sign-out"
              size={15}
              className="text-neutral-400 group-hover:text-red-400 transition-colors"
            />
            <AnimatePresence initial={false} mode="popLayout">
              {!collapsed && (
                <motion.span key="sign-out-label" {...collapseFade}>
                  Sign Out
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </CollapsedTooltip>
      </motion.div>
    </aside>
  );
}
