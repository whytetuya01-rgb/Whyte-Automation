import { connectMongoDB } from "@/lib/mongodb";
import {
  LeadAssignmentRule,
  AdminUser,
  Lead,
  LeadSource,
  type AssignmentMode,
  type ISourceMapping,
  type ILeadAssignmentRule,
} from "@/models";
import { ApiError } from "@/lib/api-response";
import { createNotification } from "@/lib/notificationService";
import type { ClientSession } from "mongoose";

export interface AssignmentResult {
  assignedSalesId: number | null;
  ruleUsed: "explicit" | "source_mapping" | "round_robin" | "least_open_leads" | "fallback" | "none";
  salesExecutiveName?: string | null;
}

/**
 * Gets the current lead assignment rule for a company. Returns sensible defaults if not yet created.
 */
export async function getLeadAssignmentRule(
  companyId: number
): Promise<ILeadAssignmentRule> {
  await connectMongoDB();
  const rule = await LeadAssignmentRule.findOne({ companyId }).lean();
  if (rule) {
    return {
      ...rule,
      id: rule._id,
    };
  }

  return {
    _id: `lar_${companyId}`,
    id: `lar_${companyId}`,
    companyId,
    mode: "manual",
    enabled: false,
    eligibleSalesIds: [],
    fallbackSalesId: null,
    sourceMappings: [],
    roundRobinCounter: 0,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Validates that all referenced sales representatives are active users in the specified company.
 */
async function validateSalesRepresentatives(
  companyId: number,
  salesIds: number[]
): Promise<Map<number, string>> {
  if (!salesIds.length) return new Map();

  const users = await AdminUser.find({
    companyId,
    _id: { $in: salesIds },
    role: "sales_executive",
    isActive: { $ne: false },
  })
    .select("_id name firstName lastName email")
    .lean();

  const map = new Map<number, string>();
  for (const u of users) {
    const fullName = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email;
    map.set(u._id, fullName);
  }

  for (const id of salesIds) {
    if (!map.has(id)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Sales representative #${id} is either inactive, does not have sales role, or belongs to another company.`,
        { field: "eligibleSalesIds" }
      );
    }
  }

  return map;
}

/**
 * Updates or creates the company's lead assignment rule.
 */
export async function updateLeadAssignmentRule(params: {
  companyId: number;
  mode: AssignmentMode;
  enabled: boolean;
  eligibleSalesIds: number[];
  fallbackSalesId?: number | null;
  sourceMappings?: ISourceMapping[];
  updatedBy: number;
}): Promise<ILeadAssignmentRule> {
  await connectMongoDB();

  // Validate eligible salespeople
  const allSalesIdsToVerify = new Set<number>(params.eligibleSalesIds);
  if (params.fallbackSalesId) {
    allSalesIdsToVerify.add(params.fallbackSalesId);
  }
  if (params.sourceMappings?.length) {
    for (const sm of params.sourceMappings) {
      if (sm.salesId) allSalesIdsToVerify.add(sm.salesId);
    }
  }

  await validateSalesRepresentatives(params.companyId, Array.from(allSalesIdsToVerify));

  // Validate lead sources if sourceMappings provided
  if (params.sourceMappings?.length) {
    const sourceIds = params.sourceMappings.map((sm) => sm.sourceId);
    const validSources = await LeadSource.find({
      companyId: params.companyId,
      _id: { $in: sourceIds },
    })
      .select("_id")
      .lean();

    const validSourceSet = new Set(validSources.map((s) => String(s._id)));
    for (const sm of params.sourceMappings) {
      if (!validSourceSet.has(sm.sourceId)) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `Lead source "${sm.sourceId}" not found in company.`,
          { field: "sourceMappings" }
        );
      }
    }
  }

  const now = new Date();
  const ruleId = `lar_${params.companyId}`;

  const updated = await LeadAssignmentRule.findOneAndUpdate(
    { _id: ruleId },
    {
      $set: {
        mode: params.mode,
        enabled: params.enabled,
        eligibleSalesIds: params.eligibleSalesIds,
        fallbackSalesId: params.fallbackSalesId ?? null,
        sourceMappings: params.sourceMappings ?? [],
        updatedBy: params.updatedBy,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: ruleId,
        companyId: params.companyId,
        roundRobinCounter: 0,
        createdAt: now,
      },
    },
    { returnDocument: "after", upsert: true }
  ).lean();

  return {
    ...updated,
    id: updated._id,
  };
}

