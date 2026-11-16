import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { connectMongoDB } from "@/lib/mongodb";
import { Company } from "@/models/Company";
import AppsMenu from "@/components/admin/apps/AppsMenu";

export const metadata = { title: "Apps" };

/**
 * The admin Apps menu: every app the signed-in admin can open, then the ones on the way.
 * Displays a branded welcome hero and an Odoo ERP-style application launcher.
 */
export default async function AdminAppsPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user as
    | { role?: string; name?: string | null; permissions?: string[]; companyId?: number | null }
    | undefined;

  let companyName: string | null = null;
  if (user?.companyId) {
    try {
      await connectMongoDB();
      const comp = await Company.findById(user.companyId).select("name").lean();
      companyName = comp?.name ?? null;
    } catch {
      // Fallback gracefully if database lookup fails
    }
  }

  return (
    <AppsMenu
      role={user?.role}
      permissions={user?.permissions}
      firstName={user?.name?.trim().split(/\s+/)[0]}
      companyName={companyName}
    />
  );
}
