import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminLayoutWrapper from "@/components/admin/AdminLayoutWrapper";
import { isSessionActorStillValid } from "@/lib/sessionGuard";

const ADMIN_ROLES = new Set(["super_admin", "admin"]);

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");
  const role = (session.user as { role?: string }).role;
  if (role === "dealer" || role === "sales") redirect("/");
  if (!role || !ADMIN_ROLES.has(role)) redirect("/admin/login");

  // Revalidate (short TTL cache) that this account is still real, active and
  // the same role, so a deactivated admin's existing session stops working
  // within the cache window instead of for the rest of its 30-day JWT life.
  const userId = Number((session.user as { id?: string }).id);
  if (!(await isSessionActorStillValid(userId, role))) {
    redirect("/admin/login");
  }

  return (
    <AdminLayoutWrapper>
      {children}
    </AdminLayoutWrapper>
  );
}
