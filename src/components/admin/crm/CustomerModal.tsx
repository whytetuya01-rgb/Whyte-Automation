"use client";

import { useState, useEffect } from "react";
import Modal from "@/components/shared/Modal";
import { Button, Input, Select, Textarea } from "@/components/ui";
import IndiaPhoneInput from "@/components/ui/IndiaPhoneInput";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { Customer, CustomerType } from "@/types/crm";
import { CUSTOMER_TYPE_LABELS } from "@/types/crm";
import { TagInput } from "@/components/admin/crm/LeadTags";
import type { TagCount } from "@/lib/leadTags";
import { parseCustomerNotes } from "@/lib/crmCustomerInsights";

interface CustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  customer?: Customer | null;
}

export default function CustomerModal({ isOpen, onClose, onSaved, customer }: CustomerModalProps) {
  const isEditing = Boolean(customer);

  const [name, setName] = useState("");
  const [customerType, setCustomerType] = useState<CustomerType>("individual");
  const [phone, setPhone] = useState("");
  const [sameWhatsapp, setSameWhatsapp] = useState(true);
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [assignedSalesId, setAssignedSalesId] = useState("");
  const [dealerId, setDealerId] = useState("");
  const [notes, setNotes] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [designation, setDesignation] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<TagCount[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Dropdowns
  const [salesList, setSalesList] = useState<Array<{ id: number; name: string }>>([]);
  const [dealersList, setDealersList] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    if (!isOpen) return;

    apiJson
      .get<any>("/api/admin/users?role=sales_executive&status=active&pageSize=100")
      .then((res) => {
        const users = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : Array.isArray(res?.data) ? res.data : [];
        setSalesList(
          users.map((u: any) => ({
            id: Number(u.id ?? u._id),
            name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
          }))
        );
      })
      .catch(() => {});

    apiJson
      .get<any>("/api/admin/dealers?status=active&pageSize=100")
      .then((res) => {
        const dList = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : Array.isArray(res?.data) ? res.data : [];
        setDealersList(
          dList.map((d: any) => ({
            id: Number(d.id ?? d._id),
            name: d.companyName || d.name,
          }))
        );
      })
      .catch(() => {});

    apiJson
      .get<{ tags: TagCount[] }>("/api/crm/customer-tags")
      .then((res) => setTagSuggestions(Array.isArray(res?.tags) ? res.tags : []))
      .catch(() => setTagSuggestions([]));

    if (customer) {
      setName(customer.name || "");
      setCompanyName(customer.companyName || "");
      setDesignation(customer.designation || "");
      setTags(Array.isArray(customer.tags) ? customer.tags : []);
      setCustomerType(customer.customerType || "individual");
      setPhone(customer.phone || "");
      setWhatsapp(customer.whatsapp || "");
      setSameWhatsapp(!customer.whatsapp || customer.whatsapp === customer.phone);
      setEmail(customer.email || "");
      setBillingAddress(customer.billingAddress || "");
      setSiteAddress(customer.siteAddress || "");
      setGstNumber(customer.gstNumber || "");
      setAssignedSalesId(customer.assignedSalesId ? String(customer.assignedSalesId) : "");
      setDealerId(customer.dealerId ? String(customer.dealerId) : "");
      const parsedNotes = parseCustomerNotes(customer.notes);
      setNotes(parsedNotes.userNotes || "");
    } else {
      setName("");
      setCompanyName("");
      setDesignation("");
      setTags([]);
      setCustomerType("individual");
      setPhone("");
      setSameWhatsapp(true);
      setWhatsapp("");
      setEmail("");
      setBillingAddress("");
      setSiteAddress("");
      setGstNumber("");
      setAssignedSalesId("");
      setDealerId("");
      setNotes("");
    }
  }, [isOpen, customer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      notify.error("Customer name required", "Please enter the client or company name.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        customerType,
        // Editing sends null for an emptied field so it clears; creating leaves it out.
        companyName: companyName.trim() || (isEditing ? null : undefined),
        designation: designation.trim() || (isEditing ? null : undefined),
        tags: isEditing ? tags : tags.length ? tags : undefined,
        phone: phone.trim() || undefined,
        whatsapp: (sameWhatsapp ? phone.trim() : whatsapp.trim()) || undefined,
        email: email.trim() || undefined,
        billingAddress: billingAddress.trim() || undefined,
        siteAddress: siteAddress.trim() || undefined,
        gstNumber: gstNumber.trim().toUpperCase() || undefined,
        assignedSalesId: assignedSalesId ? Number(assignedSalesId) : undefined,
        dealerId: dealerId ? Number(dealerId) : undefined,
        notes: notes.trim() || undefined,
      };

      if (isEditing && customer) {
        await apiJson.patch(`/api/crm/customers/${customer.id}`, payload);
        notify.success("Customer updated", `${name}'s profile was updated.`);
      } else {
        await apiJson.post("/api/crm/customers", payload);
        notify.success("Customer created", `Customer profile for ${name} created.`);
      }

      onSaved();
      onClose();
    } catch (err) {
      notifyApiError(err, "Failed to save customer");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit Customer — ${customer?.name}` : "New Central Customer"}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Customer / Client Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Architectures or Priya Mehta"
            className="text-sm"
          />

          <Select
            label="Customer Category"
            value={customerType}
            onChange={(e) => setCustomerType(e.target.value as CustomerType)}
            options={Object.entries(CUSTOMER_TYPE_LABELS).map(([val, lbl]) => ({
              value: val,
              label: lbl,
            }))}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Firm / Company"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g. Studio Nine Architects"
            className="text-sm"
          />
          <Input
            label="Designation"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder="e.g. Principal Architect, Site Engineer"
            className="text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              Primary Phone Number
            </label>
            <IndiaPhoneInput
              value={phone}
              onChange={setPhone}
              placeholder="98765 43210"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              WhatsApp Mobile Number
            </label>
            <IndiaPhoneInput
              value={sameWhatsapp ? phone : whatsapp}
              onChange={setWhatsapp}
              disabled={sameWhatsapp}
              placeholder="WhatsApp mobile"
            />
            <label className="mt-1.5 flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
              <input
                type="checkbox"
                checked={sameWhatsapp}
                onChange={(e) => setSameWhatsapp(e.target.checked)}
                className="rounded border-neutral-300 text-accent focus:ring-accent"
              />
              <span>Same as primary phone</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="client@example.com"
            className="text-sm"
          />

          <Input
            label="Customer GSTIN (Optional)"
            value={gstNumber}
            onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
            placeholder="24AAAAA0000A1Z5"
            className="text-sm font-mono uppercase"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Textarea
            label="Site / Delivery Address"
            rows={2}
            value={siteAddress}
            onChange={(e) => setSiteAddress(e.target.value)}
            placeholder="Primary site address..."
            className="text-sm resize-none"
          />

          <Textarea
            label="Billing / Registered Office Address"
            rows={2}
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            placeholder="Billing address for tax invoice..."
            className="text-sm resize-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-neutral-100">
          <Select
            label="Assigned Sales Representative"
            value={assignedSalesId}
            onChange={(e) => setAssignedSalesId(e.target.value)}
            options={[
              { value: "", label: "— Unassigned —" },
              ...salesList.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
          />

          <Select
            label="Assigned Dealer"
            value={dealerId}
            onChange={(e) => setDealerId(e.target.value)}
            options={[
              { value: "", label: "— Direct Company Client (No Dealer) —" },
              ...dealersList.map((d) => ({ value: String(d.id), label: d.name })),
            ]}
          />
        </div>

        <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} />

        {customer && parseCustomerNotes(customer.notes).migrationInfo && (
          <p className="text-[11px] text-neutral-500 bg-neutral-50 border border-neutral-200/70 rounded-lg px-2.5 py-1.5">
            ℹ️ Auto-linked to historical proposal: <span className="font-semibold text-neutral-700">{parseCustomerNotes(customer.notes).migrationInfo?.quotationNumbers.join(", ")}</span>
          </p>
        )}

        <Textarea
          label="Internal Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Customer preferences, key architect links, commercial terms..."
          className="text-sm resize-none"
        />

        <div className="flex justify-end gap-2 pt-3 border-t border-neutral-100">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {isEditing ? "Save Changes" : "Create Customer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
