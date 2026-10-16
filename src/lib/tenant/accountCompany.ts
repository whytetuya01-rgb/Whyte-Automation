/**
 * Which company an account belongs to, resolved WITHOUT any default.
 *
 * A record with no company is never assumed to belong to Company 1: the only
 * way an account gets a company is an explicit `companyId` on the account.
 * The platform Super Admin has no company (it acts as one via the audited
 * act-as grant); every other role must have a positive integer `companyId`,
 * otherwise the account is treated as unusable (login refused, session invalid).
 */
export type AccountCompany = { ok: true; companyId: number | null } | { ok: false; reason: "MISSING_COMPANY" | "INVALID_COMPANY" };

export function resolveAccountCompany(role: string | null | undefined, rawCompanyId: unknown): AccountCompany {
  if (role?.trim().toLowerCase() === "super_admin") return { ok: true, companyId: null };
  if (rawCompanyId === undefined || rawCompanyId === null) return { ok: false, reason: "MISSING_COMPANY" };
  if (typeof rawCompanyId !== "number" || !Number.isInteger(rawCompanyId) || rawCompanyId <= 0) {
    return { ok: false, reason: "INVALID_COMPANY" };
  }
  return { ok: true, companyId: rawCompanyId };
}
