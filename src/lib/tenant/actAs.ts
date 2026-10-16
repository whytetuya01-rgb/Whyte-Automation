import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { connectMongoDB } from "@/lib/mongodb";
import { PlatformAccessLog, Company } from "@/models";

/**
 * The platform Super Admin's "act as company" session — see the doc comment
 * on `src/models/PlatformAccessLog.ts` for the full tamper-resistance
 * rationale (the cookie is just a random id; the grant lives server-side).
 */
export const ACT_AS_COOKIE = "whyte_act_as";
const ACT_AS_MAX_AGE_SECONDS = 4 * 60 * 60; // 4 hours — a deliberately short-lived grant, re-started explicitly, never silently renewed.
export const ACT_AS_MAX_AGE_MS = ACT_AS_MAX_AGE_SECONDS * 1000;

export interface ActAsGrant {
  companyId: number;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
}

/**
 * The active, unexpired grant for this super admin, or null. Expiry is enforced
 * HERE (server-side, from the audit row's `startedAt`), not by the cookie's
 * max-age alone — a replayed or extended cookie cannot outlive the grant.
 */
export async function resolveActAsGrant(superAdminUserId: number): Promise<ActAsGrant | null> {
  const store = await cookies();
  const token = store.get(ACT_AS_COOKIE)?.value;
  if (!token) return null;
  await connectMongoDB();
  const log = await PlatformAccessLog.findOne({
    _id: token,
    superAdminUserId,
    endedAt: null,
    startedAt: { $gt: new Date(Date.now() - ACT_AS_MAX_AGE_MS) },
  })
    .select("companyId reason startedAt")
    .lean();
  if (!log?.companyId) return null;
  return {
    companyId: log.companyId,
    reason: log.reason,
    startedAt: log.startedAt,
    expiresAt: new Date(log.startedAt.getTime() + ACT_AS_MAX_AGE_MS),
  };
}

/** Resolves the active (unexpired) "act as company" company id for this super admin from the request's cookie, or null. */
export async function resolveActAsCompanyId(superAdminUserId: number): Promise<number | null> {
  return (await resolveActAsGrant(superAdminUserId))?.companyId ?? null;
}

/** Starts a new act-as session: writes the audit/grant row and sets the cookie. Returns the new session's id. */
export async function startActAsSession(superAdminUserId: number, companyId: number, reason: string): Promise<string> {
  await connectMongoDB();
  // One live grant at a time: switching company closes the previous audit row.
  await PlatformAccessLog.updateMany({ superAdminUserId, endedAt: null }, { $set: { endedAt: new Date() } });
  const id = randomBytes(24).toString("base64url");
  await PlatformAccessLog.create({
    _id: id,
    superAdminUserId,
    companyId,
    reason,
    startedAt: new Date(),
    endedAt: null,
  });

  const store = await cookies();
  store.set(ACT_AS_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ACT_AS_MAX_AGE_SECONDS,
    path: "/",
  });

  return id;
}

/** Ends the current act-as session (if any) and clears the cookie. Safe to call with no active session. */
export async function endActAsSession(superAdminUserId: number): Promise<void> {
  const store = await cookies();
  const token = store.get(ACT_AS_COOKIE)?.value;
  if (token) {
    await connectMongoDB();
    await PlatformAccessLog.updateOne({ _id: token, superAdminUserId, endedAt: null }, { $set: { endedAt: new Date() } });
  }
  store.delete(ACT_AS_COOKIE);
}
