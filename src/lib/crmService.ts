import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import {
  AdminUser,
  CrmActivity,
  Customer,
  Lead,
  LeadSource,
  INITIAL_LEAD_SOURCES,
  Quotation,
  QuotationDelivery,
  QuotationItem,
  QuotationRoom,
} from "@/models";
import { getNextSequence, getNextLeadSequence } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { ApiError } from "@/lib/api-response";
import { aggregateQuotationRoomTotals, deriveQuotationFinancials, totalsForQuotation } from "@/lib/quotationTotals";
import type {
  CrmActivityType,
  CustomerType,
  OpportunityCard,
  PipelineStageData,
  PipelineStageId,
} from "@/types/crm";

export interface UserContext {
  role: string;
  userId: number;
  permissions?: string[];
  companyId?: number | null;
}

/**
 * Returns role-based visibility filter for CRM records (leads, customers, pipeline).
 * Matches the existing pattern from src/lib/quotationAccess.ts.
 */
export function crmVisibilityFilter(ctx: { role: string; userId: number }): Record<string, unknown> {
  const { role, userId } = ctx;
  if (role === "super_admin" || role === "admin" || role === "company_owner") {
    return {};
  }
  if (role === "sales_executive") {
    return {
      $or: [{ assignedSalesId: userId }, { createdBy: userId }],
    };
  }
  if (role === "dealer") {
    return { dealerId: userId };
  }
  return {};
}

/**
 * Ensures default lead sources exist for a company.
 * Called automatically when fetching or initializing lead sources.
 */
export async function ensureCompanyLeadSources(companyId: number): Promise<void> {
  await connectMongoDB();
  const count = await LeadSource.countDocuments({ companyId });
  if (count > 0) return;

  const docs = INITIAL_LEAD_SOURCES.map((name, idx) => ({
    _id: `src_${companyId}_${idx + 1}_${Date.now().toString(36)}`,
    companyId,
    name,
    isDefault: true,
    isActive: true,
    sortOrder: idx + 1,
  }));

  try {
    await LeadSource.insertMany(docs, { ordered: false });
  } catch {
    // ignore duplicate key errors on concurrent initialization
  }
}

/**
 * Records an activity event in the CRM chronological timeline.
 */
export async function recordCrmActivity(params: {
  companyId: number;
  leadId?: string | null;
  customerId?: number | null;
  quotationId?: string | null;
  type: CrmActivityType;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  performedBy: number;
  performedByName?: string | null;
}): Promise<void> {
  await connectMongoDB();

  let actorName = params.performedByName ?? null;
  if (!actorName && params.performedBy) {
    const actor = await AdminUser.findById(params.performedBy).select("name firstName lastName email").lean();
    if (actor) {
      actorName = actor.name || `${actor.firstName || ""} ${actor.lastName || ""}`.trim() || actor.email;
    }
  }

  const activityId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await CrmActivity.create({
    _id: activityId,
    companyId: params.companyId,
    leadId: params.leadId ?? null,
    customerId: params.customerId ?? null,
    quotationId: params.quotationId ?? null,
    type: params.type,
    title: params.title,
    description: params.description ?? null,
    metadata: params.metadata ?? null,
    performedBy: params.performedBy,
    performedByName: actorName,
    performedAt: new Date(),
  });
}

/**
 * Creates or matches a central Customer record for a lead conversion or quotation.
 * Safe matching: only matches if EXACT mobile phone or email already exists in company.
 * Never creates duplicate records unnecessarily.
 */
