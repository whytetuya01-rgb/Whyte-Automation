import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { withPermission, withSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { updateCompanySchema } from "@/lib/validation/catalog";

export const dynamic = "force-dynamic";

/**
 * Session required for both read and write: company details are business data.
 * The proposal preview now renders them only for a signed-in user.
 */
export async function GET() {
  try {
    return await withSession(async (actor) => {
      await connectMongoDB();
      if (!actor.companyId) {
        // Super Admin with no active act-as session has no company context
        return NextResponse.json(null);
      }
      const company = await Company.findById(actor.companyId).lean();
      // GET responses stay unwrapped for existing consumers.
      return NextResponse.json(company ?? null);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/company" });
  }
}

export async function PATCH(req: Request) {
  try {
    // Company settings writes are restricted to Super Admin, Admin, and Configurable Admins with company:edit
    return await withPermission("company:edit", async (actor) => {
      await connectMongoDB();

      if (!actor.companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required to modify company settings.");
      }

      // Explicit allowlist: a client can never write `_id` or `updatedAt`.
      const data = updateCompanySchema.parse(await readJsonBody(req));
      // The logo (URL and storage id travel together) changes only through POST/DELETE /api/company/logo, so a
      // profile save can never point it at an arbitrary URL or leave the stored public id out of step.
      delete data.logoUrl;
      if (Object.keys(data).length === 0) {
        throw new ApiError("VALIDATION_ERROR", "No editable fields were supplied.");
      }

      // `name`, `phone` and `address` are required by the model, so a partial
      // update must still satisfy them.
      const existing = await Company.findById(actor.companyId).lean();
      if (!existing) {
        throw new ApiError("NOT_FOUND", "Company record not found.", { field: "companyId" });
      }

      const merged = { ...existing, ...data };
      for (const requiredField of ["name", "phone", "address"] as const) {
        if (merged[requiredField] === null || merged[requiredField] === undefined || merged[requiredField] === "") {
          throw new ApiError("REQUIRED_FIELD", `${requiredField} is required.`, {
            field: requiredField,
          });
        }
      }

      const update = { ...data, updatedAt: new Date() };
      const company = await Company.findByIdAndUpdate(actor.companyId, { $set: update }, { new: true });

      return apiSuccess(company);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/company" });
  }
}
