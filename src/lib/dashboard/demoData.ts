/**
 * Development-only Demo Data & CRM Future-Ready Preview fixtures.
 *
 * MANDATORY SAFEGUARDS:
 * - This file contains in-memory synthetic preview structures only.
 * - NEVER written to, read from, or seeded into MongoDB or any persistent storage.
 * - NEVER combined with real tenant totals or business metrics.
 * - Allowed ONLY when `NODE_ENV !== "production"` or when `DASHBOARD_DEMO_DATA === "true"`.
 * - In production, demo mode is disabled by default and will fail-closed.
 */

export interface CrmLeadSource {
  source: string;
  count: number;
  percentage: number;
  wonRevenue: number;
}

export interface CrmOpportunityStage {
  id: string;
  name: string;
  count: number;
  value: number;
  color: string;
}

export interface CrmSalespersonPerformance {
  id: string;
  name: string;
  email: string;
  role: string;
  leadsAssigned: number;
  quotationsCreated: number;
  wonQuotations: number;
  wonRevenue: number;
  conversionRate: number;
  targetQuota: number;
  targetAchievement: number;
}

export interface CrmAnalyticsData {
  isDemo: true;
  summary: {
    totalLeads: number;
    activeOpportunities: number;
    pipelineValue: number;
    leadToWonRate: number;
    avgSalesCycleDays: number;
    wonRevenue: number;
  };
  stages: CrmOpportunityStage[];
  sources: CrmLeadSource[];
  salespeople: CrmSalespersonPerformance[];
}

/** Determines if development demo preview mode is permitted. */
export function isDemoModeAllowed(): boolean {
  if (process.env.DASHBOARD_DEMO_DATA === "true") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}

/** Demo CRM analytics dataset for illustrating future Lead & Opportunity capabilities. */
export function getDemoCrmAnalytics(): CrmAnalyticsData {
  return {
    isDemo: true,
    summary: {
      totalLeads: 84,
      activeOpportunities: 32,
      pipelineValue: 4850000,
      leadToWonRate: 26.2,
      avgSalesCycleDays: 18,
      wonRevenue: 1270000,
    },
    stages: [
      { id: "new_lead", name: "New Lead", count: 28, value: 1400000, color: "#6366F1" },
      { id: "site_visit", name: "Site Visit / Consultation", count: 18, value: 1250000, color: "#8B5CF6" },
      { id: "proposal_sent", name: "Quotation Delivered", count: 14, value: 1100000, color: "#EC4899" },
      { id: "negotiation", name: "Negotiation & Revisions", count: 6, value: 650000, color: "#F59E0B" },
      { id: "closed_won", name: "Closed Won", count: 22, value: 1270000, color: "#10B981" },
      { id: "closed_lost", name: "Closed Lost", count: 12, value: 580000, color: "#EF4444" },
    ],
    sources: [
      { source: "Architect & Interior Referrals", count: 34, percentage: 40, wonRevenue: 620000 },
      { source: "Website & Direct Inquiries", count: 22, percentage: 26, wonRevenue: 340000 },
      { source: "Showroom / Experience Center", count: 16, percentage: 19, wonRevenue: 210000 },
      { source: "Client Word of Mouth", count: 8, percentage: 10, wonRevenue: 75000 },
      { source: "Exhibitions & Events", count: 4, percentage: 5, wonRevenue: 25000 },
    ],
    salespeople: [
      {
        id: "sales-1",
        name: "Arun Sharma",
        email: "arun.sharma@example.com",
        role: "Senior Automation Specialist",
        leadsAssigned: 28,
        quotationsCreated: 24,
        wonQuotations: 8,
        wonRevenue: 520000,
        conversionRate: 33.3,
        targetQuota: 600000,
        targetAchievement: 86.7,
      },
      {
        id: "sales-2",
        name: "Pooja Varma",
        email: "pooja.varma@example.com",
        role: "Solutions Consultant",
        leadsAssigned: 24,
        quotationsCreated: 19,
        wonQuotations: 6,
        wonRevenue: 390000,
        conversionRate: 31.6,
        targetQuota: 500000,
        targetAchievement: 78.0,
      },
      {
        id: "sales-3",
        name: "Karan Patel",
        email: "karan.patel@example.com",
        role: "Technical Sales Associate",
        leadsAssigned: 18,
        quotationsCreated: 15,
        wonQuotations: 4,
        wonRevenue: 245000,
        conversionRate: 26.7,
        targetQuota: 400000,
        targetAchievement: 61.3,
      },
      {
        id: "sales-4",
        name: "Rohan Deshmukh",
        email: "rohan.d@example.com",
        role: "Channel Sales Manager",
        leadsAssigned: 14,
        quotationsCreated: 11,
        wonQuotations: 4,
        wonRevenue: 115000,
        conversionRate: 36.4,
        targetQuota: 300000,
        targetAchievement: 38.3,
      },
    ],
  };
}

