import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models";
import { DEFAULT_THEME, isValidTheme } from "@/lib/themeTokens";
import type { SiteTheme } from "@/models/Company";

/**
 * Reads the active site theme for server-rendered HTML contexts.
 * Falls back to "whyte-rose" if no company is found or if an error occurs.
 */
export async function getSiteTheme(): Promise<SiteTheme> {
  try {
    await connectMongoDB();
    const company = await Company.findOne().select("theme").lean();
    if (company?.theme && isValidTheme(company.theme)) {
      return company.theme;
    }
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
