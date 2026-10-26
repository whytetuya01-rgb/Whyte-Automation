import mongoose, { Schema, Document, Model } from "mongoose";
import type { AdminRole } from "@/types";
import { tenantScopePlugin } from "@/lib/tenant/plugin";

export const CANONICAL_ADMIN_ROLES = ["super_admin", "admin", "sales_executive", "dealer"] as const satisfies readonly AdminRole[];
export const ACTIVE_ADMIN_ROLES = ["super_admin", "admin", "sales_executive", "dealer", "configurable_admin"] as const satisfies readonly AdminRole[];
/**
 * Every role value an account may hold. `company_owner` is the role self-registered companies get; it must be listed
 * here because the dev hot-reload patch below re-applies this list as the `role` enum on a cached model, and a
 * missing value makes registration fail with "Validator failed for path `role`".
 */
export const ALL_ADMIN_USER_ROLES = ["super_admin", "company_owner", "admin", "sales_executive", "dealer", "sales", "configurable_admin"] as const;

/** The one role exempt from needing a companyId — the platform owner, not a company's own user. */
function isPlatformSuperAdmin(doc: unknown): boolean {
  return (doc as { role?: string } | null)?.role === "super_admin";
}

export interface IDiscountAllocationHistory {
  allocatedPercent: number;
  previousPercent: number;
  changedBy: number;
  changedByName: string | null;
  changedAt: Date;
}

export interface IAdminUser {
  _id: number;
  id?: number;
  /**
   * `null` only for `role: "super_admin"` (the platform owner — see
   * `isPlatformSuperAdmin` below). Every other account, including `dealer`,
   * belongs to exactly one company.
   */
  companyId: number | null;
  email: string;
  passwordHash: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  gstNumber: string | null;
  /** Public-facing contact email for client-facing documents (e.g. the proposal PDF).
   *  Deliberately separate from `email` (the account's login identifier), so a
   *  personal/internal login address is never shown to end clients. */
  businessEmail: string | null;
  contactNumber: string | null;
  address: string | null;
  role: AdminRole | "sales";
  isActive: boolean;
  assignedSalesId: number | null;
  discountAllocationPercent: number;
  discountAllocationHistory: IDiscountAllocationHistory[];
  /** Granular capabilities assigned to configurable_admin accounts. */
  permissions?: string[];
  createdAt: Date;
}

export interface IAdminUserDocument extends Omit<IAdminUser, "id">, Document<number> {
  id: number;
}

const DiscountAllocationHistorySchema = new Schema<IDiscountAllocationHistory>(
  {
    allocatedPercent: { type: Number, required: true },
    previousPercent: { type: Number, required: true },
    changedBy: { type: Number, required: true },
    changedByName: { type: String, default: null },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AdminUserSchema = new Schema<IAdminUserDocument>(
  {
    _id: { type: Number, required: true },
    // Phase 1 decision: email stays GLOBALLY unique across every company,
    // rather than becoming a compound { companyId, email } unique index. The
    // login form has no company slug/subdomain field today and this keeps
    // every existing login working unchanged with zero risk — the simpler,
    // safer option per the Phase 1 brief. Revisit only if/when the product
    // needs the same email to be able to register against two companies.
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    name: { type: String, default: null, trim: true },
    firstName: { type: String, default: null, trim: true },
    lastName: { type: String, default: null, trim: true },
    companyName: { type: String, default: null, trim: true },
    gstNumber: { type: String, default: null, trim: true, uppercase: true },
    businessEmail: { type: String, default: null, trim: true, lowercase: true },
    contactNumber: { type: String, default: null, trim: true },
    address: { type: String, default: null, trim: true },
    role: {
      type: String,
      required: true,
      default: "admin",
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    assignedSalesId: { type: Number, ref: "AdminUser", default: null },
    discountAllocationPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAllocationHistory: { type: [DiscountAllocationHistorySchema], default: () => [] },
    permissions: { type: [String], default: () => [] },
    createdAt: { type: Date, default: Date.now },
  },
  {
    _id: false,
    versionKey: false,
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret.passwordHash;
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

// Virtual for id getter
AdminUserSchema.virtual("id").get(function () {
  return this._id;
});

// Assigned Sales Person virtual relation
AdminUserSchema.virtual("assignedSales", {
  ref: "AdminUser",
  localField: "assignedSalesId",
  foreignField: "_id",
  justOne: true,
});

AdminUserSchema.index({ companyId: 1, role: 1, isActive: 1 });
AdminUserSchema.index({ assignedSalesId: 1 });

tenantScopePlugin(AdminUserSchema, { isExempt: isPlatformSuperAdmin });

const existingAdminUserModel = mongoose.models.AdminUser as Model<IAdminUserDocument> | undefined;

/**
 * Next development hot reload retains Mongoose models in `mongoose.models`.
 * Refresh the cached schema's enum so a process that loaded the pre-Dealer
 * schema cannot continue rejecting a server-assigned Dealer registration.
 */
if (existingAdminUserModel) {
  const rolePath = existingAdminUserModel.schema.path("role") as unknown as {
    enumValues: string[];
    enum: (options: { values: string[] }) => void;
  };
  if (rolePath) {
    rolePath.enumValues = [];
    rolePath.enum({ values: [...ALL_ADMIN_USER_ROLES] });
  }

  if (!existingAdminUserModel.schema.path("companyId")) {
    existingAdminUserModel.schema.add({
      companyId: { type: Number, ref: "Company", default: null, index: true },
    });
  }

  if (!existingAdminUserModel.schema.path("companyName")) {
    existingAdminUserModel.schema.add({
      companyName: { type: String, default: null, trim: true },
    });
  }

  if (!existingAdminUserModel.schema.path("businessEmail")) {
    existingAdminUserModel.schema.add({
      businessEmail: { type: String, default: null, trim: true, lowercase: true },
    });
  }

  if (!existingAdminUserModel.schema.path("assignedSalesId")) {
    existingAdminUserModel.schema.add({
      assignedSalesId: { type: Number, ref: "AdminUser", default: null },
    });
  }

  if (!existingAdminUserModel.schema.path("discountAllocationPercent")) {
    existingAdminUserModel.schema.add({
      discountAllocationPercent: { type: Number, default: 0, min: 0, max: 100 },
    });
  }

  if (!existingAdminUserModel.schema.path("discountAllocationHistory")) {
    existingAdminUserModel.schema.add({
      discountAllocationHistory: { type: [DiscountAllocationHistorySchema], default: () => [] },
    });
  }

  if (!existingAdminUserModel.schema.path("permissions")) {
    existingAdminUserModel.schema.add({
      permissions: { type: [String], default: () => [] },
    });
  }

  if (!existingAdminUserModel.schema.virtualpath("id")) {
    existingAdminUserModel.schema.virtual("id").get(function () {
      return this._id;
    });
  }

  if (!existingAdminUserModel.schema.virtualpath("assignedSales")) {
    existingAdminUserModel.schema.virtual("assignedSales", {
      ref: "AdminUser",
      localField: "assignedSalesId",
      foreignField: "_id",
      justOne: true,
    });
  }

  existingAdminUserModel.schema.set("toJSON", {
    virtuals: true,
    transform: ((_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = ret._id;
      delete ret.passwordHash;
      return ret;
    }) as any,
  });

  existingAdminUserModel.schema.set("toObject", {
    virtuals: true,
    transform: ((_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = ret._id;
      return ret;
    }) as any,
  });
}

export const AdminUser: Model<IAdminUserDocument> =
  existingAdminUserModel ?? mongoose.model<IAdminUserDocument>("AdminUser", AdminUserSchema);

export default AdminUser;
