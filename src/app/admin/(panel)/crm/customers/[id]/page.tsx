"use client";

import { useState, useEffect, useCallback, useMemo, useRef, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Clock, FileText, LayoutDashboard, TrendingUp } from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import type { CustomerProfile, Lead } from "@/types/crm";
import { ACTIVITY_FILTERS, computeCustomerStats, filterActivities, type ActivityFilterId } from "@/lib/crmCustomerInsights";
import CustomerModal from "@/components/admin/crm/CustomerModal";
import ActivityTimeline from "@/components/admin/crm/ActivityTimeline";
import LeadDetailDrawer from "@/components/admin/crm/LeadDetailDrawer";
import LeadModal from "@/components/admin/crm/LeadModal";
import ProfileHeader from "@/components/admin/crm/customer/ProfileHeader";
import OverviewTab from "@/components/admin/crm/customer/OverviewTab";
import QuotationsTab from "@/components/admin/crm/customer/QuotationsTab";
import LeadsTab, { ReferredLeads } from "@/components/admin/crm/customer/LeadsTab";
import { useConfirm } from "@/components/providers/ConfirmProvider";

type TabId = "overview" | "quotations" | "leads" | "timeline";
const TAB_IDS: TabId[] = ["overview", "quotations", "leads", "timeline"];

function ProfileSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading customer" data-testid="profile-skeleton">
      <div className="h-4 w-32 animate-pulse rounded bg-neutral-200" />
      <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-white">
        <div className="h-28 animate-pulse bg-neutral-200" />
        <div className="space-y-4 px-8 pb-8">
          <div className="-mt-12 h-24 w-24 animate-pulse rounded-3xl bg-neutral-300 ring-4 ring-white" />
          <div className="h-7 w-64 animate-pulse rounded bg-neutral-200" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-neutral-100" />
            ))}
          </div>
        </div>
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-neutral-100" />
    </div>
  );
}

