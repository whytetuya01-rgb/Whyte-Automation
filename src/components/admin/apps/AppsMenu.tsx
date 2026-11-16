"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import { MotionConfig, motion, type Variants } from "motion/react";
import { Search, X } from "lucide-react";
import { LAUNCHER_APPS, launcherHref, type LauncherApp } from "@/lib/appLauncher";
import { DURATION, EASE } from "@/components/admin/sidebar/motionTokens";
import { cn } from "@/lib/utils";

/**
 * Screen-reader / semantic summaries for accessible context and automated assertions.
 * Kept visually hidden (sr-only) so the main launcher exhibits pure Odoo ERP simplicity.
 */
const APP_SUMMARY: Record<string, string> = {
  contacts: "Customers, architects, builders and contractors",
  crm: "Leads, pipeline and follow-ups",
  sales: "Quotations, approvals and delivery",
  dashboards: "Revenue, conversion and team performance",
  inventory: "Products, series, pricing and GST",
  employees: "Users, roles and permissions",
};

/**
 * Iconic, vibrant yet refined squircle gradients inspired by Odoo ERP app tiles,
 * with Whyte signature rose-pink (#D85B83) for the Sales & Quotations module.
 */
const APP_GRADIENTS: Record<string, string> = {
  contacts: "bg-gradient-to-br from-cyan-500 to-teal-600 shadow-teal-500/20",
  crm: "bg-gradient-to-br from-emerald-500 to-teal-700 shadow-emerald-500/20",
  sales: "bg-gradient-to-br from-[#E0537A] via-[#D85B83] to-[#B83E68] shadow-[#D85B83]/25",
  dashboards: "bg-gradient-to-br from-indigo-500 to-purple-600 shadow-indigo-500/20",
  inventory: "bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/20",
  employees: "bg-gradient-to-br from-blue-600 to-indigo-700 shadow-blue-600/20",
};

const SPRING_TRANSITION = { type: "spring", stiffness: 420, damping: 26 } as const;

const listVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.06,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.base, ease: EASE },
  },
};

export interface AppsMenuProps {
  role?: string;
  permissions?: string[];
  firstName?: string;
  companyName?: string | null;
}

/**
 * WHYTE Automation — Enterprise App Launcher.
 *
 * Minimal, elegant SaaS layout inspired by Linear and Attio:
 * - Lightweight editorial welcome introduction
 * - Clean, distraction-free Odoo ERP icon grid
 * - Compact roadmap preview for upcoming modules
 */
