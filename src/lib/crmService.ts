import mongoose from "mongoose";
import type { ClientSession } from "mongoose";
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
import { hasPermission } from "@/lib/permissions";
import { requireActiveDealer, requireActiveSalesExecutive } from "@/lib/quotationOwnership";
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
 * Builds every CRM list query: the company, the caller's visibility rule and each requested filter are all required
 * (`$and`). A request parameter (dealerId, assignedSalesId, a search term...) can therefore only narrow the result;
 * it can never replace or weaken the visibility rule, whatever keys that rule uses.
 */
export function scopedQuery(
  companyId: number,
  visibility: Record<string, unknown>,
  filters: Array<Record<string, unknown>>
): Record<string, unknown> {
  const clauses = [visibility, ...filters].filter((clause) => Object.keys(clause).length > 0);
  return clauses.length > 0 ? { companyId, $and: clauses } : { companyId };
}

/** MongoDB's duplicate-key error (E11000), however the driver wrapped it. */
export function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
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
 * A pattern that matches one phone number however it was typed ("9876543210", "+91 98765 43210", "098765-43210").
 * Only Indian 10-digit numbers get this treatment; any other number must match as typed.
 */
export function phoneMatchRegex(phone: string | null | undefined): RegExp | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const key = digits.length >= 10 ? digits.slice(-10) : "";
  if (!/^[6-9]\d{9}$/.test(key)) return null;
  return new RegExp(`^\\s*(?:\\+?\\s*91[\\s-]*|0)?${key.split("").join("[\\s-]*")}\\s*$`);
}

function contactClauses(phone: string | null | undefined, email: string | null | undefined): Array<Record<string, unknown>> {
  const clauses: Array<Record<string, unknown>> = [];
  const trimmedPhone = phone?.trim();
  if (trimmedPhone) clauses.push({ phone: phoneMatchRegex(trimmedPhone) ?? trimmedPhone });
  const trimmedEmail = email?.trim().toLowerCase();
  if (trimmedEmail) clauses.push({ email: trimmedEmail });
  return clauses;
}

type ContactMatch = { _id: number; name: string; phone: string | null; email: string | null };

/** The oldest customer of the company with the same phone (in any format) or email. */
export async function findCustomerByContact(
  companyId: number,
  phone: string | null | undefined,
  email: string | null | undefined,
  excludeId?: number
): Promise<ContactMatch | null> {
  const or = contactClauses(phone, email);
  if (or.length === 0) return null;
  await connectMongoDB();
  const query: Record<string, unknown> = { companyId, $or: or };
  if (excludeId !== undefined) query._id = { $ne: excludeId };
  return Customer.findOne(query).sort({ _id: 1 }).select("_id name phone email").lean<ContactMatch | null>();
}

/**
 * Two requests can pass the "is there a duplicate?" check at the same moment. Called right after a customer was
 * created: if an older customer with the same contact now exists, the new record is removed and the older one is
 * returned, so exactly one record survives whichever request was faster. Returns null when the new record stands.
 */
export async function settleNewCustomer(companyId: number, createdId: number, phone: string | null, email: string | null): Promise<number | null> {
  const earlier = await findCustomerByContact(companyId, phone, email, createdId);
  if (!earlier || earlier._id > createdId) return null;
  await Customer.collection.deleteOne({ _id: createdId } as never);
  return earlier._id;
}

/**
 * Creates or matches a central Customer record for a lead conversion or quotation.
 * Matches an existing customer of the company by phone (any common format) or email, so the same person is
 * never stored twice, even when two requests arrive together.
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

  const existing = await findCustomerByContact(params.companyId, phone, email);
  if (existing) return existing._id;

  // Create new customer with sequential integer id
  const nextId = await getNextSequence("customer", Customer);
  let created: { _id: number };
  try {
    created = await Customer.create({
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
  } catch (error) {
    // Another request created the same person a moment earlier (the unique phone index refused this one): use theirs.
    if (!isDuplicateKey(error)) throw error;
    const winner = await findCustomerByContact(params.companyId, phone, email);
    if (winner) return winner._id;
    throw new ApiError("CONFLICT", "A customer with this phone number already exists.", { field: "phone" });
  }

  const winner = await settleNewCustomer(params.companyId, created._id, phone, email);
  return winner ?? created._id;
}

/** A lead's dealer and salesperson must be active people of the same company (the same rule quotations use). */
export async function assertValidLeadAssignees(params: { companyId: number; dealerId?: number | null; assignedSalesId?: number | null }): Promise<void> {
  if (params.dealerId) await requireActiveDealer(params.dealerId, params.companyId);
  if (params.assignedSalesId) await requireActiveSalesExecutive(params.assignedSalesId, params.companyId);
}

