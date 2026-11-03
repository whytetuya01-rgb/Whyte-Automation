import { CALENDAR_SCOPE, GOOGLE_CALENDAR_SCOPES, type GoogleCalendarConfig } from "./config";

/**
 * A thin client for the Google endpoints the integration uses (OAuth code flow, token refresh and revoke, calendars.insert,
 * calendars.delete, events.insert, events.patch, events.delete). It decides nothing about the CRM: it only turns every
 * failure into one of a few kinds, so the sync code can choose between "retry later", "ask the person to reconnect",
 * "this item is gone in Google" and "this item can never be sent".
 */

export type GoogleErrorKind =
  | "network" //   could not reach Google, or it timed out: retry
  | "rate" //      429 / quota: retry after the delay Google asked for
  | "server" //    5xx: retry
  | "auth" //      the access token was refused (401): refresh once; or the refresh token is no good (invalid_grant): reconnect
  | "not_found" // 404 / 410
  | "conflict" //  409: an event with this id already exists
  | "invalid"; //  400 / 403 (not quota): sending this again cannot succeed

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly kind: GoogleErrorKind,
    readonly status: number | null,
    readonly reason: string | null = null,
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "rate" || this.kind === "server";
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const QUOTA_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "backendError", "dailyLimitExceeded"]);

function classify(status: number, body: unknown, retryAfter: string | null): GoogleApiError {
  const error = (body as { error?: unknown } | null)?.error;
  const reason =
    typeof error === "string"
      ? error
      : (error as { errors?: Array<{ reason?: string }>; status?: string } | undefined)?.errors?.[0]?.reason ?? (error as { status?: string } | undefined)?.status ?? null;
  const message = typeof error === "string" ? error : (error as { message?: string } | undefined)?.message ?? `Google answered ${status}`;
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 3600) * 1000 : null;
  if (status === 429 || (status === 403 && reason && QUOTA_REASONS.has(reason))) return new GoogleApiError(message, "rate", status, reason, retryAfterMs);
  if (status >= 500) return new GoogleApiError(message, "server", status, reason, retryAfterMs);
  if (status === 401 || reason === "invalid_grant" || reason === "invalid_token") return new GoogleApiError(message, "auth", status, reason);
  if (status === 404 || status === 410) return new GoogleApiError(message, "not_found", status, reason);
  if (status === 409) return new GoogleApiError(message, "conflict", status, reason);
  return new GoogleApiError(message, "invalid", status, reason);
}

async function call(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) throw classify(response.status, body, response.headers.get("retry-after"));
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof GoogleApiError) throw error;
    throw new GoogleApiError(error instanceof Error && error.name === "AbortError" ? "Google did not answer in time." : "Could not reach Google.", "network", null);
  } finally {
    clearTimeout(timer);
  }
}

const form = (values: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
});

// ── OAuth ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function buildAuthUrl(cfg: GoogleCalendarConfig, input: { state: string; challenge?: string | null; loginHint?: string | null }): string {
  const url = new URL(cfg.authUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline"); // a refresh token, so syncing works while the person is away
  url.searchParams.set("prompt", "consent"); //     and Google really issues one on every connect
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);
  if (input.challenge) {
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  scopes: string[];
  idToken: string | null;
}

function toTokenSet(body: unknown): TokenSet {
  const data = body as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string } | null;
  if (!data?.access_token) throw new GoogleApiError("Google did not return an access token.", "invalid", 200);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSec: typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600,
    scopes: (data.scope ?? "").split(/\s+/).filter(Boolean),
    idToken: data.id_token ?? null,
  };
}

export async function exchangeCode(cfg: GoogleCalendarConfig, input: { code: string; verifier?: string | null }): Promise<TokenSet> {
  const { body } = await call(cfg.tokenUrl, form({
    code: input.code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
    ...(input.verifier ? { code_verifier: input.verifier } : {}),
  }));
  return toTokenSet(body);
}

