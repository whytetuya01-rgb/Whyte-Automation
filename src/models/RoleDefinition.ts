import mongoose, { Schema, Document, Model } from "mongoose";

export interface IRoleDefinition {
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
      type: String,
      required: true,
      unique: true,
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

export const RoleDefinition: Model<IRoleDefinitionDocument> =
  mongoose.models.RoleDefinition ||
  mongoose.model<IRoleDefinitionDocument>("RoleDefinition", RoleDefinitionSchema);
