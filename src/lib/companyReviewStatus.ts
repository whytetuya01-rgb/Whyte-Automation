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

/** Everything that stops a company's users from signing in, with the message shown once their password is verified. */
export type LoginBlock = ReviewBlock | "COMPANY_DEACTIVATED";

export const REVIEW_BLOCK_MESSAGES: Readonly<Record<LoginBlock, string>> = {
  COMPANY_DEACTIVATED:
    "Your company account has been deactivated. Please contact support to have it restored.",
  COMPANY_PENDING_REVIEW:
    "Your company registration is awaiting approval. You will receive an email when your account is approved.",
  COMPANY_REJECTED:
    "Your company registration was not approved. Please contact support if you believe this is a mistake.",
};