/**
 * References a lead is created or edited with. The customer must exist in the company and be visible to the caller;
 * the lead source must be an active source of the company. Returns the source's own name (never the client's text).
 */
export async function resolveLeadReferences(params: {
  companyId: number;
  role: string;
  userId: number;
  customerId?: number | null;
  sourceId?: string | null;
}): Promise<{ sourceName: string | null }> {
  if (params.customerId) {
    const found = await Customer.exists({ _id: params.customerId, companyId: params.companyId, ...crmVisibilityFilter({ role: params.role, userId: params.userId }) });
    if (!found) throw new ApiError("NOT_FOUND", "Customer not found.", { field: "customerId" });
  }
  let sourceName: string | null = null;
  if (params.sourceId) {
    const source = await LeadSource.findOne({ _id: params.sourceId, companyId: params.companyId, isActive: true }).select("name").lean();
    if (!source) throw new ApiError("NOT_FOUND", "Lead source not found.", { field: "sourceId" });
    sourceName = source.name;
  }
  return { sourceName };
}

export interface LinkActor {
  role: string;
  userId: number;
  permissions: string[];
  companyId: number | null | undefined;
}

/**
 * The customer / lead a quotation request asks to link, checked. Only a NEW link is checked and returned (a value equal
 * to the current one, null or undefined means "no change"; unlinking is not done through quotation requests).
 *
 *  - customer: needs customers:read, and must exist in the caller's company and be visible to the caller;
 *  - lead:     needs leads:manage, must exist in the company and be visible, must not already have a quotation, and a
 *              quotation that is already linked to a lead can never be moved to another one.
 */
export async function validateQuotationLinks(
  actor: LinkActor,
  requested: { customerId?: number | null; leadId?: string | null },
  current?: { customerId?: number | null; leadId?: string | null; quotationId?: string }
): Promise<{ customerId?: number; leadId?: string }> {
  const result: { customerId?: number; leadId?: string } = {};
  const wantsCustomer = requested.customerId != null && requested.customerId !== (current?.customerId ?? null);
  const wantsLead = requested.leadId != null && requested.leadId !== (current?.leadId ?? null);
  if (!wantsCustomer && !wantsLead) return result;

  const { role, userId, permissions, companyId } = actor;
  if (!companyId) throw new ApiError("FORBIDDEN", "A company context is required to link CRM records.");
  await connectMongoDB();
  const visibility = crmVisibilityFilter({ role, userId });

  if (wantsCustomer) {
    if (!hasPermission(role, permissions, "customers:read")) {
      throw new ApiError("FORBIDDEN", "You do not have permission to link a customer to a quotation.", { field: "customerId" });
    }
    const customer = await Customer.findOne({ _id: requested.customerId, companyId, ...visibility }).select("_id").lean();
    if (!customer) throw new ApiError("NOT_FOUND", "Customer not found.", { field: "customerId" });
    result.customerId = customer._id;
  }

  if (wantsLead) {
    if (current?.leadId) {
      throw new ApiError("CONFLICT", "This quotation is already linked to a lead; the link cannot be changed.", { field: "leadId" });
    }
    if (!hasPermission(role, permissions, "leads:manage")) {
      throw new ApiError("FORBIDDEN", "You do not have permission to link a lead to a quotation.", { field: "leadId" });
    }
    const lead = await Lead.findOne({ _id: requested.leadId, companyId, ...visibility }).select("_id convertedQuotationId").lean();
    if (!lead) throw new ApiError("NOT_FOUND", "Lead not found.", { field: "leadId" });
    if (lead.convertedQuotationId && lead.convertedQuotationId !== current?.quotationId) {
      throw new ApiError("CONFLICT", "This lead already has a quotation.", { field: "leadId" });
    }
    result.leadId = lead._id;
  }
  return result;
}

