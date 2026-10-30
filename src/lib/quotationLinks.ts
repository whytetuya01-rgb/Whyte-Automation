import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { IQuotationDeliveryDocument } from "@/models/QuotationDelivery";
import { pushDeliveryEvent } from "@/lib/quotationDelivery";
import { DELIVERY_MAX_ATTEMPTS, QuotationDelivery } from "@/models/QuotationDelivery";
import { runUnscoped, runWithTenantContext } from "@/lib/tenant/context";
import { toDeliveryDto, type QuotationDeliveryDto } from "@/lib/quotationDeliveryShared";

/**
 * Secure view links for sent quotations: `/q/<token>` shows the exact PDF that was sent and records when the client
 * opens it ("Viewed"). Server-only.
 *
 * The token is 32 random bytes. The database holds its SHA-256 (to find the delivery) and an AES-256-GCM sealed
 * copy (so the sender can copy the same link again); the key is derived from NEXTAUTH_SECRET, so a database copy on
 * its own does not reveal any working link.
 */

export const LINK_TTL_DAYS = 90;

export interface IssuedLink {
  token: string;
  tokenHash: string;
  sealed: string | null;
  expiresAt: Date;
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sealingKey(): Buffer | null {
  const secret = process.env.NEXTAUTH_SECRET;
  return secret ? createHash("sha256").update(`quotation-view-link:${secret}`).digest() : null;
}

/** AES-256-GCM: iv.tag.ciphertext (base64url). null when no key is configured. */
export function sealToken(token: string): string | null {
  const key = sealingKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

/** The token back from its sealed copy, or null (no key, another key, or tampered data). */
export function openToken(sealed: string | null | undefined): string | null {
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

export function issueLink(now = new Date()): IssuedLink {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLinkToken(token), sealed: sealToken(token), expiresAt: new Date(now.getTime() + LINK_TTL_DAYS * 24 * 3600 * 1000) };
}

export function isLinkTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(token);
}

export function quotationLinkUrl(token: string): string {
  return new URL(`/q/${token}`, process.env.NEXTAUTH_URL || "http://localhost:3000").toString();
}

/** The link for a delivery, if it can still be shown (sealed copy readable, not revoked). */
export function linkUrlFor(delivery: { viewTokenSealed?: string | null; viewRevokedAt?: Date | null }): string | null {
  if (delivery.viewRevokedAt) return null;
  const token = openToken(delivery.viewTokenSealed);
  return token ? quotationLinkUrl(token) : null;
}

export type LinkState = "active" | "expired" | "revoked" | "none";

export function linkState(delivery: { viewTokenHash?: string | null; viewExpiresAt?: Date | null; viewRevokedAt?: Date | null }, now = new Date()): LinkState {
  if (!delivery.viewTokenHash) return "none";
  if (delivery.viewRevokedAt) return "revoked";
  if (!delivery.viewExpiresAt || delivery.viewExpiresAt.getTime() < now.getTime()) return "expired";
  return "active";
}

/**
 * Link-preview fetchers (WhatsApp, Facebook, Slack, search engines…) open links on their own. Views are recorded by
 * the page's script, which these do not run, and this check is a second guard on the server.
 */
export function isPreviewBot(userAgent: string | null | undefined): boolean {
  // Every real browser (and in-app browser) identifies as "Mozilla/5.0 …"; scripts, curl and fetch libraries do not.
  if (!userAgent || !/^Mozilla\//.test(userAgent)) return true;
  return /whatsapp|facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|yandex|baiduspider|duckduckbot|applebot|embedly|pinterest|crawler|spider|bot\b|preview|headless/i.test(userAgent);
}

/**
 * Records one view of the link on the delivery (not saved here). The first view moves the delivery to "read"
 * (shown as "Viewed"); status never moves backwards and a failed delivery stays failed.
 */
export function recordLinkView(delivery: IQuotationDeliveryDocument, at = new Date()): void {
  delivery.viewCount = (delivery.viewCount ?? 0) + 1;
  delivery.lastViewedAt = at;
  if (delivery.status !== "failed" && delivery.status !== "read") {
    delivery.status = "read";
    delivery.deliveredAt = delivery.deliveredAt ?? at;
  }
  delivery.readAt = delivery.readAt ?? at;
  // One timeline entry for the first view, then at most one per hour, so repeated opens do not flood the history.
  const lastViewEvent = [...delivery.events].reverse().find((event) => event.type === "viewed");
  if (!lastViewEvent || at.getTime() - new Date(lastViewEvent.at).getTime() > 3600 * 1000) {
    pushDeliveryEvent(delivery, "viewed", delivery.viewCount === 1 ? "The client opened the quotation link." : `Opened again (${delivery.viewCount} views).`, at);
  }
}

/** A delivery as the browser sees it, with its link state and (while active) the URL to copy. */
export function deliveryDto(doc: Parameters<typeof toDeliveryDto>[0] & { viewTokenHash?: string | null; viewTokenSealed?: string | null; viewExpiresAt?: Date | null; viewRevokedAt?: Date | null }): QuotationDeliveryDto {
  const state = linkState(doc);
  return toDeliveryDto(doc, DELIVERY_MAX_ATTEMPTS, { state, url: state === "active" ? linkUrlFor(doc) : null });
}

export interface LinkTarget {
  deliveryId: string;
  companyId: number;
  quotationId: string;
  state: LinkState;
}

/**
 * The delivery a public link token belongs to (exact hash match only), found with a logged unscoped lookup. Every
 * further read or write then runs inside that delivery's own company (see `inLinkCompany`).
 */
export async function findLinkTarget(token: string): Promise<LinkTarget | null> {
  if (!isLinkTokenShape(token)) return null;
  const tokenHash = hashLinkToken(token);
  const found = await runUnscoped("public-quotation-link", async () =>
    await QuotationDelivery.findOne({ viewTokenHash: tokenHash })
      .select("_id companyId quotationId viewTokenHash viewExpiresAt viewRevokedAt")
      .lean<{ _id: string; companyId: number; quotationId: string; viewTokenHash: string | null; viewExpiresAt: Date | null; viewRevokedAt: Date | null } | null>()
  );
  if (!found) return null;
  return { deliveryId: found._id, companyId: found.companyId, quotationId: found.quotationId, state: linkState(found) };
}

/** Runs `fn` inside the link's company (no user: reads/writes are limited to that company's data). */
export function inLinkCompany<T>(target: LinkTarget, fn: () => Promise<T>): Promise<T> {
  return runWithTenantContext({ companyId: target.companyId, userId: 0, role: "system", actingAsCompany: false }, fn);
}
