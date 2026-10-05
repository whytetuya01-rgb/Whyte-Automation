"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, User } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui";
import WhyteLogo from "@/components/shared/WhyteLogo";

type Field = "firstName" | "lastName" | "email" | "password" | "gstNumber" | "contactNumber" | "address";
type RegistrationErrors = Partial<Record<Field, string>>;

const initialForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  gstNumber: "",
  contactNumber: "",
  address: "",
};

export default function AdminRegisterPage() {
  const router = useRouter();
  const submittingRef = useRef(false);
  const [form, setForm] = useState(initialForm);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const clearError = (field: Field) => {
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFormError(null);
  };

  const updateField = (field: Field, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    clearError(field);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextErrors: RegistrationErrors = {};
    if (!form.firstName.trim()) nextErrors.firstName = "Please enter your first name.";
    if (!form.lastName.trim()) nextErrors.lastName = "Please enter your last name.";
    if (!form.email.trim()) nextErrors.email = "Please enter your email address.";
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) nextErrors.email = "Please enter a valid email address.";
    if (form.password.length < 8) nextErrors.password = "Password must be at least 8 characters.";
    const contactDigits = form.contactNumber.replace(/\D/g, "");
    if (!form.contactNumber.trim()) nextErrors.contactNumber = "Please enter your contact number.";
    else if (!(contactDigits.length === 10 || (contactDigits.length === 12 && contactDigits.startsWith("91")))) {
      nextErrors.contactNumber = "Enter a valid 10-digit Indian mobile number.";
    }
    if (!form.address.trim()) nextErrors.address = "Please enter your address.";
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    submittingRef.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409) {
          setErrors((previous) => ({ ...previous, email: "An account with this email already exists." }));
        } else if (result?.error?.field && result?.error?.message) {
          setErrors((previous) => ({ ...previous, [result.error.field]: result.error.message }));
        } else {
          setFormError(result?.error?.message ?? "We could not create your account. Please try again.");
        }
        toast.error(result?.error?.message ?? "We could not create your account.");
        return;
      }

      toast.success("Dealer account created. Please sign in.");
      router.replace("/login?registered=1");
      router.refresh();
    } catch {
      const message = "Unable to reach the server. Please check your connection and try again.";
      setFormError(message);
      toast.error(message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="admin-theme min-h-screen w-full bg-white lg:grid lg:grid-cols-2">
      <section className="relative min-h-[250px] overflow-hidden bg-black p-6 text-white sm:p-10 lg:min-h-screen lg:p-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(212,106,140,0.10),transparent_42%),linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px]" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="inline-flex w-fit items-center rounded-xl bg-white px-3 py-1.5 shadow-xs">
            <WhyteLogo theme="light" alt="Whyte logo" size="login" preload />
          </div>
          <div className="my-8 max-w-lg lg:my-auto">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-admin-primary/30 bg-admin-primary/10 px-3 py-1.5 text-xs font-medium text-admin-primary"><ShieldCheck size={14} /> Dealer access</div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl">Get started with Whyte Automations.</h1>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">Create a Dealer account for your business. Administrative access remains separate and protected.</p>
          </div>
          <p className="hidden border-t border-white/10 pt-6 text-xs text-neutral-400 lg:block">Secure account creation for Whyte Automations partners.</p>
        </div>
      </section>

      <main className="flex w-full items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-2xl">
          <div className="mb-7"><p className="text-xs font-semibold uppercase tracking-wider text-admin-primary">Dealer registration</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">Create your account</h2><p className="mt-2 text-sm leading-relaxed text-neutral-500">Fields marked with an asterisk are required.</p></div>
          {formError && <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"><AlertCircle size={17} className="mt-0.5 shrink-0" /><span>{formError}</span></div>}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="dealer-first-name" label="First Name" value={form.firstName} onChange={(event) => updateField("firstName", event.target.value)} leftIcon={<User size={16} />} placeholder="Jane" autoComplete="given-name" required disabled={loading} error={errors.firstName} />
              <Input id="dealer-last-name" label="Last Name" value={form.lastName} onChange={(event) => updateField("lastName", event.target.value)} leftIcon={<User size={16} />} placeholder="Doe" autoComplete="family-name" required disabled={loading} error={errors.lastName} />
            </div>
            <Input id="dealer-email" label="Email ID" type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} leftIcon={<AlertCircle size={16} />} placeholder="you@company.com" autoComplete="email" required disabled={loading} error={errors.email} />
            <Input id="dealer-password" label="Password" type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => updateField("password", event.target.value)} leftIcon={<Lock size={16} />} rightIcon={<button type="button" onClick={() => setShowPassword((visible) => !visible)} className="text-neutral-400 hover:text-neutral-700" aria-label={showPassword ? "Hide password" : "Show password"} disabled={loading}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>} placeholder="At least 8 characters" autoComplete="new-password" required disabled={loading} error={errors.password} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input id="dealer-gst-number" label="GST Number" value={form.gstNumber} onChange={(event) => updateField("gstNumber", event.target.value)} placeholder="Optional" autoComplete="off" disabled={loading} error={errors.gstNumber} />
              <Input id="dealer-contact-number" label="Contact Number" type="tel" value={form.contactNumber} onChange={(event) => updateField("contactNumber", event.target.value)} placeholder="+91 98765 43210" autoComplete="tel" inputMode="tel" required disabled={loading} error={errors.contactNumber} />
            </div>
            <Textarea id="dealer-address" label="Address" value={form.address} onChange={(event) => updateField("address", event.target.value)} placeholder="Building, street, city, state and PIN code" autoComplete="street-address" rows={4} required disabled={loading} error={errors.address} />
            <Button type="submit" fullWidth variant="primary" size="lg" loading={loading} className="mt-2 h-12 bg-black text-sm text-white shadow-sm hover:bg-neutral-800 sm:text-base">Register</Button>
          </form>
          <div className="mt-7 flex flex-col items-center justify-between gap-3 border-t border-neutral-200 pt-6 text-sm sm:flex-row"><span className="text-neutral-500">Already registered? <Link href="/login" className="font-medium text-neutral-900 underline underline-offset-4">Login</Link></span><span className="flex items-center gap-1.5 text-xs text-neutral-500"><CheckCircle2 size={14} className="text-admin-primary" /> Dealer-only account</span></div>
        </div>
      </main>
    </div>
  );
}
