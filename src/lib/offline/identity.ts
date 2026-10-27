/**
 * The signed-in identity remembered on this device so the offline quotation builder can open without the
 * network (NextAuth's `useSession` needs a request to the server). Only ids and the display name are stored;
 * no tokens. It is removed on sign-out.
 */
export interface OfflineIdentity {
  companyId: number | string;
  userId: number | string;
  companyName: string;
  role: string;
  allocatedDiscountPercent: number;
}

const IDENTITY_KEY = "whyte:offline-identity";

export function saveOfflineIdentity(identity: OfflineIdentity): void {
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage can be unavailable (private mode); the builder then requires a session.
  }
}

export function loadOfflineIdentity(): OfflineIdentity | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineIdentity>;
    if (parsed.companyId == null || parsed.userId == null) return null;
    return {
      companyId: parsed.companyId,
      userId: parsed.userId,
      companyName: parsed.companyName ?? "",
      role: parsed.role ?? "user",
      allocatedDiscountPercent: Number(parsed.allocatedDiscountPercent ?? 0),
    };
  } catch {
    return null;
  }
}

export function clearOfflineIdentity(): void {
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // ignore
  }
}
