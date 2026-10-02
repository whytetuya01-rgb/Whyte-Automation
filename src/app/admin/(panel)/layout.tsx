import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminLayoutWrapper from "@/components/admin/AdminLayoutWrapper";

const ADMIN_ROLES = new Set(["super_admin", "admin"]);

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");
  const role = (session.user as { role?: string }).role;
  if (role === "dealer" || role === "sales") redirect("/");
  if (!role || !ADMIN_ROLES.has(role)) redirect("/admin/login");

  return (
    <AdminLayoutWrapper>
      {children}
    </AdminLayoutWrapper>
  );
}
