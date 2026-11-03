"use client";

import Link from "next/link";
import { MotionConfig, motion, type Variants } from "motion/react";
import { ArrowUpRight, Clock } from "lucide-react";
import { LAUNCHER_APPS, launcherHref, type LauncherApp } from "@/lib/appLauncher";
import { DURATION, EASE } from "@/components/admin/sidebar/motionTokens";

/** One line on what each live app opens, so the menu reads as a map of the admin panel. */
const APP_SUMMARY: Record<string, string> = {
  contacts: "Customers, architects, builders and contractors",
  crm: "Leads, pipeline and follow-ups",
  sales: "Quotations, approvals and delivery",
  dashboards: "Revenue, conversion and team performance",
  inventory: "Products, series, pricing and GST",
  employees: "Users, roles and permissions",
};

const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.layout, ease: EASE } },
};

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.12 } },
};

/**
 * The admin Apps menu, animated: the heading and sections rise in, tiles stagger in one after another, a live tile lifts
 * and its icon tilts on hover (the arrow slides out), a press squeezes it, and the coming-soon tiles breathe softly.
 * Motion is skipped when the person's system asks for reduced motion.
 */
export default function AppsMenu({ role, firstName }: { role?: string; firstName?: string }) {
  const available: LauncherApp[] = [];
  const soon: LauncherApp[] = [];
  for (const app of LAUNCHER_APPS) (role && app.hrefByRole[role as keyof typeof app.hrefByRole] ? available : soon).push(app);

  return (
    <MotionConfig reducedMotion="user">
      <motion.section aria-label="Apps" className="mx-auto w-full max-w-6xl space-y-8" data-testid="admin-apps" initial="hidden" animate="show" variants={list}>
        <motion.header variants={rise}>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-950 sm:text-2xl">Apps</h1>
          <p className="mt-1 text-xs text-neutral-500 sm:text-sm">
            {firstName ? `${firstName}, pick` : "Pick"} an app to open its workspace. {available.length} available · {soon.length} coming soon.
          </p>
          <motion.div className="mt-3 h-0.5 w-16 origin-left rounded-full bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.25, duration: 0.5, ease: EASE }} aria-hidden="true" />
        </motion.header>

        <motion.div className="space-y-3" variants={rise}>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Available</h2>
          <motion.ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-apps-available" variants={list}>
            {available.map((app) => {
              const Icon = app.icon;
              return (
                <motion.li key={app.slug} variants={rise} whileHover="hover" whileTap={{ scale: 0.98 }} className="h-full">
                  <motion.div variants={{ hover: { y: -4 } }} transition={{ duration: DURATION.fast, ease: EASE }} className="h-full">
                    <Link
                      href={launcherHref(app, role)}
                      className="group flex h-full items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-xs outline-none transition-[border-color,box-shadow] duration-200 hover:border-accent hover:shadow-lg focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <motion.span
                        variants={{ hover: { rotate: -8, scale: 1.1 } }}
                        transition={{ type: "spring", stiffness: 380, damping: 16 }}
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-light text-accent transition-colors duration-200 group-hover:bg-accent group-hover:text-white"
                      >
                        <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
                      </motion.span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-neutral-950">{app.label}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-neutral-500">{APP_SUMMARY[app.slug] ?? "Open this app"}</span>
                      </span>
                      <motion.span variants={{ hover: { x: 3, y: -3 } }} transition={{ duration: DURATION.fast, ease: EASE }} className="shrink-0 text-neutral-300 transition-colors group-hover:text-accent">
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </motion.span>
                    </Link>
                  </motion.div>
                </motion.li>
              );
            })}
          </motion.ul>
        </motion.div>

        {soon.length > 0 && (
          <motion.div className="space-y-3" variants={rise}>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Coming soon</h2>
            <motion.ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="admin-apps-soon" variants={list}>
              {soon.map((app, index) => {
                const Icon = app.icon;
                return (
                  <motion.li key={app.slug} variants={rise} className="flex items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/60 p-3.5">
                    <motion.span
                      animate={{ scale: [1, 1.08, 1], opacity: [0.75, 1, 0.75] }}
                      transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: (index % 5) * 0.35 }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-400 ring-1 ring-neutral-200"
                    >
                      <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                    </motion.span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-neutral-700">{app.label}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
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
