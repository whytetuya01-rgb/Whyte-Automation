import { GoogleCalendarConnection, type IGoogleCalendarConnection } from "@/models";
import { googleCalendarConfig } from "./config";
import { GoogleApiError, refreshAccessToken } from "./client";
import { needsResealing, openToken, sealToken, TokenCryptoError } from "./crypto";

export const connectionIdFor = (companyId: number, userId: number) => `gcc_${companyId}_${userId}`;
export const refreshAad = (connectionId: string) => `refresh:${connectionId}`;
export const accessAad = (connectionId: string) => `access:${connectionId}`;
export const pkceAad = (connectionId: string) => `pkce:${connectionId}`;

/** Google no longer accepts the stored grant: the person has to connect again. */
export class ReconnectNeededError extends Error {}

const SKEW_MS = 60_000;

type TokenRow = Pick<IGoogleCalendarConnection, "refreshTokenSealed" | "accessTokenSealed" | "accessTokenExpiresAt"> & { _id: string };

/**
 * A usable access token for the connection: the stored one while it is still good, otherwise a fresh one from the refresh
 * token (which is then stored, sealed). A refresh token Google rejects (revoked, expired, password changed) ends in
 * `ReconnectNeededError`; a network or Google outage is thrown as the retryable `GoogleApiError` it is.
 */
export async function accessTokenFor(connection: TokenRow, now: Date = new Date()): Promise<string> {
  if (connection.accessTokenSealed && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() - now.getTime() > SKEW_MS) {
    try {
      return openToken(connection.accessTokenSealed, accessAad(connection._id));
    } catch (error) {
      if (!(error instanceof TokenCryptoError)) throw error; // an unreadable cached token: fall through and refresh
    }
  }
  if (!connection.refreshTokenSealed) throw new ReconnectNeededError("No Google refresh token is stored.");
  let refreshToken: string;
  try {
    refreshToken = openToken(connection.refreshTokenSealed, refreshAad(connection._id));
  } catch {
    throw new ReconnectNeededError("The stored Google token cannot be read any more.");
  }
  let tokens;
  try {
    tokens = await refreshAccessToken(googleCalendarConfig(), refreshToken);
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === "auth") throw new ReconnectNeededError("Google no longer accepts this connection.");
    if (error instanceof GoogleApiError && error.kind === "invalid" && error.reason === "invalid_grant") throw new ReconnectNeededError("Google no longer accepts this connection.");
    throw error;
  }
  const nextRefresh = tokens.refreshToken ?? refreshToken;
  await GoogleCalendarConnection.updateOne(
    { _id: connection._id },
    {
      $set: {
        accessTokenSealed: sealToken(tokens.accessToken, accessAad(connection._id)),
        accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresInSec * 1000),
        ...(tokens.refreshToken || needsResealing(connection.refreshTokenSealed) ? { refreshTokenSealed: sealToken(nextRefresh, refreshAad(connection._id)) } : {}),
        updatedAt: now,
      },
    }
  );
  return tokens.accessToken;
}
