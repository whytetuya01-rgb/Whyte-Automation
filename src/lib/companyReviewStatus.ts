import type { CompanyRegistrationStatus } from "@/models/Company";

/**
 * Whether a company's self-registration review blocks its users.
 *
 * Only `pending_review` and `rejected` block. A company with no `registrationStatus` (created before
 * self-registration existed, e.g. Whyte itself) and an `approved` one do not, so existing logins are untouched.
 */
export type ReviewBlock = "COMPANY_PENDING_REVIEW" | "COMPANY_REJECTED";

export function reviewBlockFor(status: CompanyRegistrationStatus | null | undefined): ReviewBlock | null {
  if (status === "pending_review") return "COMPANY_PENDING_REVIEW";
  if (status === "rejected") return "COMPANY_REJECTED";
  return null;
}

export const REVIEW_BLOCK_MESSAGES: Readonly<Record<ReviewBlock, string>> = {
  COMPANY_PENDING_REVIEW:
    "Your company registration is awaiting approval. You will receive an email when your account is approved.",
  COMPANY_REJECTED:
    "Your company registration was not approved. Please contact support if you believe this is a mistake.",
};
