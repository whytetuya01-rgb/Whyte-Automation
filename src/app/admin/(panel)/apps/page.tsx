import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import AppsMenu from "@/components/admin/apps/AppsMenu";

export const metadata = { title: "Apps" };

/**
 * The admin Apps menu: every app the signed-in admin can open, then the ones on the way. It sits inside the admin panel
 * (top bar and sidebar), so it looks like the rest of the admin area. Visibility only: each target page and API checks
 * its own permission. The tiles and their motion live in AppsMenu.
 */
export default async function AdminAppsPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; name?: string | null } | undefined;
  return <AppsMenu role={user?.role} firstName={user?.name?.trim().split(/\s+/)[0]} />;
}
