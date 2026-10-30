"use client";

import { useState, useEffect } from "react";
import Modal from "@/components/shared/Modal";
import { Button, Input, Select, Textarea } from "@/components/ui";
import IndiaPhoneInput from "@/components/ui/IndiaPhoneInput";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { Lead, LeadPriority, LeadSource, LeadStatus } from "@/types/crm";

interface LeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  lead?: Lead | null;
}

export default function LeadModal({ isOpen, onClose, onSaved, lead }: LeadModalProps) {
  const isEditing = Boolean(lead);

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [sameWhatsapp, setSameWhatsapp] = useState(true);
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [location, setLocation] = useState("");
  const [projectType, setProjectType] = useState("");
  const [estimatedBudget, setEstimatedBudget] = useState("");
  const [expectedClosingDate, setExpectedClosingDate] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [priority, setPriority] = useState<LeadPriority>("medium");
  const [status, setStatus] = useState<LeadStatus>("new");
  const [assignedSalesId, setAssignedSalesId] = useState("");
  const [dealerId, setDealerId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Dynamic dropdown options
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [salesList, setSalesList] = useState<Array<{ id: number; name: string }>>([]);
  const [dealersList, setDealersList] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    if (!isOpen) return;

    // Load initial dropdown data
    apiJson
      .get<LeadSource[]>("/api/crm/sources")
      .then((res) => {
        if (Array.isArray(res)) setSources(res.filter((s) => s.isActive));
      })
      .catch(() => {});

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

    // Populate editing lead data
    if (lead) {
      setCustomerName(lead.customerName || "");
      setPhone(lead.phone || "");
      setWhatsapp(lead.whatsapp || "");
      setSameWhatsapp(!lead.whatsapp || lead.whatsapp === lead.phone);
      setEmail(lead.email || "");
      setSiteAddress(lead.siteAddress || "");
      setLocation(lead.location || "");
      setProjectType(lead.projectType || "");
      setEstimatedBudget(lead.estimatedBudget ? String(lead.estimatedBudget) : "");
      setExpectedClosingDate(lead.expectedClosingDate ? lead.expectedClosingDate.split("T")[0] : "");
      setSourceId(lead.sourceId || "");
      setPriority(lead.priority || "medium");
      setStatus(lead.status || "new");
      setAssignedSalesId(lead.assignedSalesId ? String(lead.assignedSalesId) : "");
      setDealerId(lead.dealerId ? String(lead.dealerId) : "");
      setNotes(lead.notes || "");
    } else {
      // Defaults for new lead
      setCustomerName("");
      setPhone("");
      setSameWhatsapp(true);
      setWhatsapp("");
      setEmail("");
      setSiteAddress("");
      setLocation("");
      setProjectType("");
      setEstimatedBudget("");
      setExpectedClosingDate("");
      setSourceId("");
      setPriority("medium");
      setStatus("new");
      setAssignedSalesId("");
      setDealerId("");
      setNotes("");
    }
  }, [isOpen, lead]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      notify.error("Customer name required", "Please enter the customer or project contact name.");
      return;
    }

    setSubmitting(true);
    try {
      const selectedSource = sources.find((s) => s.id === sourceId);
      const payload = {
        customerName: customerName.trim(),
        phone: phone.trim() || undefined,
        whatsapp: (sameWhatsapp ? phone.trim() : whatsapp.trim()) || undefined,
        email: email.trim() || undefined,
        siteAddress: siteAddress.trim() || undefined,
        location: location.trim() || undefined,
        projectType: projectType.trim() || undefined,
        estimatedBudget: estimatedBudget ? Number(estimatedBudget) : undefined,
        expectedClosingDate: expectedClosingDate || undefined,
        sourceId: sourceId || undefined,
        sourceName: selectedSource?.name || undefined,
        priority,
        status,
        assignedSalesId: assignedSalesId ? Number(assignedSalesId) : undefined,
        dealerId: dealerId ? Number(dealerId) : undefined,
        notes: notes.trim() || undefined,
      };

      if (isEditing && lead) {
        await apiJson.patch(`/api/crm/leads/${lead.id}`, payload);
        notify.success("Lead updated", `${customerName}'s lead updated.`);
      } else {
        await apiJson.post("/api/crm/leads", payload);
        notify.success("Lead created", `New lead for ${customerName} added.`);
      }

      onSaved();
      onClose();
    } catch (err) {
      notifyApiError(err, "Failed to save lead");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit Lead — ${lead?.referenceNumber}` : "New CRM Lead"}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Customer Information */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
            Customer Information
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Customer / Client Name"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Rajesh Singhania"
              className="text-sm"
            />
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
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
                WhatsApp Number
              </label>
              <IndiaPhoneInput
                value={sameWhatsapp ? phone : whatsapp}
                onChange={setWhatsapp}
                disabled={sameWhatsapp}
                placeholder="WhatsApp mobile number"
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
        </div>

        {/* Project & Site Details */}
        <div className="space-y-3 pt-2 border-t border-neutral-100">
          <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
            Project & Site Scope
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Project Type"
              value={projectType}
              onChange={(e) => setProjectType(e.target.value)}
              placeholder="e.g. 4 BHK Villa, Duplex, Luxury Penthouse"
              className="text-sm"
            />
            <Input
              label="City / Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Bodakdev, Ahmedabad"
              className="text-sm"
            />
          </div>

          <Textarea
            label="Site Address"
            rows={2}
            value={siteAddress}
            onChange={(e) => setSiteAddress(e.target.value)}
            placeholder="Full site location or landmark address..."
            className="text-sm resize-none"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Estimated Budget (₹)"
              type="number"
              min="0"
              value={estimatedBudget}
              onChange={(e) => setEstimatedBudget(e.target.value)}
              placeholder="e.g. 500000"
              className="text-sm"
            />
            <Input
              label="Expected Closing Date"
              type="date"
              value={expectedClosingDate}
              onChange={(e) => setExpectedClosingDate(e.target.value)}
              className="text-sm"
            />
          </div>
        </div>

        {/* Source & Sales Assignment */}
        <div className="space-y-3 pt-2 border-t border-neutral-100">
          <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
            Source & Sales Assignment
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Lead Source"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              options={[
                { value: "", label: "— Select lead source —" },
                ...sources.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />

            <Select
              label="Priority Level"
              value={priority}
              onChange={(e) => setPriority(e.target.value as LeadPriority)}
              options={[
                { value: "low", label: "Low Priority" },
                { value: "medium", label: "Medium Priority" },
                { value: "high", label: "High Priority" },
                { value: "urgent", label: "Urgent Priority" },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                { value: "", label: "— Direct Company Lead (No Dealer) —" },
                ...dealersList.map((d) => ({ value: String(d.id), label: d.name })),
              ]}
            />
          </div>

          <Textarea
            label="Client Requirements & Internal Notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Automation requirements, preferred series, timeline notes..."
            className="text-sm resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-neutral-100">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {isEditing ? "Save Changes" : "Create Lead"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
