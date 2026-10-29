import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { withPermission, withSession, getAuthenticatedActor } from "@/lib/api-auth";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { THEME_CONFIGS, THEME_LIST, DEFAULT_THEME, SITE_THEME_IDS, isValidTheme } from "@/lib/themeTokens";
import { getNextSequence } from "@/lib/counter";
import { z } from "zod";
import { MIN_BRAND_CONTRAST_ON_WHITE, brandContrastOnWhite, normalizeBrandColor } from "@/lib/brandColor";

export const dynamic = "force-dynamic";

// At least one of `theme` (a preset) or `brandColor` (a custom `#rrggbb` accent, or null to go back to the preset).
const patchThemeSchema = z
  .object({
    theme: z.enum(SITE_THEME_IDS, { message: "Choose one of the available preset themes." }).optional(),
    brandColor: z
      .string({ message: "Brand colour must be a #rrggbb hex value." })
      .trim()
      .refine((value) => normalizeBrandColor(value) !== null, "Brand colour must be a #rrggbb hex value.")
      .transform((value) => normalizeBrandColor(value) as string)
      .refine(
        (value) => brandContrastOnWhite(value) >= MIN_BRAND_CONTRAST_ON_WHITE,
        `That colour is too light: white text on it would be hard to read (needs a contrast of at least ${MIN_BRAND_CONTRAST_ON_WHITE}:1).`
      )
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => value.theme !== undefined || value.brandColor !== undefined, "Choose a theme or a brand colour.");

export async function GET() {
  try {
    return await withSession(async (actor) => {
      await connectMongoDB();
      const company = actor.companyId ? await Company.findById(actor.companyId).select("theme brandColor").lean() : null;
      const currentTheme = company?.theme && isValidTheme(company.theme) ? company.theme : DEFAULT_THEME;

      return apiSuccess({
        currentTheme,
        brandColor: normalizeBrandColor(company?.brandColor),
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
        const colourIssue = parsed.error.issues.find((issue) => issue.path[0] === "brandColor");
        const rootIssue = parsed.error.issues.find((issue) => issue.code === "custom" && issue.path.length === 0);
        throw new ApiError("VALIDATION_ERROR", colourIssue?.message ?? rootIssue?.message ?? "Invalid theme selection. Must be one of the supported themes.", {
          field: colourIssue ? "brandColor" : undefined,
          details: { issues: parsed.error.issues },
        });
      }

      const { theme, brandColor } = parsed.data;

      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (theme !== undefined) update.theme = theme;
      if (brandColor !== undefined) update.brandColor = brandColor;

      await connectMongoDB();
      const company = await Company.findByIdAndUpdate(actor.companyId, { $set: update }, { new: true }).lean();

      if (!company) {
        throw new ApiError("NOT_FOUND", "Company record not found.");
      }

      // The preset is resolved on the server from the session's own company on every page render (see
      // getCompanyBranding), so nothing is kept in a cookie or in the browser.

      return apiSuccess({
        success: true,
        theme: company.theme,
        brandColor: normalizeBrandColor(company.brandColor),
        config: THEME_CONFIGS[isValidTheme(company.theme) ? company.theme : DEFAULT_THEME],
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "PATCH /api/theme" });
  }
}
