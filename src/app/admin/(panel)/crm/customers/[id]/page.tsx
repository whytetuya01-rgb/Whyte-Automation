"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Contact,
  ArrowLeft,
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Building,
  FileText,
  User,
  Plus,
  ExternalLink,
  Edit2,
  Calendar,
} from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Button } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { Customer, Quotation, Lead, CrmActivity } from "@/types/crm";
import { CUSTOMER_TYPE_LABELS, LEAD_STATUS_CONFIG } from "@/types/crm";
import ActivityTimeline from "@/components/admin/crm/ActivityTimeline";
import CustomerModal from "@/components/admin/crm/CustomerModal";
import { normalizeWhatsAppNumber } from "@/lib/quotationDeliveryShared";

export default function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [customer, setCustomer] = useState<
    (Customer & { quotations?: Quotation[]; leads?: Lead[]; activities?: CrmActivity[] }) | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchCustomer = async () => {
    setLoading(true);
    try {
      const res = await apiJson.get<
        Customer & { quotations?: Quotation[]; leads?: Lead[]; activities?: CrmActivity[] }
      >(`/api/crm/customers/${id}`);
      if (res) {
        setCustomer(res);
      }
    } catch (err) {
      notifyApiError(err, "Failed to load customer profile");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomer();
  }, [id]);

  if (loading) {
    return (
      <div className="py-24 flex justify-center items-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="py-20 text-center space-y-3">
        <h3 className="text-base font-bold text-neutral-900">Customer not found</h3>
        <Link href="/admin/crm/customers" className="text-xs font-semibold text-accent hover:underline">
          Return to Customer Directory
        </Link>
      </div>
    );
  }

  const handleOpenWhatsApp = () => {
    const rawNumber = customer.whatsapp || customer.phone;
    if (!rawNumber) {
      notify.error("No phone number", "This customer has no phone or WhatsApp number.");
      return;
    }
    const clean = normalizeWhatsAppNumber(rawNumber);
    if (!clean) return;
    window.open(`https://api.whatsapp.com/send?phone=${clean}`, "_blank");
  };

  return (
    <div className="space-y-5">
      {/* Back button */}
      <div>
        <Link
          href="/admin/crm/customers"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition"
        >
          <ArrowLeft size={14} />
          <span>Back to Customers</span>
        </Link>
      </div>

      <PageHeader
        title={customer.name}
        subtitle={`${CUSTOMER_TYPE_LABELS[customer.customerType] || customer.customerType} • Client Profile & History`}
        icon={Contact}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(true)}>
              <Edit2 size={13} className="mr-1.5" />
              <span>Edit Profile</span>
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => router.push(`/quotation/new`)}
            >
              <Plus size={14} className="mr-1" />
              <span>New Quotation</span>
            </Button>
          </div>
        }
      />

      {/* Profile Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Contact Info Card */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-2xs space-y-3 text-xs">
          <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-[11px] pb-2 border-b border-neutral-100">
            Contact Details
          </h4>
          {customer.phone && (
            <div className="flex items-center justify-between text-neutral-600">
              <span className="flex items-center gap-1.5">
                <Phone size={13} className="text-neutral-400" /> Phone:
              </span>
              <a href={`tel:${customer.phone}`} className="font-semibold text-neutral-900 hover:underline">
                {customer.phone}
              </a>
            </div>
          )}
          {(customer.whatsapp || customer.phone) && (
            <div className="flex items-center justify-between text-neutral-600">
              <span className="flex items-center gap-1.5">
                <MessageCircle size={13} className="text-green-600" /> WhatsApp:
              </span>
              <button
                type="button"
                onClick={handleOpenWhatsApp}
                className="font-semibold text-green-700 hover:underline cursor-pointer"
              >
                Chat on WhatsApp
              </button>
            </div>
          )}
          {customer.email && (
            <div className="flex items-center justify-between text-neutral-600">
              <span className="flex items-center gap-1.5">
                <Mail size={13} className="text-neutral-400" /> Email:
              </span>
              <a href={`mailto:${customer.email}`} className="font-semibold text-neutral-900 hover:underline truncate max-w-[150px]">
                {customer.email}
              </a>
            </div>
          )}
          {customer.gstNumber && (
            <div className="flex items-center justify-between text-neutral-600">
              <span className="flex items-center gap-1.5">
                <Building size={13} className="text-neutral-400" /> GSTIN:
              </span>
              <span className="font-mono font-bold text-neutral-900">{customer.gstNumber}</span>
            </div>
          )}
        </div>

        {/* Addresses Card */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-2xs space-y-3 text-xs">
          <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-[11px] pb-2 border-b border-neutral-100">
            Addresses
          </h4>
          <div>
            <span className="font-semibold text-neutral-400 text-[10px] uppercase block">
              Site / Project Location
            </span>
            <p className="text-neutral-800 mt-0.5 leading-relaxed">
              {customer.siteAddress || "Not specified"}
            </p>
          </div>
          <div className="pt-2 border-t border-neutral-100">
            <span className="font-semibold text-neutral-400 text-[10px] uppercase block">
              Billing Address
            </span>
            <p className="text-neutral-800 mt-0.5 leading-relaxed">
              {customer.billingAddress || "Same as site location"}
            </p>
          </div>
        </div>

        {/* Relationship & Assignment Card */}
        <div className="p-4 bg-white rounded-2xl border border-neutral-200 shadow-2xs space-y-3 text-xs">
          <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-[11px] pb-2 border-b border-neutral-100">
            Account Management
          </h4>
          <div className="flex items-center justify-between text-neutral-600">
            <span>Sales Representative:</span>
            <strong className="text-neutral-900">
              {customer.assignedSales?.name || "Unassigned"}
            </strong>
          </div>
          <div className="flex items-center justify-between text-neutral-600">
            <span>Assigned Dealer:</span>
            <strong className="text-neutral-900">
              {customer.dealer?.companyName || customer.dealer?.name || "Direct Company"}
            </strong>
          </div>
          <div className="flex items-center justify-between text-neutral-600">
            <span>Customer Since:</span>
            <strong className="text-neutral-900">
              {new Date(customer.createdAt).toLocaleDateString("en-IN")}
            </strong>
          </div>
        </div>
      </div>

      {/* Quotations & Leads History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Quotations List */}
        <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
            <h4 className="font-bold text-neutral-900 text-sm flex items-center gap-2">
              <FileText size={16} className="text-accent" />
              <span>Quotations ({customer.quotations?.length ?? 0})</span>
            </h4>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push(`/quotation/new`)}
            >
              <Plus size={13} className="mr-1" /> New
            </Button>
          </div>

          {!customer.quotations || customer.quotations.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-400 bg-neutral-50/50 rounded-xl border border-dashed border-neutral-200">
              No quotations created for this customer yet.
            </div>
          ) : (
            <div className="space-y-2">
              {customer.quotations.map((q) => (
                <Link
                  key={q.id}
                  href={`/quotation/${q.id}`}
                  className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50/60 transition group text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-neutral-900 group-hover:text-accent transition">
                      {q.quotationNumber}
                    </span>
                    <div className="text-[11px] text-neutral-400 mt-0.5">
                      {new Date(q.createdAt).toLocaleDateString("en-IN")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="capitalize font-semibold text-[11px] px-2 py-0.5 rounded bg-neutral-100 text-neutral-700">
                      {q.status}
                    </span>
                    <ExternalLink size={13} className="text-neutral-400 group-hover:text-accent" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Leads History */}
        <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
            <h4 className="font-bold text-neutral-900 text-sm flex items-center gap-2">
              <Contact size={16} className="text-accent" />
              <span>Project Leads ({customer.leads?.length ?? 0})</span>
            </h4>
          </div>

          {!customer.leads || customer.leads.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-400 bg-neutral-50/50 rounded-xl border border-dashed border-neutral-200">
              No previous inquiries or leads recorded.
            </div>
          ) : (
            <div className="space-y-2">
              {customer.leads.map((l) => {
                const st = LEAD_STATUS_CONFIG[l.status] || LEAD_STATUS_CONFIG.new;
                return (
                  <div
                    key={l.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 bg-neutral-50/40 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-accent">{l.referenceNumber}</span>
                      <div className="text-[11px] text-neutral-600 font-medium mt-0.5">
                        {l.projectType || "General Inquiry"}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${st.bg} ${st.text} ${st.border}`}>
                      {st.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-2xs">
        <ActivityTimeline
          activities={customer.activities || []}
          customerId={customer.id}
          onActivityAdded={fetchCustomer}
        />
      </div>

      <CustomerModal
        isOpen={modalOpen}
        customer={customer}
        onClose={() => setModalOpen(false)}
        onSaved={fetchCustomer}
      />
    </div>
  );
}
