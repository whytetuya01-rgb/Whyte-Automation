import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";
import { requireSession } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { updateDealerProfileSchema } from "@/lib/validation/admin-user";

export const dynamic = "force-dynamic";

/**
 * GET /api/dealer/profile
 * Returns the currently authenticated Dealer's own registration and profile details.
 *
 * Security:
 * - Session identity is strictly enforced: only the session's user ID is used.
 * - Non-dealer roles receive 403 Forbidden.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    if (role !== "dealer") {
      throw new ApiError("FORBIDDEN", "Only Dealers can access the Dealer Profile.");
    }

    await connectMongoDB();
    const dealer = await AdminUser.findOne({ _id: userId, role: "dealer" }).lean();

    if (!dealer) {
      throw new ApiError("NOT_FOUND", "Dealer profile not found.");
    }

    const { passwordHash, ...rest } = dealer as any;

    return NextResponse.json({
      ...rest,
      id: dealer._id,
      discountAllocationPercent: dealer.discountAllocationPercent || 0,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/dealer/profile" });
  }
}

/**
 * PATCH /api/dealer/profile
 * Allows the authenticated Dealer to update permitted profile fields (name, contact, GST, address, password).
 *
 * Security:
 * - Target identity is derived solely from the authenticated session.
 * - Privileged fields (role, assignedSalesId, discountAllocation, status) are strictly rejected.
 * - Password updates require verification of the existing password.
 */
export async function PATCH(req: Request) {
  try {
    const session = await requireSession();
    const role = (session.user as { role?: string }).role;
    const userId = Number((session.user as any).id);

    if (role !== "dealer") {
      throw new ApiError("FORBIDDEN", "Only Dealers can access the Dealer Profile.");
    }

    const body = await readJsonBody(req);
    const parsed = updateDealerProfileSchema.parse(body);

    await connectMongoDB();
    const account = await AdminUser.findOne({ _id: userId, role: "dealer" });
    if (!account) {
      throw new ApiError("NOT_FOUND", "Dealer profile not found.");
    }

    // Password change handling
    if (parsed.newPassword || parsed.currentPassword) {
      if (!parsed.currentPassword) {
        throw new ApiError("VALIDATION_ERROR", "Current password is required to set a new password.", {
          field: "currentPassword",
        });
      }
      if (!parsed.newPassword) {
        throw new ApiError("VALIDATION_ERROR", "New password is required.", {
          field: "newPassword",
        });
      }

      const isMatch = await bcrypt.compare(parsed.currentPassword, account.passwordHash);
      if (!isMatch) {
        throw new ApiError("VALIDATION_ERROR", "Current password is incorrect.", {
          field: "currentPassword",
        });
      }

      account.passwordHash = await bcrypt.hash(parsed.newPassword, 12);
    }

    // Update permitted personal and business details
    if (parsed.firstName !== undefined) account.firstName = parsed.firstName;
    if (parsed.lastName !== undefined) account.lastName = parsed.lastName;
    if (parsed.contactNumber !== undefined) account.contactNumber = parsed.contactNumber;
    if (parsed.companyName !== undefined) account.companyName = parsed.companyName;
    if (parsed.gstNumber !== undefined) account.gstNumber = parsed.gstNumber;
    if (parsed.businessEmail !== undefined) account.businessEmail = parsed.businessEmail;
    if (parsed.address !== undefined) account.address = parsed.address;

    account.name = [account.firstName, account.lastName].filter(Boolean).join(" ").trim() || account.email;

    await account.save();

    // Re-fetch account for response
    const updated = await AdminUser.findOne({ _id: userId, role: "dealer" }).lean();

    const { passwordHash, ...rest } = updated as any;

    return apiSuccess({
      ...rest,
      id: updated?._id,
      discountAllocationPercent: updated?.discountAllocationPercent || 0,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/dealer/profile" });
  }
}
