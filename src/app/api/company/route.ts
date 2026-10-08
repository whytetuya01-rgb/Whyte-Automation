import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { requireRole, requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { updateCompanySchema } from "@/lib/validation/catalog";

export const dynamic = "force-dynamic";

/**
 * Session required for both read and write: company details are business data.
 * The proposal preview now renders them only for a signed-in user.
 */
export async function GET() {
  try {
    await requireSession();

    await connectMongoDB();
    const company = await Company.findOne().lean();
    // GET responses stay unwrapped for existing consumers.
    return NextResponse.json(company ?? null);
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/company" });
  }
}

export async function PATCH(req: Request) {
  try {
    // Company settings writes are restricted to Super Admin / Admin.
    await requireRole("super_admin", "admin");
    await connectMongoDB();

    // Explicit allowlist: a client can never write `_id` or `updatedAt`.
    const data = updateCompanySchema.parse(await readJsonBody(req));
    if (Object.keys(data).length === 0) {
      throw new ApiError("VALIDATION_ERROR", "No editable fields were supplied.");
    }

    // `name`, `phone` and `address` are required by the model, so a partial
    // update must still satisfy them.
    const existing = await Company.findOne().lean();
    const merged = { ...(existing ?? {}), ...data };
    for (const requiredField of ["name", "phone", "address"] as const) {
      if (merged[requiredField] === null || merged[requiredField] === undefined || merged[requiredField] === "") {
        throw new ApiError("REQUIRED_FIELD", `${requiredField} is required.`, {
          field: requiredField,
        });
      }
    }

    const update = { ...data, updatedAt: new Date() };
    let company;
    if (existing) {
      company = await Company.findByIdAndUpdate(existing._id, { $set: update }, { new: true });
    } else {
      const nextId = await getNextSequence("company", Company);
      company = await Company.create({ _id: nextId, ...update });
    }

    return apiSuccess(company);
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/company" });
  }
}