/**
 * Takes the lead for this quotation with one conditional update, so a lead can only ever point at one quotation: a
 * lead that already has one (from Convert, another quotation, or a simultaneous request) is refused with 409.
 * Pass the transaction session when there is one, so the claim rolls back with the quotation.
 */
export async function claimLeadForQuotation(params: { companyId: number; leadId: string; quotationId: string; session?: ClientSession | null }): Promise<void> {
  const claimed = await Lead.findOneAndUpdate(
    { _id: params.leadId, companyId: params.companyId, convertedQuotationId: null },
    { $set: { convertedQuotationId: params.quotationId, updatedAt: new Date() } },
    { returnDocument: "after", session: params.session ?? undefined }
  );
  if (!claimed) throw new ApiError("CONFLICT", "This lead already has a quotation.", { field: "leadId" });
}

/** Gives a claimed lead back after the quotation could not be saved (only if it still points at that quotation). */
export async function releaseLeadClaim(params: { companyId: number; leadId: string; quotationId: string }): Promise<void> {
  await Lead.updateOne(
    { _id: params.leadId, companyId: params.companyId, convertedQuotationId: params.quotationId },
    { $set: { convertedQuotationId: null } }
  ).catch(() => undefined);
}

/**
 * After a quotation was linked to a lead: an early lead moves to Quoted (Quoted, Negotiation, Won and Lost are never
 * moved), the lead picks up the quotation's customer if it had none, and the link goes into the lead's timeline.
 */
export async function finalizeLeadLink(params: {
  companyId: number;
  leadId: string;
  quotationId: string;
  quotationNumber: string;
  customerId?: number | null;
  userId: number;
}): Promise<void> {
  try {
    const lead = await Lead.findOne({ _id: params.leadId, companyId: params.companyId });
    if (!lead) return;
    const before = lead.status;
    if (["new", "contacted", "site_visit"].includes(before)) lead.status = "quoted";
    if (!lead.customerId && params.customerId) lead.customerId = params.customerId;
    lead.updatedAt = new Date();
    await lead.save();
    await recordCrmActivity({
      companyId: params.companyId,
      leadId: lead._id,
      customerId: lead.customerId,
      quotationId: params.quotationId,
      type: "status_change",
      title: "Quotation Linked",
      description: `Quotation ${params.quotationNumber} was linked to this lead${before !== lead.status ? `; stage moved from "${before}" to "${lead.status}"` : ""}.`,
      performedBy: params.userId,
    });
  } catch (error) {
    console.warn("[crm] Could not finish linking the lead:", error instanceof Error ? error.message : "unknown error");
  }
}

/** Timeline entries for a quotation's customer link: "Linked" on the new customer, "Unlinked" on the previous one. */
export async function recordQuotationCustomerLink(params: {
  companyId: number;
  quotationId: string;
  quotationNumber: string;
  previousCustomerId?: number | null;
  customerId: number;
  leadId?: string | null;
  userId: number;
}): Promise<void> {
  try {
    if (params.previousCustomerId && params.previousCustomerId !== params.customerId) {
      await recordCrmActivity({
        companyId: params.companyId,
        customerId: params.previousCustomerId,
        quotationId: params.quotationId,
        type: "note",
        title: "Quotation Unlinked",
        description: `Quotation ${params.quotationNumber} was moved to another customer.`,
        performedBy: params.userId,
      });
    }
    await recordCrmActivity({
      companyId: params.companyId,
      customerId: params.customerId,
      leadId: params.leadId ?? null,
      quotationId: params.quotationId,
      type: "note",
      title: "Quotation Linked",
      description: `Quotation ${params.quotationNumber} linked to customer${params.previousCustomerId && params.previousCustomerId !== params.customerId ? " (changed from another customer)" : ""}.`,
      performedBy: params.userId,
    });
  } catch (error) {
    console.warn("[crm] Could not record the customer link:", error instanceof Error ? error.message : "unknown error");
  }
}

