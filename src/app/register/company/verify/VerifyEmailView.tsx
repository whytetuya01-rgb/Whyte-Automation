"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import WhyteLogo from "@/components/shared/WhyteLogo";
import ResendVerificationForm from "@/components/company/ResendVerificationForm";

type State =
  | { kind: "checking" }
  | { kind: "verified"; companyName: string; already: boolean }
  | { kind: "expired"; message: string }
  | { kind: "invalid"; message: string };

export default function VerifyEmailView() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<State>({ kind: "checking" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState({ kind: "invalid", message: "This verification link is incomplete. Open the link from the email again." });
      return;
    }
    void (async () => {
      try {
        const response = await fetch("/api/company/register/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        const result = await response.json().catch(() => null);
        if (response.ok) {
          setState({ kind: "verified", companyName: result?.data?.companyName ?? "your company", already: Boolean(result?.data?.alreadyVerified) });
        } else if (result?.error?.details?.reason === "expired") {
          setState({ kind: "expired", message: result.error.message });
        } else {
          setState({ kind: "invalid", message: result?.error?.message ?? "This verification link is not valid." });
        }
      } catch {
        setState({ kind: "invalid", message: "Unable to reach the server. Please try again." });
      }
    })();
  }, [token]);

  return (
    <div className="admin-theme min-h-screen bg-white">
      <header className="bg-[#070707] px-6 py-5 sm:px-10">
        <WhyteLogo theme="dark" alt="Whyte" size="login" preload />
      </header>
      <main className="mx-auto flex max-w-md flex-col gap-5 px-6 py-14" data-testid="verify-email-page">
        {state.kind === "checking" && (
          <p role="status" className="flex items-center gap-2 text-sm text-neutral-600">
            <Loader2 size={16} className="animate-spin" /> Verifying your email address…
          </p>
        )}
        {state.kind === "verified" && (
          <>
            <CheckCircle2 size={40} className="text-emerald-600" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">{state.already ? "Email already verified" : "Email verified"}</h1>
            <p className="text-base leading-7 text-neutral-600" role="status">
              Thank you. The registration of <strong>{state.companyName}</strong> is now with our team for review. You will receive an email once it is reviewed.
            </p>
            <Link href="/login" className="inline-flex h-11 w-fit items-center rounded-xl bg-neutral-950 px-6 text-sm font-semibold text-white hover:bg-neutral-800">
              Back to Login
            </Link>
          </>
        )}
        {(state.kind === "expired" || state.kind === "invalid") && (
          <>
            <AlertTriangle size={40} className="text-amber-600" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">{state.kind === "expired" ? "This link has expired" : "This link does not work"}</h1>
            <p role="alert" className="text-base leading-7 text-neutral-600">{state.message}</p>
            <ResendVerificationForm heading={false} />
          </>
        )}
      </main>
    </div>
  );
}
