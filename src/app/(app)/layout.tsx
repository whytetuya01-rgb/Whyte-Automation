import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import WhyteLogo from "@/components/shared/WhyteLogo";
import { LogOut, Plus, FileText, LayoutDashboard, User, Wallet } from "lucide-react";

const ALLOWED_APP_ROLES = new Set(["dealer", "super_admin", "admin"]);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string; name?: string; email?: string } | undefined)?.role;
  const userName = session?.user?.name || session?.user?.email || "User";

  if (!session?.user) redirect("/login");
  if (!role || !ALLOWED_APP_ROLES.has(role)) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 shadow-xs sticky top-0 z-40">
        <div className="max-w-[95%] 2xl:max-w-[1760px] mx-auto px-4 py-2.5 md:px-6 md:py-3 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-6 min-w-0">
            <Link
              href="/"
              className="inline-flex items-center rounded-xl px-2 py-1 hover:bg-gray-50 transition shrink-0"
              aria-label="Go to home"
            >
              <WhyteLogo
                theme="light"
                alt="Whyte logo"
                size="header"
                preload
              />
            </Link>

            {/* Navigation links based on role */}
            <nav className="hidden sm:flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 hover:text-gray-950 hover:bg-gray-100 transition"
              >
                <FileText size={15} />
                <span>Quotations</span>
              </Link>

              {role === "dealer" && (
                <>
                  <Link
                    href="/earnings"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 hover:text-gray-950 hover:bg-gray-100 transition"
                  >
                    <Wallet size={15} />
                    <span>Earnings</span>
                  </Link>
                  <Link
                    href="/profile"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 hover:text-gray-950 hover:bg-gray-100 transition"
                  >
                    <User size={15} />
                    <span>View Profile</span>
                  </Link>
                </>
              )}

              {(role === "super_admin" || role === "admin") && (
                <Link
                  href="/admin/dashboard"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 transition"
                >
                  <LayoutDashboard size={15} />
                  <span>Admin Panel</span>
                </Link>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/quotation/new"
              className="inline-flex items-center gap-1.5 bg-black hover:bg-neutral-800 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-xs transition"
            >
              <Plus size={15} />
              <span>New Quotation</span>
            </Link>

            {role === "dealer" ? (
              <Link
                href="/profile"
                className="hidden md:flex flex-col items-end pl-2 text-right group hover:opacity-80 transition cursor-pointer"
                title="View Profile"
              >
                <span className="text-xs font-semibold text-gray-900 group-hover:text-admin-primary transition truncate max-w-[140px]">{userName}</span>
                <span className="text-[10px] font-medium text-admin-primary uppercase tracking-wider">
                  Dealer
                </span>
              </Link>
            ) : (
              <div className="hidden md:flex flex-col items-end pl-2 text-right">
                <span className="text-xs font-semibold text-gray-900 truncate max-w-[140px]">{userName}</span>
                <span className="text-[10px] font-medium text-admin-primary uppercase tracking-wider">
                  {role === "super_admin" ? "Super Admin" : "Admin"}
                </span>
              </div>
            )}

            <Link
              href="/api/auth/signout?callbackUrl=/login"
              className="inline-flex items-center gap-1 text-gray-500 hover:text-red-600 p-2 rounded-lg hover:bg-gray-100 transition"
              title="Sign Out"
            >
              <LogOut size={16} />
            </Link>
          </div>
        </div>

        {/* Mobile secondary navigation bar */}
        <div className="sm:hidden flex items-center gap-1 px-4 py-2 border-t border-gray-100 bg-gray-50/50 overflow-x-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-700 hover:text-gray-950 hover:bg-gray-200/60 transition shrink-0"
          >
            <FileText size={13} />
            <span>Quotations</span>
          </Link>
          {role === "dealer" && (
            <>
              <Link
                href="/earnings"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-700 hover:text-gray-950 hover:bg-gray-200/60 transition shrink-0"
              >
                <Wallet size={13} />
                <span>Earnings</span>
              </Link>
              <Link
                href="/profile"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-700 hover:text-gray-950 hover:bg-gray-200/60 transition shrink-0"
              >
                <User size={13} />
                <span>View Profile</span>
              </Link>
            </>
          )}
        </div>
      </header>
      <main className="max-w-[95%] 2xl:max-w-[1760px] mx-auto px-2 sm:px-4 py-4 md:py-6 lg:py-8 flex-1 w-full">{children}</main>
    </div>
  );
}
