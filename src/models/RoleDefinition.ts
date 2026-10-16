import mongoose, { Schema, Document, Model } from "mongoose";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export interface IRoleDefinition {
  /**
   * `null` for the global system role templates (`admin`, `dealer`,
   * `super_admin`, `configurable_admin` — `isSystem: true`), which are
   * shared across every company, not owned by one. Set for a company's own
   * custom roles. Because of this split, `GET /api/admin/roles` (see
   * `src/lib/roleService.ts`) must query system templates and a company's
   * custom roles SEPARATELY (`runUnscoped("platform-admin", ...)` for the
   * former) and merge the results — the tenant-scope plugin's single
   * `{companyId}` filter cannot express "this OR that" on its own.
   */
  companyId: number | null;
  key: string;
  name: string;
  description: string;
  badge?: string | null;
  isSystem: boolean;
  permissions: string[];
  isCustomized?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IRoleDefinitionDocument extends IRoleDefinition, Document {}

const RoleDefinitionSchema = new Schema<IRoleDefinitionDocument>(
  {
    key: {
      // Not globally unique any more: a system role template (companyId: null)
      // and a company's own custom role key never collide in practice (custom
      // keys are checked against the reserved/system key list at creation
      // time), and two different companies may each have their own
      // "regional_manager" custom role — see the compound index below.
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    badge: {
      type: String,
      default: null,
      trim: true,
    },
    isSystem: {
      type: Boolean,
      default: false,
      index: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
    isCustomized: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Unique per company instead of globally — a system template's companyId is
// always null, so this index also naturally enforces there is only ever one
// "admin" and one "dealer" system template (companyId: null, key: "admin"/"dealer").
RoleDefinitionSchema.index({ companyId: 1, key: 1 }, { unique: true });

// Exempt ONLY the global system templates (companyId explicitly null, e.g.
// the one shared "admin"/"dealer" default) — NOT a company's own override of
// a system role, which has isSystem: true as well but a real companyId and
// must be validated/stamped normally like any other company-owned document.
// The caller (src/lib/roleService.ts) is what decides which one it's
// creating, by what companyId it passes in.
tenantScopePlugin(RoleDefinitionSchema, {
  isExempt: (doc: unknown) => {
    const d = doc as { isSystem?: boolean; companyId?: number | null } | null;
    return d?.isSystem === true && !d?.companyId;
  },
});

export const RoleDefinition: Model<IRoleDefinitionDocument> =
  mongoose.models.RoleDefinition ||
  mongoose.model<IRoleDefinitionDocument>("RoleDefinition", RoleDefinitionSchema);
