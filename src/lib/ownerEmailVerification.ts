import { createHash, randomBytes } from "node:crypto";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company } from "@/models";
import { runUnscoped } from "@/lib/tenant/context";
import { ApiError } from "@/lib/api-response";
import { sendEmail } from "@/lib/email/service";
import { renderCompanyVerificationEmail } from "@/lib/email/templates/company-email-verification";

/**
 * Company-owner email verification for self-registration.
 *
 * A registration stores only the SHA-256 of a random 32-byte token (never the token itself) with an expiry. The
 * owner opens the emailed link; the request can be approved only once that has happened. Companies created before
 * this existed have no verification record and are treated as not needing one.
 */

export const VERIFICATION_TTL_HOURS = 48;

export interface OwnerEmailVerification {
  tokenHash: string | null;
  expiresAt: Date | null;
  sentAt: Date | null;
  sendCount: number;
  verifiedAt: Date | null;
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh token (for the link) and the record to store (hash + expiry only). */
export function newVerification(): { token: string; record: OwnerEmailVerification } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    record: { tokenHash: hashVerificationToken(token), expiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600 * 1000), sentAt: null, sendCount: 0, verifiedAt: null },
  };
}

/** True while a self-registration still waits for its owner to verify the email (false for legacy companies). */
export function isVerificationPending(verification: OwnerEmailVerification | null | undefined): boolean {
  return Boolean(verification) && !verification?.verifiedAt;
}

function verifyUrl(token: string): string {
  const url = new URL("/register/company/verify", process.env.NEXTAUTH_URL || "http://localhost:3000");
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Emails the verification link and records the send. Never throws: a mail problem must not fail a registration
 * (the owner can request a new link).
 */
export async function deliverVerificationEmail(input: { companyId: number; companyName: string; ownerName: string | null; ownerEmail: string; token: string }): Promise<boolean> {
  let sent = false;
  try {
    const rendered = renderCompanyVerificationEmail({
      ownerFirstName: (input.ownerName ?? "").split(/\s+/)[0] || "there",
      companyName: input.companyName,
      verifyUrl: verifyUrl(input.token),
      expiresInHours: VERIFICATION_TTL_HOURS,
      supportEmail: process.env.EMAIL_SUPPORT_ADDRESS || "support@whyte.co.in",
    });
    const result = await sendEmail({ to: input.ownerEmail, subject: rendered.subject, html: rendered.html, text: rendered.text });
    sent = result.sent;
  } catch (error) {
    console.error("[owner-verification] Could not send the verification email:", error instanceof Error ? error.message : "unknown error");
  }
  await Company.updateOne({ _id: input.companyId }, { $set: { "ownerEmailVerification.sentAt": new Date() }, $inc: { "ownerEmailVerification.sendCount": 1 } });
  return sent;
}

/** Most links one registration can be sent (initial + resends). */
export const MAX_VERIFICATION_SENDS = 6;

/** Issues a new link for a registration still waiting for verification (the previous link stops working). */
export async function reissueVerification(companyId: number): Promise<"sent" | "not_pending" | "limit"> {
  await connectMongoDB();
  const company = await Company.findById(companyId).select("name registrationStatus ownerEmailVerification").lean<{
    name: string;
    registrationStatus?: string | null;
    ownerEmailVerification?: OwnerEmailVerification | null;
  } | null>();
  if (!company || company.registrationStatus !== "pending_review" || !isVerificationPending(company.ownerEmailVerification)) return "not_pending";
  if ((company.ownerEmailVerification?.sendCount ?? 0) >= MAX_VERIFICATION_SENDS) return "limit";
  const owner = await runUnscoped("public-registration", async () =>
    await AdminUser.findOne({ companyId, role: "company_owner" }).sort({ _id: 1 }).select("name email").lean<{ name: string | null; email: string } | null>()
  );
  if (!owner) return "not_pending";
  const { token, record } = newVerification();
  await Company.updateOne(
    { _id: companyId, "ownerEmailVerification.verifiedAt": null },
    { $set: { "ownerEmailVerification.tokenHash": record.tokenHash, "ownerEmailVerification.expiresAt": record.expiresAt } }
  );
  await deliverVerificationEmail({ companyId, companyName: company.name, ownerName: owner.name, ownerEmail: owner.email, token });
  return "sent";
}

/** Resend for an owner email typed on the public page. Says nothing about whether the email exists. */
export async function reissueVerificationForEmail(email: string): Promise<void> {
  await connectMongoDB();
  const owner = await runUnscoped("public-registration", async () =>
    await AdminUser.findOne({ email, role: "company_owner" }).select("companyId").lean<{ companyId: number } | null>()
  );
  if (owner?.companyId) await reissueVerification(owner.companyId);
}

/** Marks the owner's email verified for the registration the token belongs to. */
export async function verifyOwnerEmail(token: string): Promise<{ companyName: string; alreadyVerified: boolean }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new ApiError("VALIDATION_ERROR", "This verification link is not valid.", { field: "token" });
  await connectMongoDB();
  const tokenHash = hashVerificationToken(token);
  const company = await Company.findOne({ "ownerEmailVerification.tokenHash": tokenHash })
    .select("name ownerEmailVerification")
    .lean<{ _id: number; name: string; ownerEmailVerification?: OwnerEmailVerification | null } | null>();
  if (!company) throw new ApiError("NOT_FOUND", "This verification link is not valid or has already been replaced by a newer one.");
  if (company.ownerEmailVerification?.verifiedAt) return { companyName: company.name, alreadyVerified: true };
  if (!company.ownerEmailVerification?.expiresAt || company.ownerEmailVerification.expiresAt.getTime() < Date.now()) {
    throw new ApiError("CONFLICT", "This verification link has expired. Request a new one below.", { details: { reason: "expired" } });
  }
  await Company.updateOne(
    { _id: company._id, "ownerEmailVerification.tokenHash": tokenHash },
    // The hash is kept (not cleared) so opening the same link again shows "already verified"; it can never verify anything else.
    { $set: { "ownerEmailVerification.verifiedAt": new Date(), "ownerEmailVerification.expiresAt": null } }
  );
  return { companyName: company.name, alreadyVerified: false };
}
