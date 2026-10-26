import { z } from "zod";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company } from "@/models";
import type { CompanyRegistrationStatus, DecisionEmailKind } from "@/models/Company";
import { runUnscoped } from "@/lib/tenant/context";
import { ApiError } from "@/lib/api-response";
import { sendEmail } from "@/lib/email/service";
import { renderCompanyApprovedEmail, renderCompanyRejectedEmail } from "@/lib/email/templates/company-decision";

/**
 * Super Admin review of self-registered companies: list, approve, reject, resend the decision email.
 *
 * Every state change is one conditional update (`registrationStatus` must still be `pending_review`), so two admins
 * clicking at once, or one admin clicking twice, produce exactly one transition and one email. Callers must have
 * proven the Super Admin role before calling in; nothing here trusts request data for identity.
 */

export const reviewTabSchema = z.enum(["pending_review", "approved", "rejected"]);
export type ReviewTab = z.infer<typeof reviewTabSchema>;

export const rejectBodySchema = z
  .object({
    note: z.string().trim().max(500, "The note must be 500 characters or fewer.").optional(),
    notifyOwner: z.boolean().optional(),
  })
  .strict();

export interface ReviewActor {
  id: number;
  name: string;
}

export interface RegistrationOwner {
  name: string | null;
  email: string;
  phone: string | null;
  isActive: boolean;
}

export interface RegistrationListItem {
  id: number;
  name: string;
  slug: string;
  email: string | null;
  phone: string;
  address: string;
  logoUrl: string | null;
  companyStatus: string;
  /** Companies that predate self-registration have no review state and show as approved. */
  registrationStatus: CompanyRegistrationStatus;
  origin: "self_registered" | "platform";
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  decisionEmail: { kind: DecisionEmailKind; status: string; attempts: number; lastError: string | null } | null;
  owner: RegistrationOwner | null;
}

type LeanCompany = {
  _id: number;
  name: string;
  slug: string;
  email?: string | null;
  phone: string;
  address: string;
  logoUrl?: string | null;
  status: string;
  registrationStatus?: CompanyRegistrationStatus | null;
  registrationSubmittedAt?: Date | null;
  createdAt?: Date;
  reviewedAt?: Date | null;
  reviewedByName?: string | null;
  reviewNote?: string | null;
  decisionEmail?: { kind: DecisionEmailKind; status: string; attempts: number; lastError?: string | null } | null;
};

const TAB_FILTER: Record<ReviewTab, Record<string, unknown>> = {
  pending_review: { registrationStatus: "pending_review" },
  rejected: { registrationStatus: "rejected" },
  approved: { $or: [{ registrationStatus: "approved" }, { registrationStatus: null }, { registrationStatus: { $exists: false } }] },
};

async function loadOwners(companyIds: number[]): Promise<Map<number, RegistrationOwner>> {
  if (companyIds.length === 0) return new Map();
  const owners = await runUnscoped("platform-admin", async () =>
    AdminUser.find({ companyId: { $in: companyIds }, role: "company_owner" })
      .select("companyId name email contactNumber isActive")
      .sort({ _id: 1 })
      .lean<Array<{ companyId: number; name: string | null; email: string; contactNumber: string | null; isActive: boolean }>>()
  );
  const byCompany = new Map<number, RegistrationOwner>();
  for (const owner of owners) {
    if (!byCompany.has(owner.companyId)) {
      byCompany.set(owner.companyId, { name: owner.name, email: owner.email, phone: owner.contactNumber, isActive: owner.isActive });
    }
  }
  return byCompany;
}

function toItem(company: LeanCompany, owner: RegistrationOwner | null): RegistrationListItem {
  const selfRegistered = Boolean(company.registrationStatus);
  return {
    id: company._id,
    name: company.name,
    slug: company.slug,
    email: company.email ?? null,
    phone: company.phone,
    address: company.address,
    logoUrl: company.logoUrl ?? null,
    companyStatus: company.status,
    registrationStatus: company.registrationStatus ?? "approved",
    origin: selfRegistered ? "self_registered" : "platform",
    submittedAt: (company.registrationSubmittedAt ?? company.createdAt)?.toISOString() ?? null,
    reviewedAt: company.reviewedAt?.toISOString() ?? null,
    reviewedByName: company.reviewedByName ?? null,
    reviewNote: company.reviewNote ?? null,
    decisionEmail: company.decisionEmail
      ? {
          kind: company.decisionEmail.kind,
          status: company.decisionEmail.status,
          attempts: company.decisionEmail.attempts,
          lastError: company.decisionEmail.lastError ?? null,
        }
      : null,
    owner,
  };
}

