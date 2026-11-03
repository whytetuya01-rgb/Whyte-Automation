import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

/**
 * One person's connection to their own Google account for follow-up syncing. At most one per person.
 *
 * Google tokens are stored only encrypted (`src/lib/googleCalendar/crypto.ts`), each sealed to this record. The refresh
 * token lets syncing continue while the person is away; the short-lived access token is kept only to avoid a refresh on
 * every call. `status` tells the screens what to show:
 *   connected        syncing
 *   needs_reconnect  Google refused the stored grant (revoked, expired, password change): follow-ups stay in the CRM and
 *                    queue; nothing is sent until the person connects again
 *   disconnected     the person (or a deactivation) ended it; tokens are gone
 * The CRM stays the source of truth: nothing here can change a follow-up.
 */
export const GOOGLE_CONNECTION_STATUSES = ["connected", "needs_reconnect", "disconnected"] as const;
export type GoogleConnectionStatus = (typeof GOOGLE_CONNECTION_STATUSES)[number];

export interface IGoogleCalendarConnection {
  _id: string;
  companyId: number;
  userId: number;
  status: GoogleConnectionStatus;
  googleSub: string | null;
  googleEmail: string | null;
  scopes: string[];
  refreshTokenSealed: string | null;
  accessTokenSealed: string | null;
  accessTokenExpiresAt: Date | null;
  calendarId: string | null;
  calendarSummary: string | null;
  /** The Google account (sub) that owns `calendarId`; a different account connecting later gets a new calendar. */
  calendarOwnerSub: string | null;
  eventMinutes: number;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastSyncAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  /** A connect in progress: bound to this person, single use, short lived. Only a hash and a sealed value are kept. */
  pendingAuth: { stateHash: string; verifierSealed: string | null; expiresAt: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGoogleCalendarConnectionDocument extends Omit<IGoogleCalendarConnection, "_id">, Document<string> {}

const GoogleCalendarConnectionSchema = new Schema<IGoogleCalendarConnectionDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: Number, required: true },
    status: { type: String, enum: GOOGLE_CONNECTION_STATUSES, default: "disconnected", required: true },
    googleSub: { type: String, default: null },
    googleEmail: { type: String, default: null },
    scopes: { type: [String], default: () => [] },
    refreshTokenSealed: { type: String, default: null },
    accessTokenSealed: { type: String, default: null },
    accessTokenExpiresAt: { type: Date, default: null },
    calendarId: { type: String, default: null },
    calendarSummary: { type: String, default: null },
    calendarOwnerSub: { type: String, default: null },
    eventMinutes: { type: Number, default: 30 },
    connectedAt: { type: Date, default: null },
    disconnectedAt: { type: Date, default: null },
    lastSyncAt: { type: Date, default: null },
    lastErrorAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    pendingAuth: {
      type: new Schema({ stateHash: { type: String, required: true }, verifierSealed: { type: String, default: null }, expiresAt: { type: Date, required: true } }, { _id: false }),
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false, versionKey: false, timestamps: false }
);

GoogleCalendarConnectionSchema.index({ companyId: 1, userId: 1 }, { unique: true, name: "one_google_connection_per_user" });
// One Google account can serve only one CRM person at a time (otherwise a person's follow-ups could land in someone else's calendar).
GoogleCalendarConnectionSchema.index({ googleSub: 1 }, { unique: true, name: "one_user_per_google_account", partialFilterExpression: { status: "connected", googleSub: { $type: "string" } } });
GoogleCalendarConnectionSchema.index({ status: 1, companyId: 1 }, { name: "connections_by_status" });

tenantScopePlugin(GoogleCalendarConnectionSchema);

export const GoogleCalendarConnection: Model<IGoogleCalendarConnectionDocument> =
  mongoose.models.GoogleCalendarConnection || mongoose.model<IGoogleCalendarConnectionDocument>("GoogleCalendarConnection", GoogleCalendarConnectionSchema);
