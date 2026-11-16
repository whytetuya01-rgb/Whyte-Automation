"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, LayoutGrid } from "lucide-react";
import WhyteLogo from "@/components/shared/WhyteLogo";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log sanitized error event locally
    console.error("[RootError] Unhandled application exception:", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-12 flex items-center justify-center">
      <div className="w-full max-w-md mx-auto text-center">
        {/* Brand Header */}
        <div className="flex justify-center mb-8">
          <WhyteLogo width={160} height={40} preload />
        </div>

        {/* Error Card */}
        <div className="bg-white rounded-3xl border border-neutral-200 p-8 shadow-xl shadow-neutral-900/5">
          <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle size={28} aria-hidden="true" />
          </div>

          <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-amber-50 text-amber-700 mb-3">
            Application Notice
          </span>

          <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
            Something went wrong
          </h1>

          <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
            An unexpected issue occurred while processing your request. Your data and previous changes are safe.
          </p>

          {error.digest && (
            <p className="mt-3 text-xs text-neutral-400 font-mono bg-neutral-50 py-1 px-2.5 rounded-lg inline-block border border-neutral-150">
              Reference ID: {error.digest}
            </p>
          )}

          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 transition-colors shadow-sm cursor-pointer"
            >
              <RefreshCw size={16} aria-hidden="true" />
              Try Again
            </button>

            <Link
              href="/admin/apps"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors"
            >
              <LayoutGrid size={16} aria-hidden="true" />
              Go to Workspace
            </Link>
          </div>
        </div>

        <p className="mt-8 text-xs text-neutral-400">
          Whyte Automation Platform • If this problem persists, please contact support.
        </p>
      </div>
    </main>
  );
}

