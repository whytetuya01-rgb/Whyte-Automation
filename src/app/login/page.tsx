"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { getSession, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, User } from "lucide-react";
import toast from "react-hot-toast";
import { Button, Input } from "@/components/ui";
import WhyteLogo from "@/components/shared/WhyteLogo";
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
        const message = "This account is not authorized for this portal, or the credentials are incorrect.";
        setAuthError(message);
        toast.error(message);
        return;
      }
      const session = await getSession();
      const role = (session?.user as { role?: string } | undefined)?.role;
      let destination = safeUserCallback(searchParams.get("callbackUrl")) ?? "/";
      if (role === "dealer" && (destination === "/dealer/access" || destination.startsWith("/admin") || destination === "/dealers")) {
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
          <div className="bg-neutral-900 p-7 text-white sm:p-10 lg:p-12">
            <div className="inline-flex items-center rounded-xl bg-white px-3 py-1.5 shadow-xs">
              <WhyteLogo theme="light" alt="Whyte logo" size="login" preload />
            </div>
            <div className="mt-16 max-w-md lg:mt-24">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Whyte Automations</p>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Your quotation workspace.</h1>
              <p className="mt-4 text-sm leading-relaxed text-neutral-300 sm:text-base">Sign in to continue with your Dealer account.</p>
            </div>
          </div>
          <div className="p-7 sm:p-10 lg:p-12">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Account sign in</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-neutral-950">Welcome back</h2>
            <p className="mt-2 text-sm text-neutral-500">Use your account email and password.</p>
            {searchParams.get("registered") === "1" && <div role="status" className="mt-6 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={17} className="shrink-0" />Your Dealer account was created. You can sign in now.</div>}
            {authError && <div role="alert" className="mt-6 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={17} className="shrink-0" />{authError}</div>}
            <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
              <Input id="user-email" label="Email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setErrors((current) => ({ ...current, email: undefined })); }} placeholder="you@company.com" autoComplete="email" required disabled={loading} leftIcon={<User size={17} />} error={errors.email} />
              <Input id="user-password" label="Password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: undefined })); }} placeholder="Enter your password" autoComplete="current-password" required disabled={loading} leftIcon={<Lock size={17} />} rightIcon={<button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} className="text-neutral-400 hover:text-neutral-700">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>} error={errors.password} />
              <Button type="submit" fullWidth size="lg" loading={loading} className="mt-2 h-12">Sign in</Button>
            </form>
            <p className="mt-7 border-t border-neutral-200 pt-6 text-sm text-neutral-600">New to Whyte? <Link href="/register" className="font-semibold text-neutral-950 underline underline-offset-4">Create a Dealer account</Link></p>
            <p className="mt-4 text-xs text-neutral-500">Administrator? <Link href="/admin/login" className="font-medium text-neutral-700 underline underline-offset-4">Use the Admin Portal</Link></p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<main className="min-h-screen bg-neutral-50" />}><UserLoginForm /></Suspense>;
}
