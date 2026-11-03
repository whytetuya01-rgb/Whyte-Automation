import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ArrowLeft, Clock } from "lucide-react";
import { findLauncherApp } from "@/lib/appLauncher";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const app = findLauncherApp(slug);
  return { title: app ? `${app.label} · Apps` : "App Not Found" };
}

export default async function AppComingSoonPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  // The Apps Launcher is strictly hidden for the Dealer role — redirect to their Quotations landing page.
  if (role === "dealer") {
    redirect("/");
  }

  if (role === "super_admin" || role === "company_owner" || role === "admin" || role === "configurable_admin") {
    redirect("/admin/apps");
  }

  const { slug } = await params;
  const app = findLauncherApp(slug);

  if (!app) {
    notFound();
  }

  const Icon = app.icon;

  return (
    <div className="mx-auto max-w-xl py-12 px-4 text-center">
      <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-8 sm:p-12">
        <div className="mx-auto w-20 h-20 rounded-3xl bg-accent-light flex items-center justify-center text-accent mb-6 shadow-inner">
          <Icon size={38} strokeWidth={1.8} />
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200/60 mb-3">
          <Clock size={13} />
          <span>Coming Soon</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
          {app.label}
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          The <span className="font-semibold text-gray-800">{app.label}</span> module is currently under development for Whyte Automations. Stay tuned for upcoming feature releases!
        </p>

        <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-center">
          <Link
            href="/apps"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gray-950 hover:bg-gray-800 text-white text-xs font-semibold shadow-xs transition"
          >
            <ArrowLeft size={14} />
            <span>Back to All Apps</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
