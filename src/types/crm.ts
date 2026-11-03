import type { AdminUser, Quotation, PaginatedResponse } from "@/types";
export type { AdminUser, Quotation, PaginatedResponse };

export type LeadStatus = "new" | "contacted" | "site_visit" | "quoted" | "negotiation" | "won" | "lost";
export type LeadPriority = "low" | "medium" | "high" | "urgent";

export const LEAD_STATUS_CONFIG: Record<
  LeadStatus,
  { label: string; bg: string; text: string; border: string; step: number }
> = {
  new: { label: "New Lead", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", step: 1 },
  contacted: { label: "Contacted", bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", step: 2 },
  site_visit: { label: "Site Visit", bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", step: 3 },
  quoted: { label: "Quoted", bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200", step: 4 },
  negotiation: { label: "Negotiation", bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200", step: 5 },
  won: { label: "Won", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", step: 6 },
  lost: { label: "Lost", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", step: 6 },
};

export const LEAD_PRIORITY_CONFIG: Record<
  LeadPriority,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  low: { label: "Low", bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200", dot: "bg-slate-400" },
  medium: { label: "Medium", bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", dot: "bg-sky-500" },
  high: { label: "High", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
  urgent: { label: "Urgent", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-500" },
};

export type CustomerType =
  | "individual"
  | "architect"
  | "builder"
  | "interior_designer"
  | "contractor"
  | "commercial"
  | "other";

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  individual: "Individual Homeowner",
  architect: "Architect",
  builder: "Builder / Developer",
  interior_designer: "Interior Designer",
  contractor: "Electrical Contractor",
  commercial: "Commercial Client",
  other: "Other",
};

export type CrmActivityType =
  | "call"
  | "whatsapp"
  | "email"
  | "site_visit"
  | "meeting"
  | "quotation_sent"
  | "quotation_viewed"
  | "follow_up"
  | "note"
  | "status_change";

export interface LeadSource {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Customer {
  id: number;
  companyId: number;
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  billingAddress?: string | null;
  siteAddress?: string | null;
  gstNumber?: string | null;
  customerType: CustomerType;
  assignedSalesId?: number | null;
  assignedSales?: AdminUser | null;
  dealerId?: number | null;
  dealer?: AdminUser | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: number;
  // Computed / aggregated
  quotationsCount?: number;
  leadsCount?: number;
}

export interface CustomerProfile extends Customer {
  quotations: Array<{
    id: string;
    quotationNumber: string;
    clientName: string;
    status: string;
    grandTotal: number;
    createdAt: string;
  }>;
  leads: Array<{
    id: string;
    referenceNumber: string;
    projectType?: string | null;
    estimatedBudget?: number | null;
    status: LeadStatus;
    priority: LeadPriority;
    createdAt: string;
    nextFollowUpAt?: string | null;
    expectedClosingDate?: string | null;
    lostReason?: string | null;
  }>;
  activities: CrmActivity[];
}

export interface Lead {
  id: string;
  referenceNumber: string; // e.g. "LD-2026-0001"
  companyId: number;
  customerId?: number | null;
  customer?: Customer | null;
  customerName: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  siteAddress?: string | null;
  location?: string | null;
  projectType?: string | null; // e.g. "4 BHK Villa", "Duplex", "Commercial Penthouse"
  estimatedBudget?: number | null;
  expectedClosingDate?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  assignedSalesId?: number | null;
  assignedSales?: AdminUser | null;
  dealerId?: number | null;
  dealer?: AdminUser | null;
  description?: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  notes?: string | null;
  tags?: string[];
  lastContactedAt?: string | null;
  nextFollowUpAt?: string | null;
  convertedQuotationId?: string | null;
  convertedQuotation?: Quotation | null;
  wonAt?: string | null;
  lostAt?: string | null;
  lostReason?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: number;
  createdByName?: string | null;
  // Computed
  isHotLead?: boolean;
  quotationViewCount?: number;
  activities?: CrmActivity[];
}

export interface CrmActivity {
  id: string;
  companyId: number;
  leadId?: string | null;
  customerId?: number | null;
  quotationId?: string | null;
  type: CrmActivityType;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  performedBy: number;
  performedByName: string | null;
  performedAt: string;
}

export type PipelineStageId =
  | "new"
  | "contacted"
  | "site_visit"
  | "quoted"
  | "negotiation"
  | "won"
  | "lost";

export interface OpportunityCard {
  id: string;
  leadId: string;
  referenceNumber: string;
  customerName: string;
  phone?: string | null;
  projectType?: string | null;
  stage: PipelineStageId;
  priority: LeadPriority;
  estimatedValue: number;
  quotationId?: string | null;
  quotationNumber?: string | null;
  quotationStatus?: string | null;
  quotationGrandTotal?: number | null;
  assignedSalesName?: string | null;
  dealerName?: string | null;
  nextFollowUpAt?: string | null;
  expectedClosingDate?: string | null;
  daysInStage: number;
  createdAt: string;
  isHotLead?: boolean;
  quotationViewCount?: number;
  tags?: string[];
}

export interface PipelineStageData {
  id: PipelineStageId;
  name: string;
  color: string;
  count: number;
  totalValue: number;
  items: OpportunityCard[];
}
