import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
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

  const firstName = user?.name?.trim().split(/\s+/)[0];

  return (
    <section aria-label="Apps" className="mx-auto max-w-6xl">
      {/* Hero */}
      <div className="mb-8 flex items-stretch overflow-hidden rounded-3xl bg-gradient-to-r from-gray-950 to-gray-800 shadow-lg">
        <div className="w-1.5 shrink-0 bg-accent" />
        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Whyte Automations</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-300">
            Pick an app to get started. Apps marked Soon are on the way.
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
                className="group block h-full rounded-2xl border border-gray-200 bg-white shadow-2xs outline-none transition duration-200 hover:-translate-y-1 hover:border-accent hover:shadow-lg focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex flex-col items-center gap-3 p-6 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-light text-accent transition duration-200 group-hover:bg-accent group-hover:text-white">
                    <Icon size={26} strokeWidth={1.9} />
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{app.label}</span>
                  {live ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Open
                      <ChevronRight size={11} className="transition group-hover:translate-x-0.5" />
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Soon</span>
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
