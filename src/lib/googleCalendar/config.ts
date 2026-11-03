/**
 * Google Calendar integration settings, all from the environment. Nothing here has a default that points at a real
 * Google project: until the variables are set the integration reports "not configured" and the Connect button stays off.
 *
 *   GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET   the OAuth client (Google Cloud console)
 *   GOOGLE_CALENDAR_REDIRECT_URI                                 exactly the "Authorized redirect URI" registered there
 *   GOOGLE_CALENDAR_TOKEN_KEY                                    32 random bytes, base64: encrypts stored Google tokens
 *   GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS                           optional: the key being rotated out (still decrypts)
 *   CRON_SECRET                                                  protects the sync worker route
 *   GOOGLE_CALENDAR_PKCE=0                                       turn PKCE off (on by default)
 *   APP_BASE_URL                                                 optional: adds an "Open in CRM" link to events
 *
 * The Google endpoints can be pointed somewhere else ONLY at a loopback address (the mock Google server in the tests);
 * anything else is ignored, so production can never be redirected away from Google by a stray variable.
 */

export const GOOGLE_CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.app.created"] as const;
/** The only scope that gives access to calendar data. Granting less than this is refused. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function endpoint(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const override = env[name]?.trim();
  if (!override) return fallback;
  try {
    const url = new URL(override);
    if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return override.replace(/\/+$/, "");
  } catch {
    /* ignored below */
  }
  return fallback;
}

export interface GoogleCalendarConfig {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  usePkce: boolean;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  apiBase: string;
  appBaseUrl: string | null;
}

export function googleCalendarConfig(env: NodeJS.ProcessEnv = process.env): GoogleCalendarConfig {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() ?? "";
  const key = env.GOOGLE_CALENDAR_TOKEN_KEY?.trim() ?? "";
  return {
    configured: Boolean(clientId && clientSecret && redirectUri && Buffer.from(key, "base64").length === 32),
    clientId,
    clientSecret,
    redirectUri,
    usePkce: env.GOOGLE_CALENDAR_PKCE?.trim() !== "0",
    authUrl: endpoint(env, "GOOGLE_CALENDAR_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
    tokenUrl: endpoint(env, "GOOGLE_CALENDAR_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    revokeUrl: endpoint(env, "GOOGLE_CALENDAR_REVOKE_URL", "https://oauth2.googleapis.com/revoke"),
    apiBase: endpoint(env, "GOOGLE_CALENDAR_API_BASE", "https://www.googleapis.com/calendar/v3"),
    appBaseUrl: env.APP_BASE_URL?.trim().replace(/\/+$/, "") || null,
  };
}
