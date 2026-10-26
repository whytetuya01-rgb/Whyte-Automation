"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { getSession, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Lock,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button, Input } from "@/components/ui";
import WhyteLogo from "@/components/shared/WhyteLogo";
import { REVIEW_BLOCK_MESSAGES, type LoginBlock } from "@/lib/companyReviewStatus";
import { EMAIL_MESSAGE, isValidEmail } from "@/lib/validation/fields";

function safeUserCallback(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/admin")) return null;
  return value;
}

function UserLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [authError, setAuthError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: { email?: string; password?: string } = {};
    if (!email.trim()) nextErrors.email = "Please enter your email address.";
    else if (!isValidEmail(email)) nextErrors.email = EMAIL_MESSAGE;
    if (!password) nextErrors.password = "Please enter your password.";
    setErrors(nextErrors);
    setAuthError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      const result = await signIn("credentials", { email: email.trim(), password, portal: "user", redirect: false });
      if (result?.error) {
        let message = "Invalid email address or password. Please try again.";
        if (result.error === "ADMIN_IN_USER_PORTAL") {
          message = "This portal is exclusively for Dealer accounts. Administrators must log in via the Admin Portal at /admin/login.";
        } else if (result.error in REVIEW_BLOCK_MESSAGES) {
          message = REVIEW_BLOCK_MESSAGES[result.error as LoginBlock];
        }
        setAuthError(message);
        toast.error(message);
        return;
      }
      const session = await getSession();
      const role = (session?.user as { role?: string } | undefined)?.role;
      if (role !== "dealer") {
        const message = "This portal is strictly for Dealers. Administrators must use /admin/login.";
        setAuthError(message);
        toast.error(message);
        return;
      }
      let destination = safeUserCallback(searchParams.get("callbackUrl")) ?? "/";
      if (destination === "/dealer/access" || destination.startsWith("/admin") || destination === "/dealers") {
        destination = "/";
      }
      toast.success("Welcome back.");
      router.replace(destination);
      router.refresh();
    } catch {
      const message = "Unable to reach the server. Please try again.";
      setAuthError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50 px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl shadow-neutral-900/5 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Left Column: Brand & Dealer Highlights */}
          <div className="relative flex flex-col justify-between overflow-hidden bg-neutral-950 p-7 text-white sm:p-10 lg:p-12">
            {/* Background decoration */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(216,91,131,0.08),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.02),transparent_50%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />

            <div className="relative z-10">
              <div className="inline-flex items-center">
                <WhyteLogo theme="dark" alt="Whyte logo" size="login" preload />
              </div>
            </div>

            <div className="relative z-10 my-10 max-w-md lg:my-auto">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-admin-primary/30 bg-admin-primary/10 px-3 py-1 text-xs font-medium text-admin-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-admin-primary shadow-[0_0_8px_rgba(216,91,131,0.8)]" />
                <span>Authorized Dealer Portal</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Your quotation workspace.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
                Sign in to configure smart panels, access live matrix pricing, and generate branded client proposals.
              </p>

              {/* Feature Highlights */}
              <div className="mt-8 space-y-2.5">
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-xs">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-admin-primary/30 bg-admin-primary/15 text-admin-primary">
                    <FileText size={16} />
                  </div>
                  <div className="text-xs">
                    <p className="font-semibold text-white">Smart Quotation Engine</p>
                    <p className="text-neutral-400">Build and customize room-by-room quotations</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-xs">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-admin-primary/30 bg-admin-primary/15 text-admin-primary">
                    <Sparkles size={16} />
                  </div>
                  <div className="text-xs">
                    <p className="font-semibold text-white">Dynamic Matrix Pricing</p>
                    <p className="text-neutral-400">Instant GST calculations and proposal exports</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Left Column Footer */}
            <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-neutral-400">
              <span>Whyte Automations</span>
              <span className="flex items-center gap-1.5 text-neutral-300">
                <ShieldCheck size={14} className="text-admin-primary" />
                Dealer Access
              </span>
            </div>
          </div>

          {/* Right Column: Sign In Form + Registration Section */}
          <div className="flex flex-col justify-between p-7 sm:p-10 lg:p-12">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                Dealer sign in
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-neutral-950">
                Welcome back
              </h2>
              <p className="mt-1.5 text-sm text-neutral-500">
                Enter your credentials to access your quotation workspace.
              </p>

              {searchParams.get("registered") === "1" && (
                <div role="status" className="mt-5 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <CheckCircle2 size={17} className="shrink-0" />
                  Your Dealer account was created. You can sign in now.
                </div>
              )}

              {authError && (
                <div role="alert" className="mt-5 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={17} className="shrink-0" />
                  {authError}
                </div>
              )}

              <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                <Input
                  id="user-email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setErrors((current) => ({ ...current, email: undefined }));
                  }}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  disabled={loading}
                  leftIcon={<User size={17} />}
                  error={errors.email}
                />
                <Input
                  id="user-password"
                  label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setErrors((current) => ({ ...current, password: undefined }));
                  }}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  leftIcon={<Lock size={17} />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="cursor-pointer text-neutral-400 transition-colors hover:text-neutral-700"
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  }
                  error={errors.password}
                />
                <Button
                  type="submit"
                  fullWidth
                  size="lg"
                  loading={loading}
                  className="mt-2 h-12 bg-black font-medium text-white shadow-sm hover:bg-neutral-800"
                >
                  Sign in
                </Button>
              </form>
            </div>

            {/* Registration & Additional Options Section */}
            <div className="mt-8 border-t border-neutral-200 pt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                  New to Whyte?
                </span>
                <span className="text-xs text-neutral-400">Company registration</span>
              </div>

              <div>
                <Link
                  href="/register/company"
                  className="group relative flex items-center justify-between rounded-xl border border-neutral-200/90 bg-neutral-50/70 p-3.5 transition-all hover:border-neutral-300 hover:bg-neutral-100 hover:shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-neutral-200 shadow-2xs text-neutral-700">
                      <Building2 size={16} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-neutral-900">Register your company</div>
                      <p className="text-[11px] text-neutral-500">Create an enterprise partner organization</p>
                    </div>
                  </div>
                  <ArrowRight
                    size={15}
                    className="text-neutral-400 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-900"
                  />
                </Link>
                <div className="mt-2.5 rounded-lg bg-neutral-50 border border-neutral-200/60 p-2.5 text-[11px] text-neutral-500 text-center">
                  Dealer accounts are provisioned directly by company administrators.
                </div>
              </div>

              {/* Admin Portal Link */}
              <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-4 text-xs text-neutral-500">
                <span className="flex items-center gap-1.5 text-neutral-500">
                  <ShieldCheck size={14} className="text-neutral-400" />
                  Administrator account?
                </span>
                <Link
                  href="/admin/login"
                  className="font-medium text-neutral-800 underline underline-offset-4 transition-colors hover:text-black"
                >
                  Use the Admin Portal &rarr;
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<main className="min-h-screen bg-neutral-50" />}><UserLoginForm /></Suspense>;
}
