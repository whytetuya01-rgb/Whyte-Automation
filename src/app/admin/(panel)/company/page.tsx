"use client";
import { useState, useEffect } from "react";
import { Company } from "@/types";
import notify from "@/lib/notify";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useCompany } from "@/lib/swr";
import { Input, Textarea, Button } from "@/components/ui";

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

  // Sync SWR data into local form state when it arrives
  useEffect(() => {
    if (fetched) {
      setCompany(fetched);
    }
  }, [fetched]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
      if (!res.ok) throw new Error();
      notify.success("Settings saved", "Company profile information updated successfully.");
      mutate();
    } catch {
      notify.error("Unable to save settings", "Failed to update company information. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-2xl">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">Company Settings</h1>
        <p className="text-neutral-500 text-xs sm:text-sm mt-1">Shown on all PDF quotations</p>
      </div>

      <div className="bg-white rounded-2xl shadow-xs border border-admin-grey-border p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
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
              onChange={(e) => setCompany({ ...company, gstNumber: e.target.value.toUpperCase() })}
              placeholder="24AAXCS4505Q1ZK"
            />

            <Input
              label="Phone"
              type="text"
              required
              value={company.phone ?? ""}
              onChange={(e) => setCompany({ ...company, phone: e.target.value })}
              placeholder="+91 98765 43210"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              value={company.email ?? ""}
              onChange={(e) => setCompany({ ...company, email: e.target.value })}
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
