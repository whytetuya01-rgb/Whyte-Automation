import Link from "next/link";
import { ArrowLeft, Home, Compass } from "lucide-react";
import WhyteLogo from "@/components/shared/WhyteLogo";

export const metadata = {
  title: "404 - Page Not Found | WHYTE Automation",
  description: "The requested page could not be found.",
};

export default function NotFound() {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-12 flex items-center justify-center">
      <div className="w-full max-w-md mx-auto text-center">
        {/* Brand Header */}
        <div className="flex justify-center mb-8">
          <WhyteLogo width={160} height={40} preload />
        </div>

        {/* 404 Card */}
        <div className="bg-white rounded-3xl border border-neutral-200 p-8 shadow-xl shadow-neutral-900/5">
          <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-800">
            <Compass size={28} aria-hidden="true" />
          </div>

          <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-neutral-100 text-neutral-600 mb-3">
            Error 404
          </span>

          <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
            Page not found
          </h1>

          <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
            The link you followed may be broken, expired, or you may not have permission to view this resource.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/admin/apps"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 transition-colors shadow-sm"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Go to Workspace
            </Link>

            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors"
            >
              <Home size={16} aria-hidden="true" />
              Home
            </Link>
          </div>
        </div>

        <p className="mt-8 text-xs text-neutral-400">
          Whyte Automation Platform • All rights reserved
        </p>
      </div>
    </main>
  );
}