export async function listRegistrations(tab: ReviewTab): Promise<{ items: RegistrationListItem[]; counts: Record<ReviewTab, number> }> {
  await connectMongoDB();
  const companies = await Company.find(TAB_FILTER[tab]).sort({ registrationSubmittedAt: -1, _id: -1 }).limit(300).lean<LeanCompany[]>();
  const owners = await loadOwners(companies.map((c) => c._id));
  const [pending, approved, rejected] = await Promise.all(
    (["pending_review", "approved", "rejected"] as const).map((t) => Company.countDocuments(TAB_FILTER[t]))
  );
  return {
    items: companies.map((c) => toItem(c, owners.get(c._id) ?? null)),
    counts: { pending_review: pending, approved, rejected },
  };
}

export async function getRegistration(companyId: number): Promise<RegistrationListItem> {
  await connectMongoDB();
  const company = await Company.findById(companyId).lean<LeanCompany | null>();
  if (!company) throw new ApiError("NOT_FOUND", "Company not found.");
  const owners = await loadOwners([company._id]);
  return toItem(company, owners.get(company._id) ?? null);
}

function loginUrl(): string {
  return new URL("/admin/login", process.env.NEXTAUTH_URL || "http://localhost:3000").toString();
}

/** Sends (or re-sends) the decision email and records the true outcome. Never throws. */
async function deliverDecisionEmail(companyId: number, kind: DecisionEmailKind): Promise<"sent" | "failed"> {
  const company = await Company.findById(companyId).select("name").lean<{ name: string } | null>();
  const owners = await loadOwners([companyId]);
  const owner = owners.get(companyId);
  let outcome: { sent: boolean; reason: string | null } = { sent: false, reason: "NO_OWNER_EMAIL" };

  if (company && owner) {
    try {
      const data = {
        ownerFirstName: (owner.name ?? "").split(/\s+/)[0] || "there",
        companyName: company.name,
        loginUrl: loginUrl(),
        supportEmail: process.env.EMAIL_SUPPORT_ADDRESS || "support@whyte.co.in",
      };
      const rendered = kind === "approved" ? renderCompanyApprovedEmail(data) : renderCompanyRejectedEmail(data);
      const result = await sendEmail({ to: owner.email, subject: rendered.subject, html: rendered.html, text: rendered.text });
      outcome = { sent: result.sent, reason: result.sent ? null : (result.reason ?? "SEND_FAILED").slice(0, 60) };
    } catch (error) {
      console.error("[company-review] Decision email threw:", error instanceof Error ? error.message : "unknown error");
      outcome = { sent: false, reason: "SEND_EXCEPTION" };
    }
  }

  const now = new Date();
  await Company.updateOne(
    { _id: companyId, "decisionEmail.kind": kind },
    {
      $set: {
        "decisionEmail.status": outcome.sent ? "sent" : "failed",
        "decisionEmail.lastAttemptAt": now,
        "decisionEmail.sentAt": outcome.sent ? now : null,
        "decisionEmail.lastError": outcome.reason,
      },
      $inc: { "decisionEmail.attempts": 1 },
    }
  );
  return outcome.sent ? "sent" : "failed";
}

export interface DecisionResult {
  registration: RegistrationListItem;
  /** True when this request performed the transition; false when it had already happened (idempotent repeat). */
  changed: boolean;
}

async function describeBlockedTransition(companyId: number, wanted: "approved" | "rejected"): Promise<DecisionResult> {
  const existing = await Company.findById(companyId).lean<LeanCompany | null>();
  if (!existing) throw new ApiError("NOT_FOUND", "Company not found.");
  if (existing.registrationStatus === wanted) {
    const owners = await loadOwners([companyId]);
    return { registration: toItem(existing, owners.get(companyId) ?? null), changed: false };
  }
  if (!existing.registrationStatus) {
    throw new ApiError("CONFLICT", "This company was not created through self-registration, so there is nothing to review.");
  }
  throw new ApiError("CONFLICT", `This request has already been ${existing.registrationStatus === "approved" ? "approved" : "rejected"}.`);
}

export async function approveCompany(companyId: number, actor: ReviewActor): Promise<DecisionResult> {
  await connectMongoDB();
  const now = new Date();
  const updated = await Company.findOneAndUpdate(
    { _id: companyId, registrationStatus: "pending_review" },
    {
      $set: {
        registrationStatus: "approved",
        status: "active",
        reviewedAt: now,
        reviewedBy: actor.id,
        reviewedByName: actor.name,
        updatedAt: now,
        decisionEmail: { kind: "approved", status: "pending", attempts: 0, lastAttemptAt: null, sentAt: null, lastError: null },
      },
    },
    { new: true }
  ).lean<LeanCompany | null>();

  if (!updated) return describeBlockedTransition(companyId, "approved");

  // The approval is committed above; only now is the owner told. A failed email never undoes the approval.
  await deliverDecisionEmail(companyId, "approved");
  return { registration: await getRegistration(companyId), changed: true };
}

