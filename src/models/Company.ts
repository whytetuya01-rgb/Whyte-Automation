import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICompany {
  _id: number;
  id?: number;
  name: string;
  gstNumber: string | null;
  phone: string;
  email: string | null;
  address: string;
  logoUrl: string | null;
  tagline: string | null;
  updatedAt: Date;
}

export interface ICompanyDocument extends Omit<ICompany, "id">, Document<number> {
  id: number;
}

const CompanySchema = new Schema<ICompanyDocument>(
  {
    _id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    gstNumber: { type: String, default: null, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: null, trim: true },
    address: { type: String, required: true, trim: true },
    logoUrl: { type: String, default: null },
    tagline: { type: String, default: null, trim: true },
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

export const Company: Model<ICompanyDocument> =
  mongoose.models.Company || mongoose.model<ICompanyDocument>("Company", CompanySchema);

export default Company;