export default function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const confirm = useConfirm();

  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [activityFilter, setActivityFilter] = useState<ActivityFilterId>("all");

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [enquiryModalOpen, setEnquiryModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const hasLoaded = useRef(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // The open tab lives in the address (?tab=leads), so a reload or a shared link lands on the same tab.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab && (TAB_IDS as string[]).includes(tab)) setActiveTab(tab as TabId);
  }, []);
  const selectTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  }, []);

  // Only the first load shows the skeleton; later refreshes (after logging an activity, editing...) update in place.
  const fetchProfile = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    try {
      const res = await apiJson.get<CustomerProfile>(`/api/crm/customers/${resolvedParams.id}`);
      if (res) setCustomer(res);
    } catch (err) {
      if (!hasLoaded.current) notifyApiError(err, "Failed to load customer profile");
      else notifyApiError(err, "Could not refresh the profile");
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [resolvedParams.id]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const openLead = async (leadId: string) => {
    try {
      const lead = await apiJson.get<Lead>(`/api/crm/leads/${leadId}`);
      if (lead) setSelectedLead(lead);
    } catch (err) {
      notifyApiError(err, "Failed to load enquiry details");
    }
  };

  const handleArchive = async () => {
    if (!customer) return;
    const ok = await confirm({
      title: "Archive customer",
      message: `Are you sure you want to archive "${customer.name}"? Quotations and lead records will remain safely intact in historical state.`,
      confirmText: "Archive customer",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiJson.delete(`/api/crm/customers/${customer.id}`);
      notify.success("Customer archived", `"${customer.name}" has been safely archived.`);
      router.push("/admin/crm/customers");
    } catch (err) {
      notifyApiError(err, "Failed to archive customer");
    }
  };

  const stats = useMemo(() => (customer ? computeCustomerStats(customer) : null), [customer]);
  const activities = useMemo(() => filterActivities(customer?.activities ?? [], activityFilter), [customer?.activities, activityFilter]);

  if (loading && !customer) return <ProfileSkeleton />;

  if (!customer || !stats) {
    return (
      <div className="m-6 rounded-2xl border border-neutral-200 bg-white p-10 text-center" data-testid="customer-not-found">
        <AlertCircle size={40} className="mx-auto mb-3 text-neutral-400" aria-hidden="true" />
        <h1 className="text-lg font-bold text-neutral-900">Customer not found</h1>
        <p className="mb-5 mt-1 text-sm text-neutral-500">The requested customer profile does not exist or you do not have permission to view it.</p>
        <Link href="/admin/crm/customers" className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to customers
        </Link>
      </div>
    );
  }

  const newQuotationUrl = `/quotation/new?customerId=${customer.id}&clientName=${encodeURIComponent(customer.name)}&clientPhone=${encodeURIComponent(customer.phone || "")}&clientEmail=${encodeURIComponent(customer.email || "")}&location=${encodeURIComponent(customer.siteAddress || customer.billingAddress || "")}`;

  const tabs: Array<{ id: TabId; label: string; icon: typeof FileText; count?: number }> = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "quotations", label: "Quotations", icon: FileText, count: stats.quotationCount },
    { id: "leads", label: "Enquiries", icon: TrendingUp, count: stats.leadCount },
    { id: "timeline", label: "Activity", icon: Clock, count: customer.activities?.length ?? 0 },
  ];

  const onTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  };

  return (
    <div className="space-y-6 pb-12">
      <ProfileHeader customer={customer} stats={stats} newQuotationUrl={newQuotationUrl} onEdit={() => setEditModalOpen(true)} onArchive={() => void handleArchive()} onNewEnquiry={() => setEnquiryModalOpen(true)} />

      <div className="-mx-1 overflow-x-auto px-1">
        <div role="tablist" aria-label="Customer sections" className="flex min-w-max gap-1 border-b border-neutral-200">
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[tab.id] = node;
                }}
                role="tab"
                type="button"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                data-testid={`tab-${tab.id}`}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 pb-3 pt-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  selected ? "border-neutral-950 text-neutral-950" : "border-transparent text-neutral-500 hover:text-neutral-800"
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {tab.label}
                {tab.count !== undefined && <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", selected ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700")}>{tab.count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0} className="focus-visible:outline-none">
        {activeTab === "overview" && <OverviewTab customer={customer} onShowTab={selectTab} onEdit={() => setEditModalOpen(true)} />}

        {activeTab === "quotations" && <QuotationsTab quotations={customer.quotations ?? []} statusCounts={stats.statusCounts} newQuotationUrl={newQuotationUrl} />}

        {activeTab === "leads" && (
          <>
            <LeadsTab leads={customer.leads ?? []} onOpen={(id) => void openLead(id)} onNewEnquiry={() => setEnquiryModalOpen(true)} />
            <ReferredLeads leads={customer.referredLeads ?? []} onOpen={(id) => void openLead(id)} />
          </>
        )}

        {activeTab === "timeline" && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-xs sm:p-6" data-testid="timeline-tab">
            <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter activity">
              {ACTIVITY_FILTERS.map((filter) => {
                const active = activityFilter === filter.id;
                const count = filterActivities(customer.activities ?? [], filter.id).length;
                if (filter.id !== "all" && count === 0 && !active) return null;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setActivityFilter(filter.id)}
                    aria-pressed={active}
                    data-testid={`activity-filter-${filter.id}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                    )}
                  >
                    {filter.label}
                    <span className={cn("rounded-full px-1.5 text-[10px]", active ? "bg-white/20" : "bg-neutral-100 text-neutral-600")}>{count}</span>
                  </button>
                );
              })}
            </div>
            <ActivityTimeline activities={activities} customerId={customer.id} onActivityAdded={() => void fetchProfile()} />
          </div>
        )}
      </div>

      <CustomerModal isOpen={editModalOpen} customer={customer} onClose={() => setEditModalOpen(false)} onSaved={() => void fetchProfile()} />
      <LeadModal isOpen={enquiryModalOpen} customer={customer} onClose={() => setEnquiryModalOpen(false)} onSaved={() => void fetchProfile()} />
      <LeadDetailDrawer lead={selectedLead} isOpen={Boolean(selectedLead)} onClose={() => setSelectedLead(null)} onLeadUpdated={() => void fetchProfile()} />
    </div>
  );
}
