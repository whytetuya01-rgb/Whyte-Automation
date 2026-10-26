import mongoose, { Schema, Document, Model } from "mongoose";
import { softDeletePlugin } from "@/lib/softDelete/plugin";
import type { SoftDeleteFields } from "@/lib/softDelete/fields";

/**
 * `pending`   — self-registered, awaiting platform Super Admin approval
 *                (Requirement 1's self-registration flow); cannot log in yet.
 * `active`    — normal, operating company.
 * `suspended` — platform-disabled; `sessionGuard.ts` forces every one of its
 *               users' sessions invalid on their next request.
 */
export type CompanyStatus = "pending" | "active" | "suspended";

/**
 * Review state of a SELF-REGISTERED company, kept separate from `status` on purpose. `status: "pending"` already
 * means something else in production (the default company, Whyte, is `pending` and its users sign in normally), so
 * it cannot double as "waiting for review".
 *
 * A company without this field (every company created before self-registration) is treated as approved. Only
 * `pending_review` and `rejected` block access.
 */
export type CompanyRegistrationStatus = "pending_review" | "approved" | "rejected";

export type DecisionEmailKind = "approved" | "rejected";
export type DecisionEmailStatus = "pending" | "sent" | "failed";

export interface CompanyDecisionEmail {
  kind: DecisionEmailKind;
  status: DecisionEmailStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  /** Short machine reason from the last failed attempt (never provider text or secrets). */
  lastError: string | null;
}

export type SiteTheme = "whyte-rose" | "champagne-bronze" | "emerald-haven";
export const VALID_SITE_THEMES: SiteTheme[] = ["whyte-rose", "champagne-bronze", "emerald-haven"];

export type SidebarStyle = "classic" | "floating" | "minimal";
export type BorderRadius = "sharp" | "balanced" | "smooth";
export type ContentDensity = "comfortable" | "compact";

export interface ThemeLayoutSettings {
  sidebarStyle: SidebarStyle;
  borderRadius: BorderRadius;
  contentDensity: ContentDensity;
}

export const DEFAULT_LAYOUT_SETTINGS: ThemeLayoutSettings = {
  sidebarStyle: "classic",
  borderRadius: "balanced",
  contentDensity: "comfortable",
};

export interface ICompany extends SoftDeleteFields {
  _id: number;
  id?: number;
  name: string;
  /** URL-safe, unique identifier. Not yet used for login/subdomain routing in Phase 1 (email stays globally unique — see AdminUser.ts) but reserved for that later. */
  slug: string;
  status: CompanyStatus;
  gstNumber: string | null;
  phone: string;
  email: string | null;
  address: string;
  logoUrl: string | null;
  /** Cloudinary public id of the uploaded logo (`whyte/companies/<id>/branding/…`); null for a legacy / external logoUrl or no logo. */
  logoPublicId?: string | null;
  /** Absent / null on companies that predate self-registration (treated as approved). */
  registrationStatus?: CompanyRegistrationStatus | null;
  registrationSubmittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: number | null;
  reviewedByName?: string | null;
  /** Internal reviewer note. Never shown to the company and never put in an email. */
  reviewNote?: string | null;
  decisionEmail?: CompanyDecisionEmail | null;
  /** The status a deactivated (suspended) company returns to when it is reactivated. */
  suspendedFromStatus?: CompanyStatus | null;
  statusChangedAt?: Date | null;
  statusChangedBy?: number | null;
  statusChangedByName?: string | null;
  tagline: string | null;
  theme?: SiteTheme;
  themeLayout?: ThemeLayoutSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICompanyDocument extends Omit<ICompany, "id">, Document<number> {
  id: number;
}

const CompanySchema = new Schema<ICompanyDocument>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]+$/,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "active", "suspended"],
      required: true,
      default: "pending",
      index: true,
    },
    gstNumber: { type: String, default: null, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: null, trim: true },
    address: { type: String, required: true, trim: true },
    logoUrl: { type: String, default: null },
    logoPublicId: { type: String, default: null },
    registrationStatus: { type: String, enum: ["pending_review", "approved", "rejected"], default: undefined },
    registrationSubmittedAt: { type: Date, default: undefined },
    reviewedAt: { type: Date, default: undefined },
    reviewedBy: { type: Number, default: undefined },
    reviewedByName: { type: String, default: undefined },
    reviewNote: { type: String, default: undefined, maxlength: 500 },
    suspendedFromStatus: { type: String, enum: ["pending", "active", "suspended"], default: undefined },
    statusChangedAt: { type: Date, default: undefined },
    statusChangedBy: { type: Number, default: undefined },
    statusChangedByName: { type: String, default: undefined },
    decisionEmail: {
      type: new Schema(
        {
          kind: { type: String, enum: ["approved", "rejected"], required: true },
          status: { type: String, enum: ["pending", "sent", "failed"], required: true },
          attempts: { type: Number, default: 0 },
          lastAttemptAt: { type: Date, default: null },
          sentAt: { type: Date, default: null },
          lastError: { type: String, default: null },
        },
        { _id: false }
      ),
      default: undefined,
    },
    tagline: { type: String, default: null, trim: true },
    theme: {
      type: String,
      enum: ["whyte-rose", "champagne-bronze", "emerald-haven"],
      default: "whyte-rose",
    },
    themeLayout: {
      sidebarStyle: {
        type: String,
        enum: ["classic", "floating", "minimal"],
        default: "classic",
      },
      borderRadius: {
        type: String,
        enum: ["sharp", "balanced", "smooth"],
        default: "balanced",
      },
      contentDensity: {
        type: String,
        enum: ["comfortable", "compact"],
        default: "comfortable",
      },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    _id: false,
    versionKey: false,
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

CompanySchema.virtual("id").get(function () {
  return this._id;
});

CompanySchema.pre("save", function (this: ICompanyDocument) {
  this.updatedAt = new Date();
});

// Company is the tenant table itself — it never carries companyId and never
// gets `tenantScopePlugin`. It does get soft-delete: "deleting" a company
// (offboarding) must never be a hard delete of the one record every other
// collection's companyId points at.
softDeletePlugin(CompanySchema, { blockHardDelete: true });

/**
 * Next dev hot reload keeps models in `mongoose.models`, so a process that loaded an OLDER Company schema would keep
 * using it. Mongoose silently drops fields its schema does not know, which for `registrationStatus` means a freshly
 * registered company is saved WITHOUT its review state and is treated as an approved legacy company. Drop a cached
 * model that predates the review fields so it is rebuilt from this schema.
 */
const cachedCompany = mongoose.models.Company;
if (cachedCompany && (!cachedCompany.schema.path("registrationStatus") || !cachedCompany.schema.path("suspendedFromStatus"))) {
  mongoose.deleteModel("Company");
}

export const Company: Model<ICompanyDocument> =
  mongoose.models.Company || mongoose.model<ICompanyDocument>("Company", CompanySchema);

export default Company;
