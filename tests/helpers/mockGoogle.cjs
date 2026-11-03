/**
 * A stand-in for the Google endpoints the integration uses, on a loopback port. Used only by tests; the app accepts a
 * non-Google endpoint only at a loopback address (src/lib/googleCalendar/config.ts).
 *
 * It behaves like Google where it matters to the sync code: OAuth code flow with PKCE (S256), granted-scope reporting,
 * ID tokens, refresh tokens that can be revoked (invalid_grant), expiring access tokens (401), calendars, events with
 * caller-chosen ids (409 on a duplicate id, also for deleted events), 404/410 for missing ones, plus failure injection
 * (503, 429 with Retry-After, 400 ...). Every request is logged so tests can assert on what was sent.
 */
const http = require("node:http");
const crypto = require("node:crypto");

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

function createMockGoogle({ clientId = "mock-client-id.apps.googleusercontent.com", clientSecret = "mock-client-secret" } = {}) {
  const state = {
    codes: new Map(), //          code -> { email, sub, scopes, challenge, redirectUri, refresh }
    refreshTokens: new Map(), //  refresh token -> { email, sub, revoked }
    accessTokens: new Map(), //   access token -> { refresh, expiresAt }
    calendars: new Map(), //      id -> { summary, timeZone, events: Map(id -> event) }
    log: [], //                   { method, path, body, auth }
    failures: [], //              [{ match(req) => bool, times, status, body, headers }]
    accessTtlSec: 3600,
    nextId: 1,
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => resolve(raw));
    });
  const send = (res, status, body, headers = {}) => {
    const text = body === undefined || body === null ? "" : JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(text);
  };

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const raw = await readBody(req);
    const isForm = (req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded");
    const body = raw ? (isForm ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw)) : null;
    const entry = { method: req.method, path: url.pathname, body, auth: req.headers.authorization ?? null };
    state.log.push(entry);

    for (const failure of state.failures) {
      if (failure.times > 0 && failure.match(entry)) {
        failure.times -= 1;
        return send(res, failure.status, failure.body ?? { error: { code: failure.status, message: "injected failure", errors: [{ reason: failure.reason ?? "backendError" }] } }, failure.headers);
      }
    }

    // ── OAuth ──
    if (url.pathname === "/token" && req.method === "POST") {
      if (body.client_id !== clientId || body.client_secret !== clientSecret) return send(res, 401, { error: "invalid_client" });
      if (body.grant_type === "authorization_code") {
        const grant = state.codes.get(body.code);
        if (!grant) return send(res, 400, { error: "invalid_grant" });
        state.codes.delete(body.code); // single use
        if (body.redirect_uri !== grant.redirectUri) return send(res, 400, { error: "redirect_uri_mismatch" });
        if (grant.challenge) {
          const expected = b64url(crypto.createHash("sha256").update(body.code_verifier ?? "").digest());
          if (expected !== grant.challenge) return send(res, 400, { error: "invalid_grant", error_description: "Invalid code verifier." });
        }
        const refresh = grant.refresh === false ? null : `rt_${state.nextId++}_${crypto.randomBytes(8).toString("hex")}`;
        if (refresh) state.refreshTokens.set(refresh, { email: grant.email, sub: grant.sub, revoked: false });
        const access = `at_${state.nextId++}_${crypto.randomBytes(8).toString("hex")}`;
        state.accessTokens.set(access, { refresh, expiresAt: Date.now() + state.accessTtlSec * 1000 });
        const idToken = [b64url("{}"), b64url(JSON.stringify({ iss: grant.iss ?? "https://accounts.google.com", aud: clientId, sub: grant.sub, email: grant.email, email_verified: grant.emailVerified !== false, exp: Math.floor(Date.now() / 1000) + 3600 })), "sig"].join(".");
        return send(res, 200, { access_token: access, refresh_token: refresh ?? undefined, expires_in: state.accessTtlSec, scope: grant.scopes.join(" "), token_type: "Bearer", id_token: idToken });
      }
      if (body.grant_type === "refresh_token") {
        const record = state.refreshTokens.get(body.refresh_token);
        if (!record || record.revoked) return send(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        const access = `at_${state.nextId++}_${crypto.randomBytes(8).toString("hex")}`;
        state.accessTokens.set(access, { refresh: body.refresh_token, expiresAt: Date.now() + state.accessTtlSec * 1000 });
        return send(res, 200, { access_token: access, expires_in: state.accessTtlSec, scope: "calendar", token_type: "Bearer" });
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/revoke" && req.method === "POST") {
      const record = state.refreshTokens.get(body.token);
      if (record) record.revoked = true;
      for (const [access, info] of state.accessTokens) if (info.refresh === body.token) state.accessTokens.delete(access);
      return send(res, record ? 200 : 400, record ? {} : { error: "invalid_token" });
    }

    // ── Calendar API ──
    if (!url.pathname.startsWith("/calendar/v3/")) return send(res, 404, { error: { code: 404, message: "Not Found" } });
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const access = state.accessTokens.get(token);
    if (!access || access.expiresAt < Date.now() || (access.refresh && state.refreshTokens.get(access.refresh)?.revoked)) {
      return send(res, 401, { error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } });
    }
    const parts = url.pathname.replace("/calendar/v3/", "").split("/").map(decodeURIComponent);
    if (parts[0] !== "calendars") return send(res, 404, { error: { code: 404, message: "Not Found" } });

    if (parts.length === 1 && req.method === "POST") {
      const id = `cal${state.nextId++}@group.calendar.google.com`;
      if (body.timeZone && /^[+-]/.test(body.timeZone)) return send(res, 400, { error: { code: 400, message: "Invalid time zone definition", errors: [{ reason: "invalid" }] } });
      state.calendars.set(id, { summary: body.summary, timeZone: body.timeZone ?? "UTC", events: new Map() });
      return send(res, 200, { id, summary: body.summary });
    }
    const calendar = state.calendars.get(parts[1]);
    if (!calendar) return send(res, 404, { error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } });
    if (parts.length === 2 && req.method === "DELETE") {
      state.calendars.delete(parts[1]);
      return send(res, 204);
    }
    if (parts[2] !== "events") return send(res, 404, { error: { code: 404, message: "Not Found" } });

    if (parts.length === 3 && req.method === "POST") {
      if (!body.id || !/^[a-v0-9]{5,1024}$/.test(body.id)) return send(res, 400, { error: { code: 400, message: "Invalid resource id value.", errors: [{ reason: "invalid" }] } });
      if (calendar.events.has(body.id)) return send(res, 409, { error: { code: 409, message: "The requested identifier already exists.", errors: [{ reason: "duplicate" }] } });
      calendar.events.set(body.id, { ...body, status: body.status ?? "confirmed" });
      return send(res, 200, { id: body.id });
    }
    const existing = calendar.events.get(parts[3]);
    if (parts.length === 4 && req.method === "PATCH") {
      if (!existing) return send(res, 404, { error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } });
      if (existing.status === "cancelled" && body.status !== "confirmed") return send(res, 404, { error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } });
      calendar.events.set(parts[3], { ...existing, ...body, id: parts[3] });
      return send(res, 200, { id: parts[3] });
    }
    if (parts.length === 4 && req.method === "DELETE") {
      if (!existing) return send(res, 404, { error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } });
      if (existing.status === "cancelled") return send(res, 410, { error: { code: 410, message: "Resource has been deleted", errors: [{ reason: "deleted" }] } });
      existing.status = "cancelled"; // Google keeps a deleted event as "cancelled": its id cannot be inserted again (409)
      return send(res, 204);
    }
    return send(res, 405, { error: { code: 405, message: "Method Not Allowed" } });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => send(res, 500, { error: { code: 500, message: String(error) } }));
  });

  const api = {
    clientId,
    clientSecret,
    state,
    /** Start on a free loopback port; returns the base URL. */
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      api.baseUrl = `http://127.0.0.1:${server.address().port}`;
      return api.baseUrl;
    },
    stop: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
    /** The environment that points the app at this mock (plus a fresh token key). */
    env(redirectUri = "http://localhost:3000/api/integrations/google-calendar/callback") {
      return {
        GOOGLE_CALENDAR_CLIENT_ID: clientId,
        GOOGLE_CALENDAR_CLIENT_SECRET: clientSecret,
        GOOGLE_CALENDAR_REDIRECT_URI: redirectUri,
        GOOGLE_CALENDAR_AUTH_URL: `${api.baseUrl}/auth`,
        GOOGLE_CALENDAR_TOKEN_URL: `${api.baseUrl}/token`,
        GOOGLE_CALENDAR_REVOKE_URL: `${api.baseUrl}/revoke`,
        GOOGLE_CALENDAR_API_BASE: `${api.baseUrl}/calendar/v3`,
      };
    },
    /**
     * What a person's browser does at Google: read the consent URL the app produced, "approve" it as `account`, and return the
     * URL Google would send the browser back to (with a one-time code and the state).
     */
    authorize(consentUrl, account, options = {}) {
      const url = new URL(consentUrl);
      const query = url.searchParams;
      const scopes = options.scopes ?? query.get("scope").split(" ");
      const code = `code_${state.nextId++}_${crypto.randomBytes(6).toString("hex")}`;
      state.codes.set(code, {
        email: account.email, sub: account.sub, scopes, challenge: query.get("code_challenge"), redirectUri: query.get("redirect_uri"),
        refresh: options.refresh, emailVerified: account.emailVerified, iss: options.iss,
      });
      const back = new URL(query.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", query.get("state"));
      return { url: back.toString(), code, state: query.get("state"), params: Object.fromEntries(query) };
    },
    /** Make the next `times` requests matching `match` fail. */
    fail(match, response, times = 1) {
      state.failures.push({ match, times, ...response });
    },
    clearFailures: () => { state.failures.length = 0; },
    expireAccessTokens() {
      for (const info of state.accessTokens.values()) info.expiresAt = Date.now() - 1000;
    },
    revokeGrant(email) {
      for (const record of state.refreshTokens.values()) if (record.email === email) record.revoked = true;
    },
    /** The person deletes an event / the whole calendar in the Google Calendar app. */
    deleteEventAsUser(calendarId, eventId) {
      const event = state.calendars.get(calendarId)?.events.get(eventId);
      if (event) event.status = "cancelled";
    },
    deleteCalendarAsUser: (calendarId) => state.calendars.delete(calendarId),
    calendarsNamed: (summary) => [...state.calendars].filter(([, calendar]) => calendar.summary === summary).map(([id]) => id),
    /** Live (not deleted) events of a calendar. */
    liveEvents(calendarId) {
      return [...(state.calendars.get(calendarId)?.events.values() ?? [])].filter((event) => event.status !== "cancelled");
    },
    allEvents: (calendarId) => [...(state.calendars.get(calendarId)?.events.values() ?? [])],
    requests: (predicate = () => true) => state.log.filter(predicate),
    resetLog: () => { state.log.length = 0; },
  };
  return api;
}

module.exports = { createMockGoogle };
