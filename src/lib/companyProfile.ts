/**
 * Review and audit data the platform keeps about a company (the reviewer's private note, who reviewed or deactivated
 * it, the decision email's delivery internals). The company's own APIs never return them.
 */
export const INTERNAL_COMPANY_FIELDS = [
  "reviewNote",
  "reviewedBy",
  "reviewedByName",
  "decisionEmail",
  "statusChangedBy",
  "statusChangedByName",
  "suspendedFromStatus",
  // storage id of the cover picture (only the server manages the file)
  "coverImagePublicId",
  // the owner email verification token hash and its bookkeeping
  "ownerEmailVerification",
] as const;

type InternalField = (typeof INTERNAL_COMPANY_FIELDS)[number];

/** The company record as its own users may see it: everything except the platform's internal review fields. */
export function toCompanyProfile<T extends object>(company: T | null | undefined): Omit<T, InternalField> | null {
  if (!company) return null;
  const profile: Record<string, unknown> = { ...(company as Record<string, unknown>) };
  for (const field of INTERNAL_COMPANY_FIELDS) delete profile[field];
  return profile as Omit<T, InternalField>;
}
