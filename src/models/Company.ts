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

export const Company: Model<ICompanyDocument> =
  mongoose.models.Company || mongoose.model<ICompanyDocument>("Company", CompanySchema);

export default Company;