export default function AppsMenu({
  role,
  permissions = [],
  firstName,
}: AppsMenuProps) {
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Press "/" anywhere to instantly focus launcher search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Filter available apps based on user role and permissions
  const available: LauncherApp[] = useMemo(() => {
    return LAUNCHER_APPS.filter((app) => {
      if (!role) return false;
      const href = app.hrefByRole[role as keyof typeof app.hrefByRole];
      if (!href) return false;

      // Granular permission check for configurable_admin accounts
      if (role === "configurable_admin" && permissions.length > 0) {
        if (app.slug === "employees" && !permissions.includes("admins:read")) return false;
        if (app.slug === "crm" && !permissions.some((p) => p.startsWith("crm:"))) return false;
        if (
          app.slug === "inventory" &&
          !permissions.some((p) => p.startsWith("catalog:") || p.startsWith("pricing:"))
        )
          return false;
        if (
          app.slug === "sales" &&
          !permissions.some((p) => p.startsWith("quotations:") || p.startsWith("deliveries:"))
        )
          return false;
      }

      return true;
    });
  }, [role, permissions]);

  // Upcoming roadmap apps
  const soon: LauncherApp[] = useMemo(() => {
    return LAUNCHER_APPS.filter((app) => {
      if (!role) return true;
      return !app.hrefByRole[role as keyof typeof app.hrefByRole];
    });
  }, [role]);

  // Real-time search filter
  const filteredAvailable = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return available;
    return available.filter((app) => app.label.toLowerCase().includes(q));
  }, [available, search]);

  const filteredSoon = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return soon;
    return soon.filter((app) => app.label.toLowerCase().includes(q));
  }, [soon, search]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="mx-auto w-full max-w-5xl px-4 sm:px-6 md:px-8 py-5 sm:py-6 lg:py-8 space-y-6 sm:space-y-7 select-none"
        data-testid="admin-apps"
      >
        {/* ─── 1. Minimal Editorial Welcome Introduction ─── */}
        <header className="pt-1 sm:pt-2">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900">
            Welcome back{firstName ? `, ${firstName}` : ", Whyte"}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-neutral-500">
            Choose a workspace to continue.
          </p>
        </header>

        {/* ─── 2. Apps Header & Quick Search Toolbar ─── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-4 border-t border-neutral-200/60">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-neutral-900">
              Apps
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-neutral-100 text-neutral-500">
              {filteredAvailable.length}
            </span>
          </div>

          {/* Compact Minimal Search Bar with Shortcut Pill */}
          <div className="relative w-full sm:w-60">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search apps..."
              className="w-full h-8 pl-8.5 pr-8 rounded-lg border border-neutral-200 bg-white text-xs font-medium text-neutral-800 placeholder:text-neutral-400 shadow-2xs focus:outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400/20 transition-all"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 p-0.5"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            ) : (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.2 rounded text-[10px] font-mono text-neutral-400 border border-neutral-200/80 bg-neutral-50 pointer-events-none">
                /
              </span>
            )}
          </div>
        </div>

        {/* ─── 3. Main Application Grid (Odoo ERP App Launcher) ─── */}
        {filteredAvailable.length > 0 ? (
          <motion.ul
            variants={listVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6 sm:gap-7 lg:gap-8 justify-items-center w-full pt-1"
            data-testid="admin-apps-available"
          >
            {filteredAvailable.map((app) => {
              const Icon = app.icon;
              const href = launcherHref(app, role);
              const gradient = APP_GRADIENTS[app.slug] || "bg-neutral-800";

              return (
                <motion.li
                  key={app.slug}
                  variants={itemVariants}
                  className="w-full max-w-[124px] list-none"
                >
                  <motion.div
                    whileHover={{ y: -6, transition: SPRING_TRANSITION }}
                    whileTap={{ scale: 0.94 }}
                    className="flex flex-col items-center w-full"
                  >
                    <Link
                      href={href}
                      className="group flex flex-col items-center text-center p-2.5 sm:p-3 rounded-2xl hover:bg-neutral-200/40 transition-colors duration-150 w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      {/* App Icon Squircle — tilts gently on hover for interactive tactile feel */}
                      <motion.span
                        whileHover={{ rotate: -5, scale: 1.07 }}
                        transition={SPRING_TRANSITION}
                        className={cn(
                          "w-16 h-16 sm:w-18 sm:h-18 rounded-[22px] flex items-center justify-center text-white shadow-md transition-all duration-200 group-hover:shadow-lg group-hover:brightness-105",
                          gradient
                        )}
                      >
                        <Icon size={30} strokeWidth={2.1} />
                      </motion.span>

                      {/* Application Name */}
                      <span className="font-semibold text-xs sm:text-sm text-neutral-800 tracking-tight mt-2.5 group-hover:text-neutral-950 transition-colors">
                        {app.label}
                      </span>

                      {/* Screen reader summary for accessibility & test validation */}
                      <span className="sr-only">{APP_SUMMARY[app.slug]}</span>
                    </Link>
                  </motion.div>
                </motion.li>
              );
            })}
          </motion.ul>
        ) : (
          <div className="text-center py-10 rounded-2xl border border-dashed border-neutral-200 bg-white/60">
            <p className="text-xs text-neutral-500 font-medium">
              No applications match &quot;{search}&quot;
            </p>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="mt-2 text-xs font-semibold text-accent hover:underline"
            >
              Clear search
            </button>
          </div>
        )}

        {/* ─── 4. Upcoming Roadmap Modules (Compact Secondary Section) ─── */}
        {filteredSoon.length > 0 && (
          <div className="pt-6 sm:pt-7 border-t border-neutral-200/70 w-full">
            <div className="text-center mb-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Upcoming Modules
              </span>
            </div>

            <ul
              data-testid="admin-apps-soon"
              className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-3 sm:gap-4 justify-items-center w-full"
            >
              {filteredSoon.map((app) => {
                const Icon = app.icon;
                return (
                  <li
                    key={app.slug}
                    className="flex flex-col items-center text-center max-w-[80px] list-none opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-neutral-100 text-neutral-400 flex items-center justify-center border border-neutral-200/80 shadow-2xs">
                      <Icon size={18} strokeWidth={1.8} />
                    </div>
                    <span className="text-[11px] font-medium text-neutral-600 mt-1.5 truncate max-w-full">
                      {app.label}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">
                      Soon
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