export async function rejectCompany(
  companyId: number,
  actor: ReviewActor,
  options: { note?: string; notifyOwner?: boolean }
): Promise<DecisionResult> {
  await connectMongoDB();
  const now = new Date();
  const set: Record<string, unknown> = {
    registrationStatus: "rejected",
    reviewedAt: now,
    reviewedBy: actor.id,
    reviewedByName: actor.name,
    updatedAt: now,
  };
  if (options.note) set.reviewNote = options.note;
  if (options.notifyOwner) {
    set.decisionEmail = { kind: "rejected", status: "pending", attempts: 0, lastAttemptAt: null, sentAt: null, lastError: null };
  }
  const updated = await Company.findOneAndUpdate(
    { _id: companyId, registrationStatus: "pending_review" },
    { $set: set },
    { new: true }
  ).lean<LeanCompany | null>();

  if (!updated) return describeBlockedTransition(companyId, "rejected");

  if (options.notifyOwner) await deliverDecisionEmail(companyId, "rejected");
  return { registration: await getRegistration(companyId), changed: true };
}

/**
 * Deactivates a company: every user of it (owner, admins, dealers) is refused at sign-in and any open session stops
 * working on its next request. The previous status is remembered so reactivating restores exactly it (a `pending`
 * company such as Whyte is never silently promoted to `active`). Idempotent. Companies still waiting for review, or
 * rejected, are handled by approve / reject instead.
 */
export async function deactivateCompany(companyId: number, actor: ReviewActor): Promise<DecisionResult> {
  await connectMongoDB();
  const now = new Date();
  const updated = await Company.findOneAndUpdate(
    { _id: companyId, status: { $ne: "suspended" }, registrationStatus: { $nin: ["pending_review", "rejected"] } },
    [
      {
        $set: {
          suspendedFromStatus: "$status",
          status: "suspended",
          statusChangedAt: now,
          statusChangedBy: actor.id,
          statusChangedByName: actor.name,
          updatedAt: now,
        },
      },
    ],
    { new: true, updatePipeline: true }
  ).lean<LeanCompany | null>();

  if (updated) return { registration: await getRegistration(companyId), changed: true };
  const existing = await Company.findById(companyId).lean<LeanCompany | null>();
  if (!existing) throw new ApiError("NOT_FOUND", "Company not found.");
  if (existing.status === "suspended") return { registration: await getRegistration(companyId), changed: false };
  throw new ApiError("CONFLICT", "This request has not been approved, so it is reviewed with Approve or Reject instead.");
}

export async function reactivateCompany(companyId: number, actor: ReviewActor): Promise<DecisionResult> {
  await connectMongoDB();
  const now = new Date();
  const updated = await Company.findOneAndUpdate(
    { _id: companyId, status: "suspended" },
    [
      {
        $set: {
          status: { $ifNull: ["$suspendedFromStatus", "active"] },
          statusChangedAt: now,
          statusChangedBy: actor.id,
          statusChangedByName: actor.name,
          updatedAt: now,
        },
      },
      { $unset: "suspendedFromStatus" },
    ],
    { new: true, updatePipeline: true }
  ).lean<LeanCompany | null>();

  if (updated) return { registration: await getRegistration(companyId), changed: true };
  const existing = await Company.findById(companyId).lean<LeanCompany | null>();
  if (!existing) throw new ApiError("NOT_FOUND", "Company not found.");
  return { registration: await getRegistration(companyId), changed: false };
}

/** How long an email stuck in `pending` is left alone before another attempt may claim it. */
const STALE_PENDING_MS = 2 * 60 * 1000;

export async function resendDecisionEmail(companyId: number): Promise<RegistrationListItem> {
  await connectMongoDB();
  const staleBefore = new Date(Date.now() - STALE_PENDING_MS);
  // Claim the retry atomically so two clicks cannot send two emails.
  const claimed = await Company.findOneAndUpdate(
    {
      _id: companyId,
      "decisionEmail.status": { $in: ["failed", "pending"] },
      $or: [{ "decisionEmail.status": "failed" }, { "decisionEmail.lastAttemptAt": { $lt: staleBefore } }, { "decisionEmail.lastAttemptAt": null, reviewedAt: { $lt: staleBefore } }],
    },
    { $set: { "decisionEmail.status": "pending", "decisionEmail.lastAttemptAt": new Date() } },
    { new: true }
  ).lean<LeanCompany | null>();

  if (!claimed) {
    const existing = await Company.findById(companyId).select("decisionEmail").lean<LeanCompany | null>();
    if (!existing) throw new ApiError("NOT_FOUND", "Company not found.");
    if (!existing.decisionEmail) throw new ApiError("CONFLICT", "No decision email was recorded for this company.");
    if (existing.decisionEmail.status === "sent") throw new ApiError("CONFLICT", "The email was already delivered.");
    throw new ApiError("CONFLICT", "An email attempt is already in progress. Please wait a moment.");
  }
  await deliverDecisionEmail(companyId, claimed.decisionEmail!.kind);
  return getRegistration(companyId);
}
