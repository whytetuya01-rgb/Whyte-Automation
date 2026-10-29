"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Circle, X, Sparkles } from "lucide-react";
import notify from "@/lib/notify";
import type { OnboardingState } from "@/lib/companyOnboarding";
import { cn } from "@/lib/utils";

/**
 * "Set up your workspace": the onboarding guide for a new company, shown on the dashboard until every step is done
 * or the guide is hidden. Steps tick themselves off from the company's real data.
 */
export default function SetupGuide({ state }: { state: OnboardingState }) {
  const router = useRouter();
  const [hiding, setHiding] = useState(false);
  const next = state.steps.find((step) => !step.done);
  const percent = Math.round((state.completed / state.total) * 100);

  const hide = async () => {
    setHiding(true);
    try {
      const response = await fetch("/api/company/onboarding", { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        notify.error("Could not hide the guide", result?.error?.message ?? "Please try again.");
        return;
      }
      router.refresh();
    } catch {
      notify.error("Could not hide the guide", "Unable to reach the server.");
    } finally {
      setHiding(false);
    }
  };

  return (
    <section
      aria-label="Set up your workspace"
      data-testid="setup-guide"
      className="rounded-2xl border border-[#E5E5E7] bg-white p-5 sm:p-6 shadow-[0_1px_3px_0_rgba(0,0,0,0.02)] relative overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-[var(--color-admin-primary-subtle,#FFF6F8)] text-[var(--color-admin-primary,#D85B83)] flex items-center justify-center">
              <Sparkles size={13} />
            </span>
            <h2 className="text-sm sm:text-base font-semibold tracking-tight text-[#111111]">
              Set up your workspace
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#F6F6F7] text-[#5F5F68] border border-[#E5E5E7]">
              {state.completed} / {state.total} Complete
            </span>
          </div>
          <p className="text-xs text-[#8A8A93]">
            Configure your brand identity, product catalog, and quotation layout. Steps automatically verify from live workspace data.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void hide()}
          disabled={hiding}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-[#8A8A93] hover:bg-[#F6F6F7] hover:text-[#111111] transition disabled:opacity-60 cursor-pointer"
        >
          <X size={13} /> Hide guide
        </button>
      </div>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[#F0F0F2]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Setup progress"
      >
        <div
          className="h-full rounded-full bg-[var(--color-admin-primary,#D85B83)] transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.steps.map((step, index) => (
          <li key={step.id} data-testid="setup-step" data-done={step.done}>
            <Link
              href={step.href}
              className={cn(
                "flex h-full items-start gap-3 rounded-xl border p-3.5 transition group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-admin-primary,#D85B83)]",
                step.done
                  ? "border-[#E5E5E7]/60 bg-[#F6F6F7]/50 text-[#8A8A93]"
                  : "border-[#E5E5E7] bg-white hover:border-[#111111]/30 hover:bg-[#F6F6F7]/60 shadow-2xs"
              )}
            >
              {step.done ? (
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" aria-label="Done" />
              ) : (
                <Circle size={17} className="mt-0.5 shrink-0 text-[#C9C9D0] group-hover:text-[#111111]" aria-label="To do" />
              )}
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-xs font-semibold tracking-tight",
                    step.done ? "text-[#8A8A93] line-through decoration-[#C9C9D0]" : "text-[#111111] group-hover:text-[var(--color-admin-primary-foreground,#B83E68)]"
                  )}
                >
                  {index + 1}. {step.title}
                </span>
                <span className="block text-[11px] text-[#8A8A93] mt-0.5 leading-relaxed">
                  {step.description}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {next && (
        <div className="mt-4 pt-3 border-t border-[#F0F0F2] flex items-center justify-between">
          <p className="text-xs text-[#8A8A93] hidden sm:block">
            Recommended next action: <span className="font-medium text-[#111111]">{next.title}</span>
          </p>
          <Link
            href={next.href}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#111111] px-4 py-2 text-xs font-medium text-white hover:bg-[#1E1E22] transition shadow-2xs ml-auto"
            data-testid="setup-next-step"
          >
            <span>Continue Setup: {next.title}</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </section>
  );
}
