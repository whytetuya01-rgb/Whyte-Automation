"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { HouseType } from "@/types";
import { Input, Select, Textarea, Button } from "@/components/ui";

type HouseTypeOption = Pick<HouseType, "id" | "name" | "description" | "isActive" | "sortOrder">;

interface NewQuotationFormProps {
  initialHouseTypes: HouseTypeOption[];
}

export default function NewQuotationForm({ initialHouseTypes }: NewQuotationFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    clientName: "",
    clientGstNumber: "",
    clientPhone: "",
    clientEmail: "",
    clientAddress: "",
    houseTypeId: "",
    defaultTier: "",
    defaultFinish: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const houseTypes = useMemo(
    () => (Array.isArray(initialHouseTypes) ? initialHouseTypes.filter((ht) => ht.isActive !== false) : []),
    [initialHouseTypes]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          clientGstNumber: form.clientGstNumber.trim() || null,
          houseTypeId: form.houseTypeId ? Number(form.houseTypeId) : null,
          defaultTier: form.defaultTier || null,
          defaultFinish: form.defaultFinish || null,
        }),
      });

      if (!res.ok) throw new Error();

      const data = await res.json();
      toast.success("Quotation created!");
      router.push(`/quotation/${data.id}`);
    } catch {
      toast.error("Failed to create quotation");
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-4 sm:mb-6">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3 sm:mb-4 transition">
          <ArrowLeft size={16} />
          Back
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">New Quotation</h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-1">Fill in client details to get started</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Client Name"
            required
            type="text"
            value={form.clientName}
            onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            placeholder="Enter client name"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Phone"
              type="tel"
              value={form.clientPhone}
              onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}
              placeholder="+91 98765 43210"
            />

            <Input
              label="Email"
              type="email"
              value={form.clientEmail}
              onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}
              placeholder="client@email.com"
            />
          </div>

          <Input
            label="Customer GST Number (Optional)"
            type="text"
            value={form.clientGstNumber}
            onChange={(e) => setForm({ ...form, clientGstNumber: e.target.value.toUpperCase() })}
            placeholder="Enter customer GSTIN (if available)"
          />

          <Textarea
            label="Project Address"
            value={form.clientAddress}
            onChange={(e) => setForm({ ...form, clientAddress: e.target.value })}
            className="resize-none"
            rows={2}
            placeholder="Full project address..."
          />

          <Select
            label="House Type"
            value={form.houseTypeId}
            onChange={(e) => setForm({ ...form, houseTypeId: e.target.value })}
            helperText="Rooms will be auto-populated based on house type"
            options={[
              { value: "", label: "- Select House Type (optional) -" },
              ...houseTypes.map((ht) => ({
                value: String(ht.id),
                label: `${ht.name}${ht.description ? ` - ${ht.description}` : ""}`,
              })),
            ]}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Default Automation Tier"
              value={form.defaultTier}
              onChange={(e) => setForm({ ...form, defaultTier: e.target.value })}
              helperText="Auto-selects this tier when adding switch boards"
              options={[
                { value: "", label: "— None (pick per product) —" },
                { value: "remote", label: "Remote Based" },
                { value: "wifi", label: "WiFi" },
                { value: "zigbee", label: "Zigbee" },
              ]}
            />

            <Select
              label="Default Surface Finish"
              value={form.defaultFinish}
              onChange={(e) => setForm({ ...form, defaultFinish: e.target.value })}
              helperText="Auto-selects this finish when adding products"
              options={[
                { value: "", label: "— None (pick per product) —" },
                { value: "acrylic", label: "Acrylic" },
                { value: "glass", label: "Glass" },
                { value: "metal", label: "Metal" },
                { value: "wood", label: "Wood" },
              ]}
            />
          </div>

          <Button
            type="submit"
            loading={submitting}
            fullWidth
            variant="primary"
            size="lg"
            className="mt-2"
          >
            Create Quotation →
          </Button>
        </form>
      </div>
    </div>
  );
}