/**
 * Runs the assignment engine for an incoming or created lead.
 * Follows the strict priority chain:
 * 1. User-explicit assignee always wins.
 * 2. If rule enabled and source mapping matches -> assigned to mapped sales rep.
 * 3. If mode is round_robin -> race-safe atomic increment modulo eligible pool.
 * 4. If mode is least_open_leads -> rep with fewest open leads.
 * 5. Fallback owner if pool is empty or inactive.
 * 6. None (unassigned).
 */
export async function determineLeadAssignee(
  companyId: number,
  options?: {
    sourceId?: string | null;
    explicitSalesId?: number | null;
    session?: ClientSession | null;
  }
): Promise<AssignmentResult> {
  await connectMongoDB();

  // 1. Explicit assignee always wins over any rule
  if (options?.explicitSalesId != null) {
    const user = await AdminUser.findOne({
      _id: options.explicitSalesId,
      companyId,
      role: "sales_executive",
      isActive: { $ne: false },
    })
      .select("_id name firstName lastName email")
      .session(options?.session ?? null)
      .lean();

    if (user) {
      const name = user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;
      return {
        assignedSalesId: user._id,
        ruleUsed: "explicit",
        salesExecutiveName: name,
      };
    }
    // If explicitSalesId is invalid, fall through to auto-assignment or error
  }

  const rule = await LeadAssignmentRule.findOne({ companyId })
    .session(options?.session ?? null)
    .lean();

  if (!rule || !rule.enabled || rule.mode === "manual") {
    return { assignedSalesId: null, ruleUsed: "none" };
  }

  // 2. Lead Source Mapping rule
  if (options?.sourceId && rule.sourceMappings?.length) {
    const mapping = rule.sourceMappings.find((m) => m.sourceId === options.sourceId);
    if (mapping && mapping.salesId) {
      const mappedUser = await AdminUser.findOne({
        _id: mapping.salesId,
        companyId,
        role: "sales_executive",
        isActive: { $ne: false },
      })
        .select("_id name firstName lastName email")
        .session(options?.session ?? null)
        .lean();

      if (mappedUser) {
        const name = mappedUser.name || `${mappedUser.firstName || ""} ${mappedUser.lastName || ""}`.trim() || mappedUser.email;
        return {
          assignedSalesId: mappedUser._id,
          ruleUsed: "source_mapping",
          salesExecutiveName: name,
        };
      }
    }
  }

  // 3. Pool of active eligible salespeople
  const eligibleReps = await AdminUser.find({
    companyId,
    _id: { $in: rule.eligibleSalesIds },
    role: "sales_executive",
    isActive: { $ne: false },
  })
    .sort({ _id: 1 })
    .select("_id name firstName lastName email")
    .session(options?.session ?? null)
    .lean();

  if (!eligibleReps.length) {
    // If pool empty, try fallback owner
    if (rule.fallbackSalesId) {
      const fallbackUser = await AdminUser.findOne({
        _id: rule.fallbackSalesId,
        companyId,
        role: "sales_executive",
        isActive: { $ne: false },
      })
        .select("_id name firstName lastName email")
        .session(options?.session ?? null)
        .lean();

      if (fallbackUser) {
        const name = fallbackUser.name || `${fallbackUser.firstName || ""} ${fallbackUser.lastName || ""}`.trim() || fallbackUser.email;
        return {
          assignedSalesId: fallbackUser._id,
          ruleUsed: "fallback",
          salesExecutiveName: name,
        };
      }
    }

    return { assignedSalesId: null, ruleUsed: "none" };
  }

  // 4. Mode-based assignment
  if (rule.mode === "round_robin") {
    // Race-safe atomic counter increment via findOneAndUpdate
    const updatedRule = await LeadAssignmentRule.findOneAndUpdate(
      { _id: `lar_${companyId}` },
      {
        $inc: { roundRobinCounter: 1 },
        $setOnInsert: {
          _id: `lar_${companyId}`,
          companyId,
          mode: "round_robin",
          enabled: true,
          eligibleSalesIds: rule.eligibleSalesIds,
          fallbackSalesId: rule.fallbackSalesId ?? null,
          sourceMappings: rule.sourceMappings ?? [],
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after", upsert: true, session: options?.session ?? null }
    ).lean();

    const counter = updatedRule?.roundRobinCounter ?? 1;
    const poolSize = eligibleReps.length;
    // Map counter to index [0, poolSize - 1]
    const index = Math.abs((counter - 1) % poolSize);
    const chosen = eligibleReps[index];
    const name = chosen.name || `${chosen.firstName || ""} ${chosen.lastName || ""}`.trim() || chosen.email;

    return {
      assignedSalesId: chosen._id,
      ruleUsed: "round_robin",
      salesExecutiveName: name,
    };
  }

  if (rule.mode === "least_open_leads") {
    const eligibleIds = eligibleReps.map((r) => r._id);
    const openLeadCounts = await Lead.aggregate([
      {
        $match: {
          companyId,
          assignedSalesId: { $in: eligibleIds },
          status: { $nin: ["won", "lost"] },
          isDeleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$assignedSalesId",
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap = new Map<number, number>();
    for (const rep of eligibleReps) countMap.set(rep._id, 0);
    for (const row of openLeadCounts) countMap.set(row._id, row.count);

    // Sort by count ascending, tie-breaker by rep._id ascending
    const sorted = [...eligibleReps].sort((a, b) => {
      const diff = (countMap.get(a._id) ?? 0) - (countMap.get(b._id) ?? 0);
      return diff !== 0 ? diff : a._id - b._id;
    });

    const chosen = sorted[0];
    const name = chosen.name || `${chosen.firstName || ""} ${chosen.lastName || ""}`.trim() || chosen.email;

    return {
      assignedSalesId: chosen._id,
      ruleUsed: "least_open_leads",
      salesExecutiveName: name,
    };
  }

  // Fallback if none matched
  if (rule.fallbackSalesId) {
    const fallbackUser = await AdminUser.findOne({
      _id: rule.fallbackSalesId,
      companyId,
      role: "sales_executive",
      isActive: { $ne: false },
    })
      .select("_id name firstName lastName email")
      .session(options?.session ?? null)
      .lean();

    if (fallbackUser) {
      const name = fallbackUser.name || `${fallbackUser.firstName || ""} ${fallbackUser.lastName || ""}`.trim() || fallbackUser.email;
      return {
        assignedSalesId: fallbackUser._id,
        ruleUsed: "fallback",
        salesExecutiveName: name,
      };
    }
  }

  return { assignedSalesId: null, ruleUsed: "none" };
}

/**
 * Notifies the assigned sales executive about a new lead or reassigned lead.
 */
export async function notifyLeadAssigned(params: {
  companyId: number;
  leadId: string;
  referenceNumber: string;
  customerName: string;
  assignedSalesId: number;
  isReassignment?: boolean;
  session?: ClientSession | null;
}): Promise<void> {
  const isRe = Boolean(params.isReassignment);
  await createNotification({
    companyId: params.companyId,
    userId: params.assignedSalesId,
    type: "lead_assigned",
    title: isRe ? "Lead Reassigned" : "New Lead Assigned",
    body: isRe
      ? `Lead ${params.referenceNumber} (${params.customerName}) has been reassigned to you.`
      : `Lead ${params.referenceNumber} (${params.customerName}) has been assigned to you.`,
    link: `/admin/crm/pipeline?lead=${params.leadId}`,
    dedupeKey: `lead_assigned:${params.leadId}:${params.assignedSalesId}`,
    metadata: { leadId: params.leadId },
    session: params.session,
  });
}

