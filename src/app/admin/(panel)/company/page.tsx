"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Company } from "@/types";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useCompany } from "@/lib/swr";
import { Input, Textarea, Button } from "@/components/ui";
import { emailError, gstinError, phoneError } from "@/lib/validation/fields";
import DocumentContentEditor from "@/components/company/DocumentContentEditor";
import CoverImageEditor from "@/components/company/CoverImageEditor";
import type { DocumentSettings } from "@/lib/documentSettings";
import LogoCustomizer, { appendLogoDraft, emptyLogoDraft, isLogoDraftDirty, type LogoDraft, type LogoFieldErrors } from "@/components/company/LogoCustomizer";
import { normalizeLogoSettings } from "@/lib/logoSettings";
import { refreshCachedBranding } from "@/lib/offline/identity";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";

type TabId = "profile" | "logo" | "document";
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "profile", label: "Company Profile" },
  { id: "logo", label: "Logo Customization" },
  { id: "document", label: "Document & Social Links" },
];

export default function CompanyPage() {
  const { data: fetched, isLoading: loading, mutate } = useCompany();
  // A Super Admin on the platform (not acting as a company) has no company to edit; every save would be refused.
  const hasCompany = useCompanyBranding().companyId !== null;

  const [company, setCompany] = useState<Partial<Company>>({
    name: "",
    gstNumber: "",
    phone: "",
    email: "",
    address: "",
    tagline: "",
  });
  const [saving, setSaving] = useState(false);
  const [logoSaving, setLogoSaving] = useState(false);
  const [tab, setTab] = useState<TabId>("profile");
  const router = useRouter();
  const [logoDraft, setLogoDraft] = useState<LogoDraft>(() => emptyLogoDraft());
  const [logoErrors, setLogoErrors] = useState<LogoFieldErrors>({});
  const savedSettings = normalizeLogoSettings(fetched?.logoSettings);
  const logoDirty = isLogoDraftDirty(logoDraft, savedSettings);

  // The draft starts from (and Discard returns to) what is saved; settings follow the saved values until edited.
  const savedKey = `${savedSettings.fit}|${savedSettings.background}|${savedSettings.padding}|${savedSettings.radius}`;
  useEffect(() => {
    setLogoDraft(emptyLogoDraft(normalizeLogoSettings(fetched?.logoSettings)));
    setLogoErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  // Saves the logo, compact logo and presentation settings in one request. The company comes from the session, so
  // it can only ever change this company's branding; on failure the stored logo is left exactly as it was.
  const saveLogo = async (): Promise<boolean> => {
    const body = new FormData();
    appendLogoDraft(body, logoDraft, { includeSettings: true });
    try {
      const response = await fetch("/api/company/logo", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const field = result?.error?.field as keyof LogoFieldErrors | undefined;
        const message = result?.error?.message ?? "The logo could not be saved. Your current logo was not changed.";
        setLogoErrors(field ? { [field]: message } : { logo: message });
        notify.error("Logo not saved", message);
        return false;
      }
      return true;
    } catch {
      const message = "Unable to reach the server. Your current logo was not changed.";
      setLogoErrors({ logo: message });
      notify.error("Logo not saved", message);
      return false;
    }
  };

  // "Save Logo Settings": saves the logo and settings, then refreshes everything that shows the branding (the server
  // rendered header/sidebar/loader through router.refresh, the SWR copy, and the cached offline pages).
  const handleSaveLogo = async () => {
    setLogoSaving(true);
    setLogoErrors({});
    try {
      if (!(await saveLogo())) return;
      setLogoDraft(emptyLogoDraft(logoDraft.settings));
      await mutate();
      router.refresh();
      void refreshCachedBranding();
      notify.success("Logo settings saved", "Your company logo and its settings have been updated.");
    } finally {
      setLogoSaving(false);
    }
  };
  // "Save Document Content": the company comes from the session; the server validates every field (bounded text,
  // https links, social links on their own network) and only the default company may pick the standard intro pages.
  const [documentSaving, setDocumentSaving] = useState(false);
  const saveDocumentContent = async (documentSettings: DocumentSettings) => {
    setDocumentSaving(true);
    try {
      const response = await fetch("/api/company", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentSettings }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const message = result?.error?.message ?? "The document content could not be saved. Nothing was changed.";
        notify.error("Document content not saved", message);
        return { field: undefined, message };
      }
      await mutate();
      router.refresh();
      notify.success("Document content saved", "Your quotation documents and page footer use the new content.");
      return null;
    } catch {
      const message = "Unable to reach the server. Nothing was changed.";
      notify.error("Document content not saved", message);
      return { field: undefined, message };
    } finally {
      setDocumentSaving(false);
    }
  };
  const discardLogoChanges = () => {
    setLogoDraft(emptyLogoDraft(savedSettings));
    setLogoErrors({});
  };

  const onTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length];
    setTab(target.id);
    document.getElementById(`company-tab-${target.id}`)?.focus();
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
    <div className="max-w-3xl">
      <PageHeader
        title="Company Settings"
        icon={Building2}
        subtitle="Shown on all PDF quotations"
        className="mb-4 sm:mb-6"
      />

      {!hasCompany && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status" data-testid="company-platform-notice">
          You are in platform mode, so there is no company profile to edit. Use <strong>Act as company</strong> to choose one.
        </p>
      )}

      <div role="tablist" aria-label="Company settings" className="mb-4 flex gap-1 border-b border-admin-grey-border">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            id={`company-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`company-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            className={cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary",
              tab === item.id ? "border-admin-primary text-admin-primary" : "border-transparent text-gray-500 hover:text-gray-900"
            )}
          >
            {item.label}
            {item.id === "logo" && logoDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved logo changes" aria-label="Unsaved logo changes" />}
          </button>
        ))}
      </div>

      {tab === "logo" && (
        <div id="company-panel-logo" role="tabpanel" aria-labelledby="company-tab-logo" className="rounded-2xl border border-admin-grey-border bg-white p-4 shadow-xs sm:p-6">
          <LogoCustomizer
            draft={logoDraft}
            onChange={setLogoDraft}
            savedLogoUrl={fetched?.logoUrl ?? null}
            savedCompactLogoUrl={fetched?.compactLogoUrl ?? null}
            companyName={company.name}
            errors={logoErrors}
            disabled={logoSaving || !hasCompany}
          />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-admin-grey-border pt-4">
            <p className="text-xs text-gray-500" role="status">
              {logoDirty ? "You have unsaved logo changes." : "Everything shown is saved."}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" disabled={!logoDirty || logoSaving} onClick={discardLogoChanges}>
                Cancel changes
              </Button>
              <Button type="button" variant="primary" loading={logoSaving} disabled={!logoDirty || !hasCompany} onClick={() => void handleSaveLogo()}>
                Save Logo Settings
              </Button>
            </div>
          </div>
        </div>
      )}

      {tab === "document" && fetched && (
        <div id="company-panel-document" role="tabpanel" aria-labelledby="company-tab-document" className="rounded-2xl border border-admin-grey-border bg-white p-4 shadow-xs sm:p-6">
          <div className="mb-6 border-b border-admin-grey-border pb-6">
            <CoverImageEditor
              coverImageUrl={fetched.coverImageUrl ?? null}
              onChanged={async () => {
                await mutate();
              }}
            />
          </div>
          <DocumentContentEditor company={fetched} saving={documentSaving} onSave={saveDocumentContent} />
        </div>
      )}

      {tab === "profile" && (
        <form id="company-panel-profile" role="tabpanel" aria-labelledby="company-tab-profile" onSubmit={handleSubmit} noValidate>
      <div className="bg-white rounded-2xl shadow-xs border border-admin-grey-border p-4 sm:p-6">
        <div className="space-y-4">
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
            disabled={!hasCompany}
            fullWidth
            variant="primary"
            size="lg"
            className="mt-2"
          >
            Save Company Settings
          </Button>
        </div>
      </div>
        </form>
      )}
    </div>
  );
}
