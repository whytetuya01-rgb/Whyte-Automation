"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Clock } from "lucide-react";
import WhyteLogo from "@/components/shared/WhyteLogo";

type StepState = "done" | "current" | "upcoming";

const STEPS: ReadonlyArray<{ number: string; title: string; caption: string; state: StepState }> = [
  { number: "01", title: "Registration Submitted", caption: "We have your company details.", state: "done" },
  { number: "02", title: "Application Review", caption: "Our team is reviewing your request.", state: "current" },
  { number: "03", title: "Approval Decision", caption: "You will be notified of the outcome.", state: "upcoming" },
];

/**
 * Confirmation that a company registration was received. It shows nothing about the submission (no ids, emails or
 * passwords) and never implies approval: the review is a separate step done by the Whyte team.
 */
export default function SubmittedView() {
  const reduce = useReducedMotion();
  // Restrained entrance: a short fade and 12px rise, staggered. Skipped entirely for reduced-motion users.
  const rise = (delay: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <div className="admin-theme min-h-screen w-full bg-white lg:grid lg:grid-cols-[48fr_52fr]">
      {/* Brand panel: desktop only. On smaller screens a compact bar takes its place so the confirmation comes first. */}
      <aside className="relative hidden min-h-screen overflow-hidden bg-[#070707] text-white lg:flex lg:flex-col" aria-label="Whyte Automation">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 45% at 78% 82%, rgba(212,106,140,0.22), transparent 70%), radial-gradient(50% 40% at 12% 8%, rgba(255,255,255,0.05), transparent 70%)",
          }}
        />
        <div className="relative z-10 flex flex-1 flex-col px-14 pb-0 pt-14 xl:px-20">
          <motion.div {...rise(0)}>
            <WhyteLogo theme="dark" alt="Whyte" size="login" preload />
          </motion.div>

          <motion.div className="mt-16 max-w-md xl:mt-24" {...rise(0.1)}>
            <span className="block h-px w-12 bg-admin-primary" aria-hidden="true" />
            <h2 className="mt-6 text-4xl font-semibold leading-[1.12] tracking-tight xl:text-[2.75rem]">Welcome to the Whyte Automation network.</h2>
            <p className="mt-5 text-base leading-relaxed text-neutral-400">
              Connected living is built on trusted partnerships. Every company that joins is reviewed by our team, so every workspace stays private and dependable.
            </p>
          </motion.div>

          {/* The cut-out artwork sits on the same black as the panel, so it blends in instead of reading as a card. */}
          <motion.div className="relative mt-auto h-[46vh] min-h-[300px] w-full" {...(reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] as const } })}>
            <Image
              src="/proposal/whyte/cover-hero.webp"
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 48vw, 0px"
              className="object-contain object-bottom"
            />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#070707] to-transparent" />
          </motion.div>
        </div>
        <p className="relative z-10 border-t border-white/10 px-14 py-5 text-xs tracking-wide text-neutral-500 xl:px-20">Whyte Automation &middot; Smart Living Ecosystems</p>
      </aside>

      {/* Compact brand bar for tablet and phone */}
      <header className="bg-[#070707] px-6 py-5 sm:px-10 lg:hidden">
        <WhyteLogo theme="dark" alt="Whyte" size="login" preload />
      </header>

      <main className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-12 sm:px-10 lg:min-h-screen lg:px-16">
        <div className="w-full max-w-[28rem]">
          <motion.div {...rise(0.05)} className="flex items-center gap-4">
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-neutral-300 text-neutral-900" aria-hidden="true">
              <Clock size={24} strokeWidth={1.5} />
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-admin-primary" />
            </span>
            <p
              role="status"
              data-testid="pending-approval-badge"
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-700"
            >
              <span className="h-px w-6 bg-admin-primary" aria-hidden="true" />
              Pending Approval
            </p>
          </motion.div>

          <motion.h1 {...rise(0.12)} className="mt-7 text-[2.1rem] font-semibold leading-[1.1] tracking-tight text-neutral-950 sm:text-[2.6rem]">
            Your Request Is Under Review
          </motion.h1>
          <motion.p {...rise(0.18)} className="mt-5 max-w-[26rem] text-base leading-7 text-neutral-600">
            Thank you for registering with Whyte Automation. Your company registration request has been submitted successfully and is awaiting approval from our team. You will receive an email once your request is reviewed.
          </motion.p>

          <motion.ol {...rise(0.26)} className="mt-9 space-y-0" aria-label="Registration progress">
            {STEPS.map((step, index) => (
              <li key={step.number} className="relative flex gap-4 pb-6 last:pb-0" aria-current={step.state === "current" ? "step" : undefined}>
                {index < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px ${step.state === "done" ? "bg-admin-primary/60" : "bg-neutral-200"}`}
                  />
                )}
                <span
                  aria-hidden="true"
                  className={
                    "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold " +
                    (step.state === "done"
                      ? "bg-admin-primary text-white"
                      : step.state === "current"
                        ? "border-2 border-neutral-950 bg-white text-neutral-950"
                        : "border border-neutral-300 bg-white text-neutral-500")
                  }
                >
                  {step.state === "done" ? <Check size={15} strokeWidth={2.5} /> : step.number}
                </span>
                <div className="pt-0.5">
                  <p className={`text-sm font-semibold ${step.state === "upcoming" ? "text-neutral-500" : "text-neutral-950"}`}>
                    <span className="mr-2 font-mono text-xs text-neutral-400">{step.number}</span>
                    {step.title}
                    <span className="sr-only">{step.state === "done" ? " (completed)" : step.state === "current" ? " (in progress)" : " (upcoming)"}</span>
                  </p>
                  <p className={`mt-0.5 text-sm ${"text-neutral-500"}`}>{step.caption}</p>
                </div>
              </li>
            ))}
          </motion.ol>

          <motion.div {...rise(0.34)} className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            <Link
              href="/admin/login"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-neutral-950 px-7 text-sm font-semibold text-white transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary focus-visible:ring-offset-2"
            >
              Back to Login
            </Link>
            <a
              href="https://whyte.co.in/"
              className="inline-flex h-12 items-center justify-center gap-1.5 px-1 text-sm font-semibold text-neutral-700 underline-offset-4 transition hover:text-neutral-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary focus-visible:ring-offset-2"
            >
              Visit Our Website <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