export async function refreshAccessToken(cfg: GoogleCalendarConfig, refreshToken: string): Promise<TokenSet> {
  const { body } = await call(cfg.tokenUrl, form({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }));
  return toTokenSet(body);
}

/** Best effort: telling Google to forget the grant. A failure here never blocks disconnecting. */
export async function revokeToken(cfg: GoogleCalendarConfig, token: string): Promise<boolean> {
  try {
    await call(cfg.revokeUrl, form({ token }));
    return true;
  } catch {
    return false;
  }
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Reads the identity out of the ID token Google returned directly from its token endpoint over HTTPS (so, as Google's
 * documentation allows, its signature need not be re-verified), and checks the claims that matter: issuer, audience (this
 * app), expiry and a stable subject.
 */
export function readIdentity(idToken: string | null, cfg: GoogleCalendarConfig, now: Date = new Date()): GoogleIdentity {
  const bad = (why: string) => new GoogleApiError(`The Google sign-in could not be verified (${why}).`, "invalid", null);
  if (!idToken) throw bad("no identity returned");
  let claims: { iss?: string; aud?: string | string[]; exp?: number; sub?: string; email?: string; email_verified?: boolean | string };
  try {
    claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    throw bad("unreadable identity");
  }
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw bad("wrong issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(cfg.clientId)) throw bad("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now.getTime()) throw bad("expired");
  if (!claims.sub || !claims.email) throw bad("missing account");
  return { sub: claims.sub, email: claims.email.toLowerCase(), emailVerified: claims.email_verified === true || claims.email_verified === "true" };
}

/** True when the granted scopes include what calendar access needs (Google lets people untick scopes on the consent screen). */
export const grantsCalendarAccess = (scopes: readonly string[]) => scopes.includes(CALENDAR_SCOPE);

// ── Calendar ──────────────────────────────────────────────────────────────────────────────────────────────────────

const json = (method: string, token: string, body?: unknown): RequestInit => ({
  method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface GoogleEventBody {
  id?: string;
  summary: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
  status?: "confirmed" | "cancelled";
  transparency?: "opaque" | "transparent";
  reminders?: { useDefault: boolean };
  extendedProperties?: { private: Record<string, string> };
}

export async function insertCalendar(cfg: GoogleCalendarConfig, token: string, input: { summary: string; description: string; timeZone?: string | null }): Promise<{ id: string; summary: string }> {
  const { body } = await call(`${cfg.apiBase}/calendars`, json("POST", token, { summary: input.summary, description: input.description, ...(input.timeZone ? { timeZone: input.timeZone } : {}) }));
  const data = body as { id?: string; summary?: string } | null;
  if (!data?.id) throw new GoogleApiError("Google did not return the new calendar.", "invalid", 200);
  return { id: data.id, summary: data.summary ?? input.summary };
}

export async function deleteCalendar(cfg: GoogleCalendarConfig, token: string, calendarId: string): Promise<void> {
  await call(`${cfg.apiBase}/calendars/${encodeURIComponent(calendarId)}`, json("DELETE", token));
}

const eventUrl = (cfg: GoogleCalendarConfig, calendarId: string, eventId?: string) =>
  `${cfg.apiBase}/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;

export async function insertEvent(cfg: GoogleCalendarConfig, token: string, calendarId: string, event: GoogleEventBody): Promise<{ id: string }> {
  const { body } = await call(eventUrl(cfg, calendarId), json("POST", token, event));
  return { id: (body as { id?: string } | null)?.id ?? event.id ?? "" };
}

export async function patchEvent(cfg: GoogleCalendarConfig, token: string, calendarId: string, eventId: string, event: Partial<GoogleEventBody>): Promise<void> {
  await call(eventUrl(cfg, calendarId, eventId), json("PATCH", token, event));
}

export async function deleteEvent(cfg: GoogleCalendarConfig, token: string, calendarId: string, eventId: string): Promise<void> {
  await call(eventUrl(cfg, calendarId, eventId), json("DELETE", token));
}
