"use client";

import Link from "next/link";
import { ArrowLeft, Building2, LogIn, ShieldAlert } from "lucide-react";
import WhyteLogo from "@/components/shared/WhyteLogo";

export default function AdminRegisterPage() {
  return (
    <div className="admin-theme min-h-screen w-full bg-white lg:grid lg:grid-cols-2">
      <section className="relative min-h-[250px] overflow-hidden bg-black p-6 text-white sm:p-10 lg:min-h-screen lg:p-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(212,106,140,0.10),transparent_42%),linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px]" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="inline-flex w-fit items-center">
            <WhyteLogo theme="dark" alt="Whyte logo" size="login" preload />
          </div>
          <div className="my-8 max-w-lg lg:my-auto">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300">
              <ShieldAlert size={14} /> Account Policy Update
            </div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
              Administrator-Provisioned Dealer Access
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
              Public self-registration for dealers is discontinued. Dealer accounts are now provisioned directly by company administrators.
            </p>
          </div>
          <p className="hidden border-t border-white/10 pt-6 text-xs text-neutral-400 lg:block">
            Whyte Automations Partner &amp; Quotation Governance.
          </p>
        </div>
      </section>

      <main className="flex w-full items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md space-y-6">
          <div className="rounded-2xl border border-neutral-200/90 bg-neutral-50/70 p-6 sm:p-8">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
              <ShieldAlert size={24} />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">
              Dealer Self-Registration Discontinued
            </h2>
            <p className="mt-2.5 text-xs sm:text-sm text-neutral-600 leading-relaxed">
              Dealers can no longer self-register on the portal. If you are an authorized partner, please reach out to your company administrator to issue your login credentials.
            </p>
            <p className="mt-2 text-xs sm:text-sm text-neutral-600 leading-relaxed">
              Administrators can create and configure new dealer accounts directly from the <span className="font-semibold text-neutral-900">Dealer Management</span> screen.
            </p>

            <div className="mt-6 pt-5 border-t border-neutral-200/80 space-y-2.5">
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-neutral-800 transition"
              >
                <LogIn size={15} />
                <span>Go to Sign In</span>
              </Link>
              <Link
                href="/register/company"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-xs sm:text-sm font-semibold text-neutral-800 hover:bg-neutral-50 transition"
              >
                <Building2 size={15} />
                <span>Register a New Company</span>
              </Link>
            </div>
          </div>

          <div className="text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 transition"
            >
              <ArrowLeft size={13} />
              <span>Back to login</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
