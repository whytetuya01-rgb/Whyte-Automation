"use client";

import Link from "next/link";
import { MotionConfig, motion, type Variants } from "motion/react";
import { ArrowUpRight, Clock, Sparkles } from "lucide-react";
import { LAUNCHER_APPS, launcherHref, type LauncherApp } from "@/lib/appLauncher";

/** One line on what each live app opens, so the menu reads as a map of the admin panel. */
const APP_SUMMARY: Record<string, string> = {
  contacts: "Customers, architects, builders and contractors",
  crm: "Leads, pipeline and follow-ups",
  sales: "Quotations, approvals and delivery",
  dashboards: "Revenue, conversion and team performance",
  inventory: "Products, series, pricing and GST",
  employees: "Users, roles and permissions",
};

/** High-end Apple/Linear cubic-bezier ease: snappy start with a cushioned, silky landing. */
const LUXURY_EASE = [0.16, 1, 0.3, 1] as const;

const list: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.06 },
  },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: LUXURY_EASE },
  },
};

/**
 * Ultra-Premium Executive Application Launcher.
 * Features tactile magnetic micro-elevation, specular ambient glows,
 * velvet gradient squircles, and calm, non-distracting motion physics.
 */
export default function AppsMenu({ role, firstName }: { role?: string; firstName?: string }) {
  const available: LauncherApp[] = [];
  const soon: LauncherApp[] = [];
  for (const app of LAUNCHER_APPS) {
    (role && app.hrefByRole[role as keyof typeof app.hrefByRole] ? available : soon).push(app);
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        aria-label="Apps"
        className="mx-auto w-full max-w-6xl space-y-8 pb-8"
        data-testid="admin-apps"
        initial="hidden"
        animate="show"
        variants={list}
      >
        {/* Luxury Hero Header */}
        <motion.header variants={rise} className="space-y-3 pb-2 border-b border-[#E5E5E7]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>Whyte Enterprise Architecture</span>
            </span>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary-foreground,#8A2B4D)] border border-[var(--color-admin-primary-border,#F1B8C8)] shadow-2xs">
              <Sparkles size={11} className="text-[var(--color-admin-primary,#D85B83)]" />
              <span>Unified Portal</span>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111111]">
                Apps & Workspaces
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-[#8A8A93] font-normal leading-relaxed">
                {firstName ? `${firstName}, launch` : "Launch"} a core operational workspace or review upcoming modular releases.
              </p>
            </div>

            {/* Quick Status Counters */}
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-white text-[#111111] border border-[#E5E5E7] shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {available.length} Available
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium bg-[#F6F6F7] text-[#8A8A93] border border-[#E5E5E7]">
                {soon.length} Coming Soon
              </span>
            </div>
          </div>
        </motion.header>

        {/* Live / Available Applications */}
        <motion.div className="space-y-3.5" variants={rise}>
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#8A8A93]">
              Available Workspaces
            </h2>
            <div className="h-px flex-1 bg-[#F0F0F2]" />
          </div>

          <motion.ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="admin-apps-available"
            variants={list}
          >
            {available.map((app) => {
              const Icon = app.icon;
              return (
                <motion.li
                  key={app.slug}
                  variants={rise}
                  whileHover="hover"
                  whileTap={{ scale: 0.985 }}
                  className="h-full"
                >
                  <motion.div
                    variants={{ hover: { y: -3 } }}
                    transition={{ duration: 0.22, ease: LUXURY_EASE }}
                    className="h-full"
                  >
                    <Link
                      href={launcherHref(app, role)}
                      className="group relative flex h-full items-center gap-4 rounded-2xl border border-neutral-200/90 bg-white p-4.5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.03),0_1px_2px_0_rgba(0,0,0,0.02)] overflow-hidden transition-all duration-300 hover:border-neutral-300 hover:shadow-[0_16px_36px_-10px_rgba(0,0,0,0.08),0_4px_16px_-4px_rgba(216,91,131,0.08)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {/* Top illuminated glow beam on hover */}
                      <span
                        className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-[var(--color-admin-primary,#D85B83)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                        aria-hidden="true"
                      />

                      {/* Ambient card background blush on hover */}
                      <span
                        className="absolute inset-0 bg-gradient-to-b from-[var(--color-admin-primary-subtle,#FFF6F8)]/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                        aria-hidden="true"
                      />

                      {/* Icon Squircle with subtle luxury micro-tilt */}
                      <motion.span
                        variants={{ hover: { rotate: -1.5, scale: 1.05 } }}
                        transition={{ duration: 0.25, ease: LUXURY_EASE }}
                        className="relative z-10 flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-admin-primary-soft,#FCEAF0)] to-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary-foreground,#8A2B4D)] border border-[var(--color-admin-primary-border,#F1B8C8)]/70 shadow-2xs transition-all duration-300 group-hover:bg-gradient-to-br group-hover:from-[var(--color-admin-primary,#D85B83)] group-hover:to-[var(--color-admin-primary-dark,#B83E68)] group-hover:text-white group-hover:border-transparent group-hover:shadow-[0_4px_16px_rgba(216,91,131,0.35)]"
                      >
                        <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
                      </motion.span>

                      {/* App Text Metadata */}
                      <span className="min-w-0 flex-1 relative z-10">
                        <span className="flex items-center gap-1.5">
                          <span className="block text-sm font-semibold tracking-tight text-[#111111] group-hover:text-black transition-colors">
                            {app.label}
                          </span>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 group-hover:bg-emerald-500 group-hover:animate-pulse transition-all shrink-0" />
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-[#8A8A93] group-hover:text-[#5F5F68] transition-colors">
                          {APP_SUMMARY[app.slug] ?? "Open this app"}
                        </span>
                      </span>

                      {/* Directional Action Button */}
                      <motion.span
                        variants={{ hover: { x: 2, y: -2 } }}
                        transition={{ duration: 0.2, ease: LUXURY_EASE }}
                        className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#F6F6F7] text-[#8A8A93] border border-[#E5E5E7] transition-all duration-300 group-hover:bg-[var(--color-admin-primary-soft,#FCEAF0)] group-hover:text-[var(--color-admin-primary,#D85B83)] group-hover:border-[var(--color-admin-primary-border,#F1B8C8)] group-hover:shadow-2xs"
                      >
                        <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden="true" />
                      </motion.span>
                    </Link>
                  </motion.div>
                </motion.li>
              );
            })}
          </motion.ul>
        </motion.div>

        {/* Coming Soon Applications (Calm, Static, Blueprint Glass) */}
        {soon.length > 0 && (
          <motion.div className="space-y-3.5 pt-2" variants={rise}>
            <div className="flex items-center gap-2">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#8A8A93]">
                Upcoming Modules
              </h2>
              <div className="h-px flex-1 bg-[#F0F0F2]" />
            </div>

            <motion.ul
              className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5"
              data-testid="admin-apps-soon"
              variants={list}
            >
              {soon.map((app) => {
                const Icon = app.icon;
                return (
                  <motion.li
                    key={app.slug}
                    variants={rise}
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.2, ease: LUXURY_EASE }}
                    className="group flex items-center gap-3 rounded-2xl border border-dashed border-[#E5E5E7] bg-white/70 p-3.5 backdrop-blur-2xs transition-all duration-200 hover:bg-white hover:border-neutral-300 hover:shadow-2xs"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F6F6F7] text-[#8A8A93] border border-[#E5E5E7] transition-all duration-200 group-hover:text-[#5F5F68] group-hover:border-neutral-300 group-hover:scale-105 shadow-2xs">
                      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-[#111111] tracking-tight">
                        {app.label}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#8A8A93]">
                        <Clock size={10} aria-hidden="true" />
                        Soon
                      </span>
                    </span>
                  </motion.li>
                );
              })}
            </motion.ul>
          </motion.div>
        )}
      </motion.section>
    </MotionConfig>
  );
}
