import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { connectMongoDB } from "@/lib/mongodb";
import { CalendarFeed, Lead } from "@/models";
import { crmVisibilityFilter, scopedQuery } from "@/lib/crmService";
import type { FollowUpCalendarEvent } from "@/lib/followUps";

/**
 * Each person's private follow-up calendar link (see models/CalendarFeed.ts). Server only.
 *
 * The link holds a random secret. The database keeps its SHA-256 (to find the feed) and an encrypted copy so the person
 * can copy the same link again; the encryption key comes from the server secret, so a database copy alone reveals no
 * working link. Generating a new link or turning it off removes the old secret.
 */

export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,60}$/;

/** The calendar shows follow-ups from this long ago (so a just-missed one stays visible) up to a year ahead. */
const FEED_LOOK_BACK_DAYS = 30;
const FEED_LOOK_AHEAD_DAYS = 365;
export const FEED_MAX_EVENTS = 500;

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sealingKey(): Buffer | null {
  const secret = process.env.NEXTAUTH_SECRET;
  return secret ? createHash("sha256").update(`calendar-feed:${secret}`).digest() : null;
}

export function sealFeedToken(token: string): string | null {
  const key = sealingKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function openFeedToken(sealed: string | null | undefined): string | null {
  const key = sealingKey();
  if (!key || !sealed) return null;
  try {
    const [iv, tag, data] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
    if (!iv || !tag || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function baseUrlFor(req: Request): string {
  return (process.env.NEXTAUTH_URL || new URL(req.url).origin).replace(/\/+$/, "");
}

export function feedUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/api/calendar/follow-ups/${token}.ics`;
}

/** Google can only fetch a link that is reachable from the internet over https. */
export function isPubliclyReachable(baseUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(baseUrl);
    return protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(hostname) && !hostname.endsWith(".local");
  } catch {
    return false;
  }
}

export interface FeedState {
  enabled: boolean;
  url: string | null;
  lastFetchedAt: Date | null;
  fetchCount: number;
  createdAt: Date | null;
  publiclyReachable: boolean;
}

/** Must run in the person's company context. */
export async function getFeedState(companyId: number, userId: number, baseUrl: string): Promise<FeedState> {
  await connectMongoDB();
  const feed = await CalendarFeed.findOne({ companyId, userId }).lean();
  const token = feed?.tokenHash ? openFeedToken(feed.tokenSealed) : null;
  return {
    enabled: Boolean(feed?.tokenHash),
    url: token ? feedUrl(token, baseUrl) : null,
    lastFetchedAt: feed?.lastFetchedAt ?? null,
    fetchCount: feed?.fetchCount ?? 0,
    createdAt: feed?.createdAt ?? null,
    publiclyReachable: isPubliclyReachable(baseUrl),
  };
}

/** Creates the person's link, or replaces it with a new one (the old link stops working immediately). */
export async function enableFeed(companyId: number, userId: number, baseUrl: string): Promise<FeedState> {
  await connectMongoDB();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const secret = { tokenHash: hashFeedToken(token), tokenSealed: sealFeedToken(token), revokedAt: null, rotatedAt: now };
  // Not an upsert: the tenant layer already adds the company to every filter, and MongoDB refuses an upsert that names it twice.
  const updated = await CalendarFeed.findOneAndUpdate({ companyId, userId }, { $set: secret }, { returnDocument: "after" });
  if (!updated) {
    try {
      await CalendarFeed.create({ _id: `cf_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`, companyId, userId, ...secret, createdAt: now, fetchCount: 0, lastFetchedAt: null });
    } catch (error) {
      // Two requests created the person's feed at once (the unique index allows one): the other one stands; replace its secret.
      if ((error as { code?: unknown }).code !== 11000) throw error;
      await CalendarFeed.updateOne({ companyId, userId }, { $set: secret });
    }
  }
  return getFeedState(companyId, userId, baseUrl);
}

export async function disableFeed(companyId: number, userId: number): Promise<void> {
  await connectMongoDB();
  await CalendarFeed.updateOne({ companyId, userId }, { $set: { tokenHash: null, tokenSealed: null, revokedAt: new Date() } });
}

/**
 * The follow-ups one person sees in their calendar: open leads (not won or lost) with a follow-up date, limited to the
 * leads that person may see in the CRM. Must run in that person's company context.
 */
export async function loadFollowUpEvents(params: { companyId: number; userId: number; role: string; baseUrl: string; now?: Date }): Promise<FollowUpCalendarEvent[]> {
  const now = params.now ?? new Date();
  await connectMongoDB();
  const from = new Date(now.getTime() - FEED_LOOK_BACK_DAYS * 24 * 3600 * 1000);
  const to = new Date(now.getTime() + FEED_LOOK_AHEAD_DAYS * 24 * 3600 * 1000);
  const query = scopedQuery(params.companyId, crmVisibilityFilter({ role: params.role, userId: params.userId }), [
    { status: { $nin: ["won", "lost"] } },
    { nextFollowUpAt: { $gte: from, $lte: to } },
  ]);
  const leads = await Lead.find(query)
    .select("referenceNumber customerName phone projectType location priority status nextFollowUpAt updatedAt")
    .sort({ nextFollowUpAt: 1, _id: 1 })
    .limit(FEED_MAX_EVENTS)
    .lean();
  const openUrl = `${params.baseUrl}/admin/crm/follow-ups`;
  return leads.map((lead) => ({
    lead: {
      id: String(lead._id),
      referenceNumber: lead.referenceNumber,
      customerName: lead.customerName,
      phone: lead.phone,
      projectType: lead.projectType,
      location: lead.location,
      priority: lead.priority,
      status: lead.status,
    },
    due: new Date(lead.nextFollowUpAt as Date),
    updatedAt: new Date(lead.updatedAt ?? lead.nextFollowUpAt ?? now),
    openUrl,
  }));
}
