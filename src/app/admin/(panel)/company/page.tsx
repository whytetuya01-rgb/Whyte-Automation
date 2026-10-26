"use client";
import { useRef, useState, useEffect } from "react";
import Image from "next/image";
import { Building2, ImagePlus, Trash2 } from "lucide-react";
import { Company } from "@/types";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useCompany } from "@/lib/swr";
import { Input, Textarea, Button } from "@/components/ui";
import { emailError, gstinError, phoneError } from "@/lib/validation/fields";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_SIZE } from "@/lib/validation/upload";

export default function CompanyPage() {
  const { data: fetched, isLoading: loading, mutate } = useCompany();

  const [company, setCompany] = useState<Partial<Company>>({
    name: "",
    gstNumber: "",
    phone: "",
    email: "",
    address: "",
    tagline: "",
  });
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // The logo is saved on its own (POST/DELETE /api/company/logo): the company id comes from the session, so it can
  // only ever change this company's logo, and the stored file and URL stay in step.
  const uploadLogo = async (file: File | null) => {
    if (!file) return;
    setLogoError(null);
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setLogoError("Use a PNG, JPG or WebP image.");
    } else if (file.size > MAX_UPLOAD_SIZE) {
      setLogoError(`The logo must be ${Math.floor(MAX_UPLOAD_SIZE / (1024 * 1024))}MB or smaller.`);
    } else {
      setLogoBusy(true);
      try {
        const body = new FormData();
        body.append("logo", file);
        const response = await fetch("/api/company/logo", { method: "POST", body });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          setLogoError(result?.error?.message ?? "The logo could not be uploaded. Please try again.");
        } else {
          notify.success("Logo updated", "Your company logo has been saved.");
          mutate();
        }
      } catch {
        setLogoError("Unable to reach the server. Please try again.");
      } finally {
        setLogoBusy(false);
      }
    }
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const removeLogo = async () => {
    setLogoError(null);
    setLogoBusy(true);
    try {
      const response = await fetch("/api/company/logo", { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setLogoError(result?.error?.message ?? "The logo could not be removed.");
      } else {
        mutate();
      }
    } catch {
      setLogoError("Unable to reach the server. Please try again.");
    } finally {
      setLogoBusy(false);
    }
  };

  // Sync SWR data into local form state when it arrives
  useEffect(() => {
    if (fetched) {
      setCompany(fetched);
    }
  }, [fetched]);

  const [errors, setErrors] = useState<{ gstNumber?: string; phone?: string; email?: string }>({});
  const clearError = (field: "gstNumber" | "phone" | "email") =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = {
      gstNumber: gstinError(company.gstNumber ?? "") ?? undefined,
      phone: phoneError(company.phone ?? "", { required: true }) ?? undefined,
      email: emailError(company.email ?? "") ?? undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.gstNumber || nextErrors.phone || nextErrors.email) return;
    setSaving(true);
    try {
      const payload = {
        name: company.name?.trim(),
        gstNumber: company.gstNumber?.trim() || null,
        phone: company.phone?.trim() ?? "",
        email: company.email?.trim() || null,
        address: company.address?.trim() ?? "",
        tagline: company.tagline?.trim() || null,
      };
      await apiJson.patch("/api/company", payload);
      notify.success("Settings saved", "Company profile information updated successfully.");
      mutate();
    } catch (err: unknown) {
      notifyApiError(err, "Unable to save settings", "Failed to update company information. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Company Settings"
        icon={Building2}
        subtitle="Shown on all PDF quotations"
        className="mb-4 sm:mb-6"
      />

      <div className="mb-4 flex items-center gap-4 rounded-2xl border border-admin-grey-border bg-white p-4 shadow-xs sm:p-6">
        <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-50" data-testid="company-logo-frame">
          {company.logoUrl ? (
            <Image src={company.logoUrl} alt={`${company.name ?? "Company"} logo`} width={128} height={80} unoptimized className="max-h-full max-w-full object-contain" />
          ) : (
            <ImagePlus size={26} className="text-gray-300" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-gray-900">Company logo</p>
          <p className="text-xs text-gray-500">PNG, JPG or WebP, up to {Math.floor(MAX_UPLOAD_SIZE / (1024 * 1024))}MB. Without a logo the default Whyte branding is used.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 aria-disabled:opacity-60" aria-disabled={logoBusy}>
              {logoBusy ? "Working…" : company.logoUrl ? "Replace logo" : "Upload logo"}
              <input
                ref={logoInputRef}
                type="file"
                accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
                aria-label="Company logo file"
                className="sr-only"
                disabled={logoBusy}
                onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)}
              />
            </label>
            {company.logoUrl && (
              <button type="button" disabled={logoBusy} onClick={() => void removeLogo()} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-60">
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
          {logoError && <p role="alert" className="text-xs font-medium text-red-600">{logoError}</p>}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-xs border border-admin-grey-border p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            label="Company Name"
            type="text"
            required
            value={company.name ?? ""}
            onChange={(e) => setCompany({ ...company, name: e.target.value })}
            placeholder="Whyte Automations Pvt. Ltd."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Company GST Number"
              type="text"
              value={company.gstNumber ?? ""}
              onChange={(e) => {
                setCompany({ ...company, gstNumber: e.target.value.toUpperCase().replace(/\s+/g, "") });
                clearError("gstNumber");
              }}
              onBlur={() => setErrors((prev) => ({ ...prev, gstNumber: gstinError(company.gstNumber ?? "") ?? undefined }))}
              error={errors.gstNumber}
              maxLength={15}
              placeholder="27AAPFU0939F1ZV"
            />

            <Input
              label="Phone"
              type="text"
              required
              value={company.phone ?? ""}
              onChange={(e) => {
                setCompany({ ...company, phone: e.target.value });
                clearError("phone");
              }}
              onBlur={() => setErrors((prev) => ({ ...prev, phone: phoneError(company.phone ?? "", { required: true }) ?? undefined }))}
              error={errors.phone}
              placeholder="+91 98765 43210"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              value={company.email ?? ""}
              onChange={(e) => {
                setCompany({ ...company, email: e.target.value });
                clearError("email");
              }}
              onBlur={() => setErrors((prev) => ({ ...prev, email: emailError(company.email ?? "") ?? undefined }))}
              error={errors.email}
              placeholder="info@whyte.co.in"
            />

            <Input
              label="Tagline (on PDF header)"
              type="text"
              value={company.tagline ?? ""}
              onChange={(e) => setCompany({ ...company, tagline: e.target.value })}
              placeholder="Smart Homes. Smarter Living."
            />
          </div>

          <Textarea
            label="Address"
            required
            value={company.address ?? ""}
            onChange={(e) => setCompany({ ...company, address: e.target.value })}
            className="resize-none"
            rows={3}
            placeholder="Full company address..."
          />

          <Button
            type="submit"
            loading={saving}
            fullWidth
            variant="primary"
            size="lg"
            className="mt-2"
          >
            Save Company Settings
          </Button>
        </form>
      </div>
    </div>
  );
}
