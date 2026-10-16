import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { withPermission, withSession, getAuthenticatedActor } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { THEME_CONFIGS, THEME_LIST, DEFAULT_THEME, isValidTheme } from "@/lib/themeTokens";
import { getNextSequence } from "@/lib/counter";
import { cookies } from "next/headers";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchThemeSchema = z.object({
  theme: z.enum(["whyte-rose", "champagne-bronze", "emerald-haven"]),
});

export async function GET() {
  try {
    return await withSession(async (actor) => {
      await connectMongoDB();
      const company = actor.companyId ? await Company.findById(actor.companyId).select("theme").lean() : null;
      const currentTheme = company?.theme && isValidTheme(company.theme) ? company.theme : DEFAULT_THEME;

      return apiSuccess({
        currentTheme,
        themes: THEME_LIST,
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/theme" });
  }
}

export async function PATCH(req: Request) {
  try {
    return await withPermission("company:edit", async (actor) => {
      // Free hand for Superadmin/Admin: super_admin, admin, or legacy company_owner can update the theme
      const role = actor.role.toLowerCase();
      if (role !== "super_admin" && role !== "admin" && role !== "company_owner") {
        throw new ApiError("FORBIDDEN", "Only Administrators can configure the site theme.");
      }

      if (!actor.companyId) {
        throw new ApiError("FORBIDDEN", "An active company context is required to configure the theme.");
      }

      const body = await readJsonBody(req);
      const parsed = patchThemeSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError("VALIDATION_ERROR", "Invalid theme selection. Must be one of the supported themes.", {
          details: { issues: parsed.error.issues },
        });
      }

      const { theme } = parsed.data;

      await connectMongoDB();
      const company = await Company.findByIdAndUpdate(
        actor.companyId,
        { $set: { theme, updatedAt: new Date() } },
        { new: true }
      ).lean();

      if (!company) {
        throw new ApiError("NOT_FOUND", "Company record not found.");
      }

      // Also set a persistent HTTP-friendly cookie so SSR loads the selected theme seamlessly
      const cookieStore = await cookies();
      cookieStore.set("whyte_site_theme", theme, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 year
        sameSite: "lax",
      });

      return apiSuccess({
        success: true,
        theme,
        config: THEME_CONFIGS[theme],
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/theme" });
  }
}
