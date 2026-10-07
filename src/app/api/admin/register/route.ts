import bcrypt from "bcryptjs";
import { z } from "zod";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { getNextSequence } from "@/lib/counter";
import { ApiError, handleApiError, readJsonBody } from "@/lib/api-response";
import { AdminUser } from "@/models";
import { emailSchema, mobileSchema, optionalGstinSchema } from "@/lib/validation/fields";

export const runtime = "nodejs";

const registrationSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(60, "First name must be 60 characters or fewer.")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "First name contains invalid characters."),
  lastName: z.string().trim().min(1, "Last name is required.").max(60, "Last name must be 60 characters or fewer.")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Last name contains invalid characters."),
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters.")
    .refine((value) => new TextEncoder().encode(value).length <= 72, "Password must be 72 bytes or fewer."),
  gstNumber: optionalGstinSchema,
  contactNumber: mobileSchema,
  address: z.string().trim().min(1, "Address is required.").max(500, "Address must be 500 characters or fewer.")
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Address contains invalid characters."),
}).strict();

export async function POST(request: Request) {
  try {
    const parsed = registrationSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return handleApiError(parsed.error, { logPrefix: "POST /api/admin/register" });

    await connectMongoDB();
    const { firstName, lastName, email, password, gstNumber, contactNumber, address } = parsed.data;

    if (await AdminUser.exists({ email })) {
      throw new ApiError("DUPLICATE_RECORD", "An account with this email already exists.", { field: "email" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = await getNextSequence("adminUser", AdminUser);
    const name = `${firstName} ${lastName}`;
    const account = new AdminUser({
      _id: id,
      name,
      firstName,
      lastName,
      email,
      passwordHash,
      gstNumber: gstNumber ?? null,
      contactNumber,
      address,
      role: "dealer",
      isActive: true,
    });
    await account.save();

    return NextResponse.json(
      { success: true, data: { id: account._id, name: account.name, email: account.email, role: account.role } },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/admin/register" });
  }
}
