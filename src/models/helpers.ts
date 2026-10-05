import mongoose from "mongoose";

/**
 * Creates a schema definition for high-precision Decimal128 fields.
 * Stores values natively as BSON Decimal128 in MongoDB, avoiding IEEE-754 precision loss.
 * Accepts string, number, or Decimal128 on input and provides string serialization.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDecimalField(options: {
  required?: boolean;
  default?: string | number | null;
  min?: number;
} = {}): any {
  const definition: Record<string, unknown> = {
    type: mongoose.Schema.Types.Decimal128,
    required: options.required ?? false,
    get: (v: mongoose.Types.Decimal128 | null | undefined): string | null | undefined => {
      if (v === null || v === undefined) return v;
      return v.toString();
    },
    set: (v: number | string | mongoose.Types.Decimal128 | null | undefined) => {
      if (v === null || v === undefined) return v;
      if (typeof v === "number" || typeof v === "string") {
        return mongoose.Types.Decimal128.fromString(v.toString());
      }
      return v;
    },
  };

  if (options.min !== undefined) {
    definition.validate = {
      validator: (v: mongoose.Types.Decimal128 | null | undefined) => {
        if (v === null || v === undefined) return true;
        const num = Number(v.toString());
        return Number.isFinite(num) && num >= options.min!;
      },
      message: () => `Value cannot be less than ${options.min}.`,
    };
  }

  if (options.default !== undefined) {
    definition.default =
      options.default !== null
        ? () => mongoose.Types.Decimal128.fromString(options.default!.toString())
        : null;
  }

  return definition;
}
