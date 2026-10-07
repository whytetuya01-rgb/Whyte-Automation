"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

/** Shown when the dashboard data cannot be loaded; offers a retry instead of a blank page. */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-md mx-auto mt-16 bg-white rounded-2xl border border-[#E5E5E7] p-6 text-center">
      <span className="w-10 h-10 rounded-xl bg-red-50 text-red-600 inline-flex items-center justify-center mb-3">
        <AlertCircle size={20} aria-hidden="true" />
      </span>
      <h1 className="text-base font-semibold text-[#111111]">Dashboard could not be loaded</h1>
      <p className="text-sm text-[#8A8A93] mt-1">Something went wrong while fetching the latest figures. Your data is unaffected.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-[#111111] text-white text-sm font-medium hover:bg-[#1E1E22] transition-colors cursor-pointer"
      >
        <RefreshCw size={14} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
