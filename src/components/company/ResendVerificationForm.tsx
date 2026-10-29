"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { isValidEmail } from "@/lib/validation/fields";

/**
 * "Did not get the link?" — asks for a new owner verification email. The answer is the same whether or not the
 * address is registered, so it reveals nothing.
 */
export default function ResendVerificationForm({ heading = true }: { heading?: boolean }) {
  // With the heading (the confirmation page) the form stays folded behind a button, keeping the page compact.
  const [open, setOpen] = useState(!heading);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!isValidEmail(email.trim())) {
      setError("Enter the owner email you registered with.");
      return;
    }
    setState("sending");
    try {
      const response = await fetch("/api/company/register/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error?.message ?? "Could not send a new link. Please try again later.");
        setState("idle");
        return;
      }
      setMessage(result?.data?.message ?? "If a registration is waiting for this email to be verified, a new link is on its way.");
      setState("done");
    } catch {
      setError("Unable to reach the server. Please try again.");
      setState("idle");
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3" data-testid="verify-email-notice">
      {heading && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700">
          <MailCheck size={16} className="shrink-0 text-admin-primary" aria-hidden="true" />
          <span>
            <strong className="font-semibold text-neutral-900">Verify your email:</strong> open the link we sent to the owner email.
          </span>
          {!open && state !== "done" && (
            <button type="button" onClick={() => setOpen(true)} className="font-semibold text-neutral-900 underline underline-offset-2 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary">
              Resend the link
            </button>
          )}
        </p>
      )}
      {state === "done" ? (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-700">{message}</p>
      ) : open ? (
        <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-2 sm:flex-row" noValidate>
          <label className="sr-only" htmlFor="resend-verification-email">Owner email</label>
          <input
            id="resend-verification-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@company.com"
            autoComplete="email"
            className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="h-10 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary disabled:opacity-60"
          >
            {state === "sending" ? "Sending…" : "Resend link"}
          </button>
        </form>
      ) : null}
      {error && <p role="alert" className="mt-2 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
