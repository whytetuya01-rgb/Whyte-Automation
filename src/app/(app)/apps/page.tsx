import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { ChevronRight, Sparkles } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { LAUNCHER_APPS, launcherHref } from "@/lib/appLauncher";

export const metadata = { title: "Apps" };

export default async function AppsPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; name?: string | null } | undefined;
  const role = user?.role;

  // The Apps Launcher is strictly hidden for the Dealer role — redirect to their Quotations landing page.
  if (role === "dealer") {
    redirect("/");
  }

  // Admin-panel roles get the launcher inside the admin panel (its own top bar and sidebar), not the workspace header.
  if (role === "super_admin" || role === "company_owner" || role === "admin" || role === "configurable_admin") {
    redirect("/admin/apps");
  }

  const firstName = user?.name?.trim().split(/\s+/)[0];

  return (
    <section aria-label="Apps" className="mx-auto max-w-6xl space-y-8">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-gray-950 via-gray-900 to-gray-800 p-8 sm:p-10 shadow-xl border border-white/10">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-white/10 text-white border border-white/15 backdrop-blur-md mb-4 shadow-2xs">
            <Sparkles size={11} className="text-accent" />
            <span>Whyte Automations</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-300 font-normal">
            Select an authorized workspace to get started. Upcoming modules are marked as roadmap releases.
          </p>
        </div>
      </div>

      {/* App grid */}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {LAUNCHER_APPS.map((app) => {
          const Icon = app.icon;
          const live = Boolean(role && app.hrefByRole[role as keyof typeof app.hrefByRole]);
          return (
            <li key={app.slug}>
              <Link
                href={launcherHref(app, role)}
                className="group relative block h-full rounded-2xl border border-neutral-200/90 bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.03),0_1px_2px_0_rgba(0,0,0,0.02)] outline-none overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-neutral-300 hover:shadow-[0_16px_36px_-10px_rgba(0,0,0,0.08),0_4px_16px_-4px_rgba(216,91,131,0.08)] focus-visible:ring-2 focus-visible:ring-accent"
              >
                {/* Top glow beam */}
                <span
                  className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-[var(--color-admin-primary,#D85B83)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  aria-hidden="true"
                />

                {/* Soft ambient blush */}
                <span
                  className="absolute inset-0 bg-gradient-to-b from-[var(--color-admin-primary-subtle,#FFF6F8)]/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  aria-hidden="true"
                />

                <div className="relative z-10 flex flex-col items-center gap-3 p-6 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-admin-primary-soft,#FCEAF0)] to-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary-foreground,#8A2B4D)] border border-[var(--color-admin-primary-border,#F1B8C8)]/70 shadow-2xs transition-all duration-300 group-hover:bg-gradient-to-br group-hover:from-[var(--color-admin-primary,#D85B83)] group-hover:to-[var(--color-admin-primary-dark,#B83E68)] group-hover:text-white group-hover:border-transparent group-hover:shadow-[0_4px_16px_rgba(216,91,131,0.35)]">
                    <Icon size={24} strokeWidth={1.9} />
                  </span>
                  <span className="text-sm font-semibold tracking-tight text-neutral-900 group-hover:text-black transition-colors">{app.label}</span>
                  {live ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/80 shadow-2xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Open
                      <ChevronRight size={11} className="transition group-hover:translate-x-0.5" />
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full">Soon</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