export async function resolveOrCreateCustomer(params: {
  companyId: number;
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  billingAddress?: string | null;
  siteAddress?: string | null;
  gstNumber?: string | null;
  customerType?: CustomerType;
  assignedSalesId?: number | null;
  dealerId?: number | null;
  userId: number;
}): Promise<number> {
  await connectMongoDB();

  const phone = params.phone?.trim() || null;
  const email = params.email?.trim().toLowerCase() || null;

  // Try finding existing customer by phone or email
  const matchCriteria: Array<Record<string, unknown>> = [];
  if (phone) matchCriteria.push({ phone });
  if (email) matchCriteria.push({ email });

  if (matchCriteria.length > 0) {
    const existing = await Customer.findOne({
      companyId: params.companyId,
      $or: matchCriteria,
    }).select("_id").lean();

    if (existing) {
      return existing._id;
    }
  }

  // Create new customer with sequential integer id
  const nextId = await getNextSequence("customer", Customer);
  const created = await Customer.create({
    _id: nextId,
    companyId: params.companyId,
    name: params.name.trim(),
    phone,
    whatsapp: params.whatsapp?.trim() || phone,
    email,
    billingAddress: params.billingAddress?.trim() || null,
    siteAddress: params.siteAddress?.trim() || null,
    gstNumber: params.gstNumber?.trim().toUpperCase() || null,
    customerType: params.customerType || "individual",
    assignedSalesId: params.assignedSalesId ?? null,
    dealerId: params.dealerId ?? null,
    createdBy: params.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return created._id;
}

/**
 * Pipeline stages configuration
 */
export const PIPELINE_STAGES: Array<{ id: PipelineStageId; name: string; color: string }> = [
  { id: "new", name: "New Lead", color: "#3B82F6" },
  { id: "contacted", name: "Contacted", color: "#6366F1" },
  { id: "site_visit", name: "Site Visit", color: "#A855F7" },
  { id: "quoted", name: "Proposal Sent", color: "#F59E0B" },
  { id: "negotiation", name: "Negotiation", color: "#EC4899" },
  { id: "won", name: "Closed Won", color: "#10B981" },
  { id: "lost", name: "Closed Lost", color: "#EF4444" },
];

/**
 * Loads aggregated Pipeline Board data.
 * Adheres strictly to the requirement: Where linked to a quotation, reuse existing
 * quotation financial calculations (totalsForQuotation). Never reinvent quotation totals.
 */
export async function getPipelineBoardData(
  companyId: number,
  userCtx: { role: string; userId: number },
  filters?: { search?: string; assignedSalesId?: number | null; dealerId?: number | null }
): Promise<PipelineStageData[]> {
  await connectMongoDB();

  const visibility = crmVisibilityFilter(userCtx);
  const query: Record<string, unknown> = {
    companyId,
    ...visibility,
  };

  if (filters?.assignedSalesId) {
    query.assignedSalesId = filters.assignedSalesId;
  }
  if (filters?.dealerId) {
    query.dealerId = filters.dealerId;
  }
  if (filters?.search && filters.search.trim()) {
    const rx = new RegExp(filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ customerName: rx }, { referenceNumber: rx }, { phone: rx }, { projectType: rx }];
  }

  const leads = await Lead.find(query)
    .populate({ path: "assignedSales", select: "name firstName lastName email" })
    .populate({ path: "dealer", select: "name firstName lastName companyName" })
    .sort({ createdAt: -1 })
    .lean();

  // Find all converted/linked quotations
  const quotationIds = leads
    .map((l) => l.convertedQuotationId)
    .filter((id): id is string => Boolean(id));

  const quotationTotalsMap = new Map<string, { grandTotal: number; quotationNumber: string; status: string }>();

  if (quotationIds.length > 0) {
    const quotations = await Quotation.find({ _id: { $in: quotationIds } })
      .select("_id quotationNumber status discountType discountValue customerDiscountPercent allocatedDiscountPercent")
      .lean();

    const aggregatedTotals = await aggregateQuotationRoomTotals(quotationIds);

    for (const q of quotations) {
      const qId = String(q._id);
      const { subtotal } = totalsForQuotation(aggregatedTotals, qId);
      const financials = deriveQuotationFinancials({
        subtotal,
        discountType: q.discountType as string | null | undefined,
        discountValue: q.discountValue,
        customerDiscountPercent: q.customerDiscountPercent,
        allocatedDiscountPercent: q.allocatedDiscountPercent,
      });
      quotationTotalsMap.set(qId, {
        grandTotal: financials.grandTotal,
        quotationNumber: q.quotationNumber,
        status: q.status,
      });
    }
  }

  // Delivery view count lookup to flag hot leads
  const quotationDeliveries = quotationIds.length > 0
    ? await QuotationDelivery.find({ quotationId: { $in: quotationIds } })
        .select("quotationId viewCount lastViewedAt")
        .lean()
    : [];

  const viewCountMap = new Map<string, number>();
  for (const d of quotationDeliveries) {
    const current = viewCountMap.get(d.quotationId) || 0;
    viewCountMap.set(d.quotationId, current + (d.viewCount || 0));
  }

  const now = Date.now();

  // Group leads into stages
  const stageMap = new Map<PipelineStageId, OpportunityCard[]>();
  for (const stage of PIPELINE_STAGES) {
    stageMap.set(stage.id, []);
  }

  for (const lead of leads) {
    let stageId: PipelineStageId = "new";
    if (lead.status === "won") stageId = "won";
    else if (lead.status === "lost") stageId = "lost";
    else if (lead.status === "site_visit") stageId = "site_visit";
    else if (lead.status === "contacted") stageId = "contacted";
    else if (lead.status === "quoted") {
      stageId = lead.notes?.toLowerCase().includes("negotiat") ? "negotiation" : "quoted";
    }

    const linkedQ = lead.convertedQuotationId ? quotationTotalsMap.get(lead.convertedQuotationId) : null;
    const viewCount = lead.convertedQuotationId ? (viewCountMap.get(lead.convertedQuotationId) || 0) : 0;
    const isHotLead = viewCount >= 2;

    const estimatedValue = linkedQ && linkedQ.grandTotal > 0
      ? linkedQ.grandTotal
      : Number(lead.estimatedBudget || 0);

    const createdAtMs = new Date(lead.createdAt).getTime();
    const daysInStage = Math.max(0, Math.floor((now - (lead.updatedAt ? new Date(lead.updatedAt).getTime() : createdAtMs)) / (1000 * 60 * 60 * 24)));

    const leadRecord = lead as unknown as {
      assignedSales?: { name?: string; firstName?: string; lastName?: string; email?: string } | null;
      dealer?: { name?: string; firstName?: string; companyName?: string } | null;
    };
    const assignedSales = leadRecord.assignedSales;
    const dealer = leadRecord.dealer;

    const salesName = assignedSales ? (assignedSales.name || `${assignedSales.firstName || ""} ${assignedSales.lastName || ""}`.trim() || assignedSales.email) : null;
    const dealerName = dealer ? (dealer.companyName || dealer.name || null) : null;

    const card: OpportunityCard = {
      id: lead._id,
      leadId: lead._id,
      referenceNumber: lead.referenceNumber,
      customerName: lead.customerName,
      phone: lead.phone || null,
      projectType: lead.projectType || null,
      stage: stageId,
      priority: lead.priority,
      estimatedValue,
      quotationId: lead.convertedQuotationId || null,
      quotationNumber: linkedQ?.quotationNumber || null,
      quotationStatus: linkedQ?.status || null,
      quotationGrandTotal: linkedQ?.grandTotal ?? null,
      assignedSalesName: salesName,
      dealerName,
      nextFollowUpAt: lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toISOString() : null,
      expectedClosingDate: lead.expectedClosingDate ? new Date(lead.expectedClosingDate).toISOString() : null,
      daysInStage,
      createdAt: new Date(lead.createdAt).toISOString(),
      isHotLead,
      quotationViewCount: viewCount,
    };

    const targetList = stageMap.get(stageId);
    if (targetList) {
      targetList.push(card);
    }
  }

  return PIPELINE_STAGES.map((s) => {
    const items = stageMap.get(s.id) || [];
    const totalValue = items.reduce((acc, item) => acc + item.estimatedValue, 0);
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      count: items.length,
      totalValue,
      items,
    };
  });
}
