/**
 * Google Calendar integration building blocks, with no database: token encryption, config safety, the event mapper (the
 * privacy rule), deterministic event ids, backoff, ID-token checks, and how the client classifies Google's answers
 * (against the mock Google server on loopback).
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/google-calendar-core.test.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { googleCalendarConfig, CALENDAR_SCOPE } from "../src/lib/googleCalendar/config";
import { needsResealing, openToken, sealToken } from "../src/lib/googleCalendar/crypto";
import { buildEventBody, chooseEventMinutes, eventIdFor } from "../src/lib/googleCalendar/eventMapper";
import { backoffMs, MAX_ATTEMPTS } from "../src/lib/googleCalendar/sync";
import { GoogleApiError, buildAuthUrl, deleteEvent, exchangeCode, grantsCalendarAccess, insertCalendar, insertEvent, patchEvent, readIdentity, refreshAccessToken, revokeToken } from "../src/lib/googleCalendar/client";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createMockGoogle } = require("./helpers/mockGoogle.cjs");

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const key = () => randomBytes(32).toString("base64");

async function main() {
  // ── encryption ──
  const env = { GOOGLE_CALENDAR_TOKEN_KEY: key() } as unknown as NodeJS.ProcessEnv;
  const sealed = sealToken("1//refresh-token-value", "refresh:gcc_1_2", env);
  assert.ok(!sealed.includes("refresh-token-value"), "the token is not readable in the stored value");
  assert.match(sealed, /^v1\.[0-9a-f]{8}\.[\w-]+\.[\w-]+\.[\w-]*$/);
  assert.equal(openToken(sealed, "refresh:gcc_1_2", env), "1//refresh-token-value");
  assert.notEqual(sealToken("same", "a", env), sealToken("same", "a", env), "a fresh random IV every time");
  assert.throws(() => openToken(sealed, "refresh:gcc_1_3", env), /could not be opened/, "sealed to one record: cannot be moved to another");
  assert.throws(() => openToken(sealed, "access:gcc_1_2", env), /could not be opened/, "or used for another purpose");
  const parts = sealed.split(".");
  const flipped = [...parts.slice(0, 4), Buffer.from(Buffer.from(parts[4], "base64url").map((byte, i) => (i === 0 ? byte ^ 1 : byte))).toString("base64url")].join(".");
  assert.throws(() => openToken(flipped, "refresh:gcc_1_2", env), /could not be opened/, "tampering is detected");
  assert.throws(() => openToken(sealed, "refresh:gcc_1_2", { GOOGLE_CALENDAR_TOKEN_KEY: key() } as unknown as NodeJS.ProcessEnv), /No key matches/, "another key cannot open it");
  assert.throws(() => sealToken("x", "a", {} as unknown as NodeJS.ProcessEnv), /GOOGLE_CALENDAR_TOKEN_KEY/, "no key, no sealing (never a silent plaintext)");
  assert.throws(() => sealToken("x", "a", { GOOGLE_CALENDAR_TOKEN_KEY: Buffer.from("short").toString("base64") } as unknown as NodeJS.ProcessEnv), /32/, "a weak key is refused");
  const next = key();
  const rotated = { GOOGLE_CALENDAR_TOKEN_KEY: next, GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS: env.GOOGLE_CALENDAR_TOKEN_KEY } as unknown as NodeJS.ProcessEnv;
  assert.equal(openToken(sealed, "refresh:gcc_1_2", rotated), "1//refresh-token-value", "after a key rotation the old value still opens while the old key is kept");
  assert.equal(needsResealing(sealed, rotated), true);
  assert.equal(needsResealing(sealToken("x", "a", rotated), rotated), false);
  pass("tokens are AES-256-GCM sealed to their record and purpose; tampering, wrong keys and weak keys are refused; keys can be rotated");

  // ── config ──
  const full = { GOOGLE_CALENDAR_CLIENT_ID: "id", GOOGLE_CALENDAR_CLIENT_SECRET: "secret", GOOGLE_CALENDAR_REDIRECT_URI: "https://crm.example.com/cb", GOOGLE_CALENDAR_TOKEN_KEY: key() } as unknown as NodeJS.ProcessEnv;
  assert.equal(googleCalendarConfig({} as unknown as NodeJS.ProcessEnv).configured, false, "nothing configured by default");
  assert.equal(googleCalendarConfig({ ...full, GOOGLE_CALENDAR_TOKEN_KEY: "" } as unknown as NodeJS.ProcessEnv).configured, false, "no key, not configured");
  assert.equal(googleCalendarConfig({ ...full, GOOGLE_CALENDAR_CLIENT_SECRET: "" } as unknown as NodeJS.ProcessEnv).configured, false);
  const real = googleCalendarConfig(full);
  assert.equal(real.configured, true);
  assert.deepEqual([real.authUrl, real.tokenUrl, real.revokeUrl, real.apiBase], ["https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", "https://oauth2.googleapis.com/revoke", "https://www.googleapis.com/calendar/v3"]);
  const hijack = googleCalendarConfig({ ...full, GOOGLE_CALENDAR_TOKEN_URL: "https://evil.example.com/token", GOOGLE_CALENDAR_API_BASE: "http://evil.example.com/v3", GOOGLE_CALENDAR_AUTH_URL: "http://127.0.0.1.evil.com/auth" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual([hijack.tokenUrl, hijack.apiBase, hijack.authUrl], [real.tokenUrl, real.apiBase, real.authUrl], "an endpoint override anywhere but loopback http is ignored");
  assert.equal(googleCalendarConfig({ ...full, GOOGLE_CALENDAR_TOKEN_URL: "http://127.0.0.1:9999/token" } as unknown as NodeJS.ProcessEnv).tokenUrl, "http://127.0.0.1:9999/token");
  assert.equal(googleCalendarConfig({ ...full, GOOGLE_CALENDAR_PKCE: "0" } as unknown as NodeJS.ProcessEnv).usePkce, false);
  assert.equal(real.usePkce, true);
  pass("the integration is off until fully configured, and an endpoint can be redirected only to loopback (the test mock), never away from Google");

  // ── consent URL ──
  const url = new URL(buildAuthUrl(real, { state: "S", challenge: "C" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), `openid email ${CALENDAR_SCOPE}`, "exactly the scopes that were validated, nothing broader");
  assert.deepEqual(["access_type", "prompt", "response_type", "code_challenge_method", "include_granted_scopes"].map((k) => url.searchParams.get(k)), ["offline", "consent", "code", "S256", "false"]);
  assert.equal(grantsCalendarAccess(["openid", "email"]), false, "unticking the calendar box on Google's screen is detected");
  assert.equal(grantsCalendarAccess(["openid", CALENDAR_SCOPE]), true);
  pass("the consent URL asks for exactly openid, email and calendar.app.created, offline, with PKCE and a state");

  // ── event mapper ──
  const id = eventIdFor("gcc_1_2", "ft_abc");
  assert.match(id, /^[a-v0-9]{26}$/, "Google's id alphabet (a-v, 0-9), 5-1024 long");
  assert.equal(id, eventIdFor("gcc_1_2", "ft_abc"), "the same follow-up always gets the same id");
  assert.notEqual(id, eventIdFor("gcc_1_3", "ft_abc"), "another person's calendar, another id");
  assert.notEqual(id, eventIdFor("gcc_1_2", "ft_abd"));
  assert.equal(new Set(Array.from({ length: 500 }, (_, i) => eventIdFor("gcc_1_2", `ft_${i}`))).size, 500, "no collisions");
  const input = { taskId: "ft_abc", referenceNumber: "LD-2026-0007", customerName: "Rahul Mehta", priority: "high", dueAt: new Date("2026-11-10T04:30:00Z"), completed: false, minutes: 45, timeZone: "Asia/Kolkata", appBaseUrl: "https://crm.example.com" };
  const body = buildEventBody(id, input);
  assert.deepEqual([body.id, body.summary, body.start.dateTime, body.end.dateTime, body.transparency], [id, "Follow-up: Rahul Mehta", "2026-11-10T04:30:00.000Z", "2026-11-10T05:15:00.000Z", "opaque"]);
  assert.match(body.description, /Lead LD-2026-0007 · Priority: High/);
  assert.match(body.description, /https:\/\/crm\.example\.com\/admin\/crm\/follow-ups/);
  assert.deepEqual(body.extendedProperties, { private: { whyteTaskId: "ft_abc" } });
  const done = buildEventBody(id, { ...input, completed: true });
  assert.deepEqual([done.summary, done.transparency], ["✓ Follow-up: Rahul Mehta", "transparent"]);
  assert.equal(buildEventBody(id, { ...input, appBaseUrl: null }).description.includes("http"), false, "no link when the app URL is not configured");
  assert.deepEqual([chooseEventMinutes(60), chooseEventMinutes(7), chooseEventMinutes("30"), chooseEventMinutes(undefined)], [60, 30, 30, 30]);
  // the privacy rule: even if richer data existed, the mapper has no way to include it
  const leaky = { ...input, phone: "9876543210", notes: "customer will pay 4,50,000", location: "Surat", projectType: "3 BHK", estimatedBudget: 450000 };
  const text = JSON.stringify(buildEventBody(id, leaky as typeof input));
  for (const secret of ["9876543210", "4,50,000", "Surat", "3 BHK", "450000"]) assert.ok(!text.includes(secret), `${secret} must never reach Google`);
  pass("an event carries only the customer's name, the reference, priority and time (never phone, notes, place, project or money); ids are deterministic and collision-free");

  // ── backoff ──
  const lo = () => 0, hi = () => 0.999;
  assert.equal(backoffMs(1, null, () => 0.5), 30_000);
  assert.ok(backoffMs(1, null, lo) >= 24_000 && backoffMs(1, null, hi) <= 36_000, "±20% jitter");
  assert.ok(backoffMs(2, null, () => 0.5) === 60_000 && backoffMs(3, null, () => 0.5) === 120_000, "doubles");
  assert.equal(backoffMs(30, null, () => 0.5), 6 * 3600_000, "capped at six hours");
  assert.equal(backoffMs(1, 90_000, lo), 90_000, "never sooner than Google asked");
  assert.ok(MAX_ATTEMPTS >= 5);
  pass("retry delays grow exponentially with jitter, are capped, and respect Retry-After");

  // ── ID token ──
  const idToken = (claims: Record<string, unknown>) => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
  const good = { iss: "https://accounts.google.com", aud: real.clientId, sub: "1234", email: "Rahul@Example.com", email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 };
  assert.deepEqual(readIdentity(idToken(good), real), { sub: "1234", email: "rahul@example.com", emailVerified: true });
  assert.equal(readIdentity(idToken({ ...good, iss: "accounts.google.com" }), real).sub, "1234");
  for (const [label, claims] of [["wrong issuer", { ...good, iss: "https://evil.example.com" }], ["wrong audience", { ...good, aud: "someone-else" }], ["expired", { ...good, exp: Math.floor(Date.now() / 1000) - 5 }], ["no subject", { ...good, sub: undefined }], ["no email", { ...good, email: undefined }]] as const) {
    assert.throws(() => readIdentity(idToken(claims), real), /could not be verified/, label);
  }
  assert.throws(() => readIdentity(null, real), /could not be verified/);
  assert.throws(() => readIdentity("garbage", real), /could not be verified/);
  assert.equal(readIdentity(idToken({ ...good, email_verified: false }), real).emailVerified, false);
  pass("the Google identity is accepted only with the right issuer, audience (this app), expiry, subject and email");

  // ── how Google's answers are classified ──
  const mock = createMockGoogle();
  await mock.start();
  const cfg = googleCalendarConfig({ ...mock.env(), GOOGLE_CALENDAR_TOKEN_KEY: key() } as unknown as NodeJS.ProcessEnv);
  try {
    const account = { email: "a@example.com", sub: "sub-a" };
    const consent = buildAuthUrl(cfg, { state: "state-1", challenge: Buffer.from(require("node:crypto").createHash("sha256").update("verifier-1").digest()).toString("base64url") });
    const approved = mock.authorize(consent, account);
    await assert.rejects(exchangeCode(cfg, { code: approved.code, verifier: "wrong-verifier" }), (e: unknown) => e instanceof GoogleApiError && e.kind === "auth" && e.reason === "invalid_grant", "PKCE: a wrong verifier is refused");
    const approved2 = mock.authorize(consent, account);
    const tokens = await exchangeCode(cfg, { code: approved2.code, verifier: "verifier-1" });
    assert.ok(tokens.refreshToken && tokens.accessToken && grantsCalendarAccess(tokens.scopes));
    await assert.rejects(exchangeCode(cfg, { code: approved2.code, verifier: "verifier-1" }), GoogleApiError, "a code works once");

    const refreshed = await refreshAccessToken(cfg, tokens.refreshToken as string);
    assert.ok(refreshed.accessToken && refreshed.accessToken !== tokens.accessToken);
    const calendar = await insertCalendar(cfg, refreshed.accessToken, { summary: "Whyte CRM Follow-ups", description: "d", timeZone: "Asia/Kolkata" });
    const event = (eventId: string) => ({ id: eventId, summary: "s", description: "d", start: { dateTime: "2026-11-10T04:30:00.000Z" }, end: { dateTime: "2026-11-10T05:00:00.000Z" } });
    await insertEvent(cfg, refreshed.accessToken, calendar.id, event("aaaaa1"));
    const kind = async (promise: Promise<unknown>) => promise.then(() => "ok", (e) => (e instanceof GoogleApiError ? `${e.kind}${e.retryAfterMs ? `:${e.retryAfterMs}` : ""}` : "other"));
    assert.equal(await kind(insertEvent(cfg, refreshed.accessToken, calendar.id, event("aaaaa1"))), "conflict", "409: the same id again");
    assert.equal(await kind(patchEvent(cfg, refreshed.accessToken, calendar.id, "nothere1", {})), "not_found");
    assert.equal(await kind(deleteEvent(cfg, refreshed.accessToken, calendar.id, "aaaaa1")), "ok");
    assert.equal(await kind(deleteEvent(cfg, refreshed.accessToken, calendar.id, "aaaaa1")), "not_found", "410 gone counts as not found");
    assert.equal(await kind(insertEvent(cfg, refreshed.accessToken, calendar.id, event("aaaaa1"))), "conflict", "a deleted event's id still conflicts");
    assert.equal(await kind(insertEvent(cfg, refreshed.accessToken, "no-such-calendar", event("bbbbb1"))), "not_found");
    assert.equal(await kind(insertEvent(cfg, "stale-token", calendar.id, event("ccccc1"))), "auth", "401");
    assert.equal(await kind(insertEvent(cfg, refreshed.accessToken, calendar.id, event("BAD ID"))), "invalid", "400");
    mock.fail((r: { path: string }) => r.path.endsWith("/events"), { status: 503 }, 1);
    assert.equal(await kind(insertEvent(cfg, refreshed.accessToken, calendar.id, event("ddddd1"))), "server", "5xx");
    mock.fail((r: { path: string }) => r.path.endsWith("/events"), { status: 429, headers: { "Retry-After": "7" } }, 1);
    assert.equal(await kind(insertEvent(cfg, refreshed.accessToken, calendar.id, event("ddddd1"))), "rate:7000", "429 with Retry-After");
    mock.fail((r: { path: string }) => r.path.endsWith("/events"), { status: 403, reason: "userRateLimitExceeded" }, 1);
    assert.equal(await kind(insertEvent(cfg, refreshed.accessToken, calendar.id, event("ddddd1"))), "rate", "403 for quota is a rate limit, not a refusal");
    mock.fail((r: { path: string }) => r.path.endsWith("/events"), { status: 403, reason: "forbidden" }, 1);
    assert.equal(await kind(insertEvent(cfg, refreshed.accessToken, calendar.id, event("ddddd1"))), "invalid", "any other 403 will not succeed by retrying");
    mock.clearFailures();
    assert.equal(new GoogleApiError("x", "rate", 429).retryable && new GoogleApiError("x", "server", 500).retryable && new GoogleApiError("x", "network", null).retryable, true);
    assert.equal(new GoogleApiError("x", "invalid", 400).retryable || new GoogleApiError("x", "conflict", 409).retryable, false);

    assert.equal(await revokeToken(cfg, tokens.refreshToken as string), true);
    await assert.rejects(refreshAccessToken(cfg, tokens.refreshToken as string), (e: unknown) => e instanceof GoogleApiError && e.kind === "auth" && e.reason === "invalid_grant", "a revoked grant cannot refresh");
  } finally {
    await mock.stop();
  }
  const dead = googleCalendarConfig({ ...mock.env(), GOOGLE_CALENDAR_TOKEN_KEY: key() } as unknown as NodeJS.ProcessEnv);
  await assert.rejects(refreshAccessToken(dead, "x"), (e: unknown) => e instanceof GoogleApiError && e.kind === "network" && e.retryable, "an unreachable Google is a retryable network error");
  pass("Google's answers are classified correctly: PKCE, single-use codes, revoked grants, 401/404/409/410, 400, quota 403 vs real 403, 429 + Retry-After, 5xx, unreachable");

  console.log(`\nALL ${count} GOOGLE CALENDAR CORE TESTS PASSED!`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
