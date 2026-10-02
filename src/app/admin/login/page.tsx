"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye,
  EyeOff,
  Lock,
  User,
  ArrowLeft,
  ShieldCheck,
  Package,
  FileText,
  Sliders,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import notify from "@/lib/notify";
import { Input, Button } from "@/components/ui";
import WhyteLogo from "@/components/shared/WhyteLogo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `callbackUrl` is set by `src/proxy.ts` when it bounces a protected page, but
  // it is user-controlled input. Only same-origin relative paths are honoured so
  // the post-login redirect cannot be used to bounce someone off-site.
  const requestedCallback = searchParams.get("callbackUrl");
  const callbackUrl =
    requestedCallback && requestedCallback.startsWith("/admin/") && !requestedCallback.startsWith("//") && requestedCallback !== "/admin/login"
      ? requestedCallback
      : "/admin/dashboard";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    identifier?: string;
    password?: string;
  }>({});

  const validate = () => {
    const errors: { identifier?: string; password?: string } = {};
    if (!identifier.trim()) {
      errors.identifier = "Please enter your email or username";
    }
    if (!password) {
      errors.password = "Please enter your password";
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email: identifier.trim(),
        password,
        portal: "admin",
        redirect: false,
      });

      if (result?.error) {
        setAuthError("This account is not authorized for the Admin Portal, or the credentials are incorrect.");
        notify.error("Unable to sign in", "Use an Admin or Super Admin account for this portal.");
      } else {
        notify.success("Welcome back", "You have successfully signed in.");
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setAuthError("An unexpected connection error occurred. Please try again.");
      notify.error("Connection error", "Unable to reach server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Top back navigation */}
      <div className="mb-6 lg:mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-neutral-500 hover:text-black transition-colors group"
        >
          <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
          <span>Back to Estimator</span>
        </Link>
        <span className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-admin-primary-soft text-admin-primary-foreground border border-admin-primary-border">
          Admin Portal
        </span>
      </div>

      {/* Form Header */}
      <div className="mb-6 lg:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight">
          Welcome back
        </h1>
        <p className="text-neutral-500 text-sm mt-1.5 leading-relaxed">
          Sign in to your authorized administrator account to manage products, pricing, and quotations.
        </p>
      </div>

      {/* Authentication Error Alert */}
      {authError && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200/80 text-red-800 text-sm flex items-start gap-3 animate-fadeIn"
        >
          <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-xs text-red-900 uppercase tracking-wide">
              Authentication Failed
            </p>
            <p className="text-xs sm:text-sm text-red-700 mt-0.5">{authError}</p>
          </div>
        </div>
      )}

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5" noValidate>
        {/* Username or Email */}
        <Input
          id="admin-identifier"
          label="Email or Username"
          type="text"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            if (validationErrors.identifier) {
              setValidationErrors((prev) => ({ ...prev, identifier: undefined }));
            }
          }}
          placeholder="admin@whyte.co.in or username"
          autoComplete="username"
          disabled={loading}
          leftIcon={<User size={18} />}
          error={validationErrors.identifier}
        />

        {/* Password */}
        <Input
          id="admin-password"
          label="Password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (validationErrors.password) {
              setValidationErrors((prev) => ({ ...prev, password: undefined }));
            }
          }}
          placeholder="Enter your password"
          autoComplete="current-password"
          disabled={loading}
          leftIcon={<Lock size={18} />}
          rightIcon={
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="text-neutral-400 hover:text-neutral-600 focus:outline-none focus:text-neutral-900 transition-colors cursor-pointer"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          }
          error={validationErrors.password}
        />

        {/* Submit CTA */}
        <Button
          type="submit"
          loading={loading}
          fullWidth
          variant="primary"
          size="lg"
          className="mt-2 h-12 text-sm sm:text-base bg-black hover:bg-neutral-800 text-white shadow-sm"
        >
          Sign In
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-neutral-500">
        Need an account?{" "}
        <Link
          href="/register"
          className="font-medium text-neutral-900 underline underline-offset-4 hover:text-admin-primary transition-colors"
        >
          Register as a Dealer
        </Link>
      </div>

      {/* Security note footer */}
      <div className="mt-8 pt-6 border-t border-neutral-200 flex items-center justify-center gap-2 text-xs text-neutral-500">
        <ShieldCheck size={16} className="text-admin-primary shrink-0" />
        <span>Secure encrypted administrator access</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="admin-theme min-h-screen w-full flex flex-col lg:flex-row bg-white">
      {/* ──────────────── Left Column: Branded Visual Panel ──────────────── */}
      <div className="relative w-full lg:w-1/2 bg-black text-white flex flex-col justify-between p-6 sm:p-10 lg:p-14 overflow-hidden border-r border-neutral-900">
        {/* Subtle background decoration (neutral grayscale) */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(212,106,140,0.08),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.02),transparent_50%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:36px_36px] pointer-events-none" />
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full border border-admin-primary/15" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full border border-white/[0.06]" />

        {/* Top brand header */}
        <div className="relative z-10">
          <div className="inline-flex items-center rounded-2xl bg-white px-3.5 py-2 sm:px-4 sm:py-2.5 shadow-md">
            <WhyteLogo
              theme="light"
              alt="Whyte logo"
              width={160}
              preload
              className="h-7 sm:h-8"
            />
          </div>
        </div>

        {/* Center Marketing / Platform Highlights */}
        <div className="relative z-10 my-8 lg:my-auto max-w-lg">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-admin-primary/10 border border-admin-primary/30 text-admin-primary text-xs font-medium mb-4 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-admin-primary shadow-[0_0_8px_rgba(212,106,140,0.8)]" />
            <span>Smart Automation Management</span>
          </div>

          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight">
            Powering smarter automation & quotation management.
          </h2>

          <p className="text-neutral-300 text-sm sm:text-base mt-3 leading-relaxed">
            Centralized control center for smart touch panels, retrofits, dynamic matrix pricing catalogs, and automated client proposals.
          </p>

          {/* Feature Highlights (Neutral Black/Gray Glass Treatment with Pink Accents) */}
          <div className="mt-8 space-y-3">
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 backdrop-blur-xs">
              <div className="p-2 rounded-lg bg-admin-primary/15 text-admin-primary border border-admin-primary/30 shrink-0 mt-0.5">
                <Package size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Product Catalog & Matrix Engine</h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Configure modules, finishes, retrofit options, and multi-tier pricing.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 backdrop-blur-xs">
              <div className="p-2 rounded-lg bg-admin-primary/15 text-admin-primary border border-admin-primary/30 shrink-0 mt-0.5">
                <FileText size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Quotation & Proposal Management</h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Generate professional branded estimates with room breakdowns and PDF exports.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 backdrop-blur-xs">
              <div className="p-2 rounded-lg bg-admin-primary/15 text-admin-primary border border-admin-primary/30 shrink-0 mt-0.5">
                <Sliders size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Centralized System Administration</h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Manage categories, house types, room presets, and company GST profiles.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Left Footer */}
        <div className="relative z-10 text-xs text-neutral-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-6 border-t border-white/10">
          <span>© {new Date().getFullYear()} Whyte Automations Pvt. Ltd.</span>
          <span className="flex items-center gap-1.5 text-neutral-300">
            <CheckCircle2 size={13} className="text-admin-primary" />
            Production Portal v2.0
          </span>
        </div>
      </div>

      {/* ──────────────── Right Column: Login Card & Controls ──────────────── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-white">
        <Suspense
          fallback={
            <div className="w-full max-w-md py-12 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-neutral-900" />
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
