"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertCircle, Building2, Eye, EyeOff, Lock, User } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui";
import WhyteLogo from "@/components/shared/WhyteLogo";
import { EMAIL_MESSAGE, isValidEmail, phoneError } from "@/lib/validation/fields";
import LogoCustomizer, { appendLogoDraft, emptyLogoDraft, type LogoDraft, type LogoFieldErrors } from "@/components/company/LogoCustomizer";

type Field =
  | "companyName"
  | "companyEmail"
  | "companyPhone"
  | "companyAddress"
  | "ownerName"
  | "ownerEmail"
  | "ownerPhone"
  | "password"
  | "confirmPassword";
type FormErrors = Partial<Record<Field, string>>;

const initialForm = {
  companyName: "",
  companyEmail: "",
  companyPhone: "",
  companyAddress: "",
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  password: "",
  confirmPassword: "",
};

export default function CompanyRegisterPage() {
  const router = useRouter();
  const submittingRef = useRef(false);
  const [form, setForm] = useState(initialForm);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoDraft, setLogoDraft] = useState<LogoDraft>(() => emptyLogoDraft());
  const [logoErrors, setLogoErrors] = useState<LogoFieldErrors>({});

  const updateField = (field: Field, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFormError(null);
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (form.companyName.trim().length < 2) next.companyName = "Please enter your company name.";
    if (!form.companyEmail.trim()) next.companyEmail = "Please enter the company email.";
    else if (!isValidEmail(form.companyEmail)) next.companyEmail = EMAIL_MESSAGE;
    const companyPhoneIssue = phoneError(form.companyPhone, { required: true });
    if (companyPhoneIssue) next.companyPhone = companyPhoneIssue;
    if (form.companyAddress.trim().length < 5) next.companyAddress = "Please enter the company address.";
    if (form.ownerName.trim().length < 2) next.ownerName = "Please enter the owner's full name.";
    if (!form.ownerEmail.trim()) next.ownerEmail = "Please enter the owner's email.";
    else if (!isValidEmail(form.ownerEmail)) next.ownerEmail = EMAIL_MESSAGE;
    const ownerPhoneIssue = phoneError(form.ownerPhone);
    if (ownerPhoneIssue) next.ownerPhone = ownerPhoneIssue;
    if (form.password.length < 8) next.password = "Password must be at least 8 characters.";
    if (!form.confirmPassword) next.confirmPassword = "Please confirm your password.";
    else if (form.confirmPassword !== form.password) next.confirmPassword = "Passwords do not match.";
    return next;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    submittingRef.current = true;
    setLoading(true);
    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(form)) body.append(key, value);
      // The logo files and presentation settings are only sent when a logo was chosen.
      if (logoDraft.logoFile) appendLogoDraft(body, logoDraft, { includeSettings: true });

      const response = await fetch("/api/company/register", { method: "POST", body });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        const field = result?.error?.field as Field | undefined;
        const message = result?.error?.message ?? "We could not register your company. Please try again.";
        if (field && field in initialForm) setErrors((previous) => ({ ...previous, [field]: message }));
        else if (field && ["logo", "compactLogo", "logoFit", "logoBackground", "logoPadding", "logoRadius"].includes(field)) setLogoErrors({ [field]: message });
        else setFormError(message);
        toast.error(message);
        return;
      }

      // Nothing from the response is carried to the next page: it only confirms the request is under review.
      router.replace("/register/company/submitted");
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
      <section className="relative min-h-[220px] overflow-hidden bg-black p-6 text-white sm:p-10 lg:min-h-screen lg:p-14">
        <div className="relative flex h-full flex-col justify-between">
          <div className="inline-flex w-fit items-center">
            <WhyteLogo theme="dark" alt="Whyte logo" size="login" preload />
          </div>
          <div className="my-8 max-w-lg lg:my-auto">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-admin-primary/30 bg-admin-primary/10 px-3 py-1.5 text-xs font-medium text-admin-primary">
              <Building2 size={14} /> Company registration
            </div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl">Bring your company to Whyte Automations.</h1>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300 sm:text-base">
              Register your company, create its owner account and add your logo. Your products, quotations and branding stay private to your company.
            </p>
          </div>
          <p className="hidden border-t border-white/10 pt-6 text-xs text-neutral-400 lg:block">Every company registration is reviewed by our team before access is granted.</p>
        </div>
      </section>

      <main className="flex w-full items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-2xl">
          <>
              <div className="mb-7">
                <p className="text-xs font-semibold uppercase tracking-wider text-admin-primary">Company registration</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">Register your company</h2>
                <p className="mt-2 text-sm text-neutral-500">Fields marked * are required.</p>
              </div>
              {formError && (
                <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
                  <AlertCircle size={17} className="mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <fieldset className="space-y-4" disabled={loading}>
                  <legend className="mb-1 text-sm font-semibold text-neutral-950">Company</legend>
                  <Input id="company-name" label="Company Name *" value={form.companyName} onChange={(e) => updateField("companyName", e.target.value)} leftIcon={<Building2 size={16} />} placeholder="Acme Smart Homes Pvt. Ltd." autoComplete="organization" error={errors.companyName} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input id="company-email" label="Company Email *" type="email" value={form.companyEmail} onChange={(e) => updateField("companyEmail", e.target.value)} placeholder="info@company.com" autoComplete="off" error={errors.companyEmail} />
                    <Input id="company-phone" label="Company Phone *" type="tel" value={form.companyPhone} onChange={(e) => updateField("companyPhone", e.target.value)} placeholder="+91 98765 43210" inputMode="tel" autoComplete="off" error={errors.companyPhone} />
                  </div>
                  <Textarea id="company-address" label="Company Address *" value={form.companyAddress} onChange={(e) => updateField("companyAddress", e.target.value)} placeholder="Building, street, city, state and PIN code" rows={3} error={errors.companyAddress} />

                  <div>
                    <p className="mb-2 text-sm font-semibold text-neutral-900">
                      Company Logo <span className="font-normal text-neutral-500">(optional)</span>
                    </p>
                    <LogoCustomizer draft={logoDraft} onChange={(next) => { setLogoDraft(next); setLogoErrors({}); }} companyName={form.companyName.trim() || null} errors={logoErrors} disabled={loading} />
                  </div>
                </fieldset>

                <fieldset className="space-y-4" disabled={loading}>
                  <legend className="mb-1 mt-2 text-sm font-semibold text-neutral-950">Company Owner</legend>
                  <Input id="owner-name" label="Owner Full Name *" value={form.ownerName} onChange={(e) => updateField("ownerName", e.target.value)} leftIcon={<User size={16} />} placeholder="Jane Doe" autoComplete="name" error={errors.ownerName} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input id="owner-email" label="Owner Email *" type="email" value={form.ownerEmail} onChange={(e) => updateField("ownerEmail", e.target.value)} placeholder="owner@company.com" autoComplete="email" error={errors.ownerEmail} />
                    <Input id="owner-phone" label="Owner Phone" type="tel" value={form.ownerPhone} onChange={(e) => updateField("ownerPhone", e.target.value)} placeholder="+91 98765 43210" inputMode="tel" autoComplete="tel" error={errors.ownerPhone} />
                  </div>
                  <Input
                    id="owner-password"
                    label="Password *"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => updateField("password", e.target.value)}
                    leftIcon={<Lock size={16} />}
                    rightIcon={
                      <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} className="text-neutral-500 hover:text-neutral-900">
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    error={errors.password}
                  />
                  <Input id="owner-confirm-password" label="Confirm Password *" type={showPassword ? "text" : "password"} value={form.confirmPassword} onChange={(e) => updateField("confirmPassword", e.target.value)} leftIcon={<Lock size={16} />} placeholder="Repeat the password" autoComplete="new-password" error={errors.confirmPassword} />
                </fieldset>

                <Button type="submit" fullWidth variant="primary" size="lg" loading={loading} className="mt-2 h-12 bg-black text-sm text-white shadow-sm hover:bg-neutral-800 sm:text-base">
                  Register company
                </Button>
              </form>
              <div className="mt-7 flex flex-col items-center justify-between gap-3 border-t border-neutral-200 pt-6 text-sm sm:flex-row">
                <span className="text-neutral-500">
                  Already registered? <Link href="/admin/login" className="font-medium text-neutral-900 underline underline-offset-4">Sign in</Link>
                </span>
                <span className="text-xs text-neutral-400">
                  Dealer accounts are provisioned by company administrators.
                </span>
              </div>
          </>
        </div>
      </main>
    </div>
  );
}