type QuotationTotal = { grandTotal: number; quotationNumber: string; status: string };

/** Grand total, number and status of quotations, worked out with the same functions the quotation screens use. */
export async function quotationGrandTotals(quotationIds: string[]): Promise<Map<string, QuotationTotal>> {
  const result = new Map<string, QuotationTotal>();
  if (quotationIds.length === 0) return result;
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
    result.set(qId, { grandTotal: financials.grandTotal, quotationNumber: q.quotationNumber, status: q.status });
  }
  return result;
}

/**
 * Keeps a lead in step with its quotation: sending moves an early lead to Quoted, approval wins it, rejection loses
 * it (the reason is recorded and the card can be dragged back). Stages only move forward, a won deal stays won, and
 * a failure here never affects the quotation operation that triggered it.
 */
export async function syncLeadWithQuotation(params: {
  leadId?: string | null;
  quotationId: string;
  quotationNumber: string;
  event: "sent" | "approved" | "rejected";
  userId: number;
}): Promise<void> {
  if (!params.leadId) return;
  try {
    await connectMongoDB();
    const lead = await Lead.findById(params.leadId);
    if (!lead) return;

    const before = lead.status;
    let title: string | null = null;
    if (params.event === "sent" && ["new", "contacted", "site_visit"].includes(before)) {
      lead.status = "quoted";
      title = "Quotation Sent";
    } else if (params.event === "approved" && before !== "won") {
      lead.status = "won";
      lead.wonAt = new Date();
      lead.lostAt = null;
      lead.lostReason = null;
      title = "Deal Won (quotation approved)";
    } else if (params.event === "rejected" && before !== "won" && before !== "lost") {
      lead.status = "lost";
      lead.lostAt = new Date();
      lead.lostReason = "Quotation rejected";
      title = "Deal Lost (quotation rejected)";
    }
    if (!title) return;

    lead.updatedAt = new Date();
    await lead.save();
    await recordCrmActivity({
      companyId: lead.companyId,
      leadId: lead._id,
      customerId: lead.customerId,
      quotationId: params.quotationId,
      type: params.event === "sent" ? "quotation_sent" : "status_change",
      title,
      description: `Quotation ${params.quotationNumber} ${params.event}; lead moved from "${before}" to "${lead.status}".`,
      performedBy: params.userId,
    });
  } catch (error) {
    console.warn("[crm] Could not sync the lead with its quotation:", error instanceof Error ? error.message : "unknown error");
  }
}

/** The note the first version wrote when a card was dragged to Negotiation (status stayed "quoted"). */
export const LEGACY_NEGOTIATION_NOTE = "Negotiation & customer revisions in progress";

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

  const requested: Array<Record<string, unknown>> = [];
  if (filters?.assignedSalesId) requested.push({ assignedSalesId: filters.assignedSalesId });
  if (filters?.dealerId) requested.push({ dealerId: filters.dealerId });
  if (filters?.search && filters.search.trim()) {
    const rx = new RegExp(filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    requested.push({ $or: [{ customerName: rx }, { referenceNumber: rx }, { phone: rx }, { projectType: rx }] });
  }
  const finalQuery = scopedQuery(companyId, crmVisibilityFilter(userCtx), requested);

  const leads = await Lead.find(finalQuery)
    .populate({ path: "assignedSales", select: "name firstName lastName email" })
    .populate({ path: "dealer", select: "name firstName lastName companyName" })
    .sort({ createdAt: -1 })
    .lean();

  // Find all converted/linked quotations
  const quotationIds = leads
    .map((l) => l.convertedQuotationId)
    .filter((id): id is string => Boolean(id));

  const quotationTotalsMap = await quotationGrandTotals(quotationIds);

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
    else if (lead.status === "negotiation") stageId = "negotiation";
    else if (lead.status === "quoted") {
      // Cards moved to Negotiation before it was a real status were saved as "quoted" with this exact note.
      stageId = lead.notes === LEGACY_NEGOTIATION_NOTE ? "negotiation" : "quoted";
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
