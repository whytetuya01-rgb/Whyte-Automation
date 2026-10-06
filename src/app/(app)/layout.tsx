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

  const initials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="min-h-screen bg-[#f8f9fb] flex flex-col">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 shadow-xs sticky top-0 z-40">
        <div className="max-w-[95%] 2xl:max-w-[1760px] mx-auto px-4 py-1.5 md:px-6 md:py-2 lg:px-8 flex items-center justify-between">

          {/* Left: Logo + Nav */}
          <div className="flex items-center gap-4 sm:gap-5 min-w-0">
            <Link
              href="/"
              className="inline-flex items-center rounded-xl px-1.5 py-0.5 hover:bg-gray-50 transition shrink-0"
              aria-label="Go to home"
            >
              <WhyteLogo
                theme="light"
                alt="Whyte logo"
                size="header"
                preload
              />
            </Link>

            {/* Desktop nav */}
            <nav className="hidden sm:flex items-center gap-1">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-gray-600 hover:text-gray-950 hover:bg-gray-100 transition"
              >
                <FileText size={14} />
                <span>Quotations</span>
              </Link>

              {role === "dealer" && (
                <>
                  <Link
                    href="/earnings"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-gray-600 hover:text-gray-950 hover:bg-gray-100 transition"
                  >
                    <Wallet size={14} />
                    <span>Earnings</span>
                  </Link>
                  <Link
                    href="/profile"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-gray-600 hover:text-gray-950 hover:bg-gray-100 transition"
                  >
                    <User size={14} />
                    <span>Profile</span>
                  </Link>
                </>
              )}

              {(role === "super_admin" || role === "admin") && (
                <Link
                  href="/admin/dashboard"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 transition border border-purple-100"
                >
                  <LayoutDashboard size={14} />
                  <span>Admin Panel</span>
                </Link>
              )}
            </nav>
          </div>

          {/* Right: Actions + User */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <Link
              href="/quotation/new"
              className="inline-flex items-center gap-1.5 bg-gray-950 hover:bg-gray-800 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-2xs hover:shadow-xs transition-all duration-150 border border-gray-900"
            >
              <Plus size={14} />
              <span>New Quotation</span>
            </Link>

            {/* Avatar / user */}
            {role === "dealer" ? (
              <Link
                href="/profile"
                className="hidden md:flex items-center gap-2 pl-1.5 group hover:opacity-90 transition cursor-pointer"
                title="View Profile"
              >
                {/* Avatar circle */}
                <div className="w-7.5 h-7.5 rounded-full bg-gray-950 border border-gray-800 flex items-center justify-center text-white text-[11px] font-bold shrink-0 group-hover:bg-gray-800 transition">
                  {initials}
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-xs font-bold text-gray-900 truncate max-w-[120px] leading-tight">{userName}</span>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider leading-tight">
                    Dealer
                  </span>
                </div>
              </Link>
            ) : (
              <div className="hidden md:flex items-center gap-2 pl-1.5">
                <div className="w-7.5 h-7.5 rounded-full bg-purple-100 border border-purple-200 flex items-center justify-center text-purple-700 text-[11px] font-bold shrink-0">
                  {initials}
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-xs font-bold text-gray-900 truncate max-w-[120px] leading-tight">{userName}</span>
                  <span className="text-[10px] font-semibold text-purple-600 uppercase tracking-wider leading-tight">
                    {role === "super_admin" ? "Super Admin" : "Admin"}
                  </span>
                </div>
              </div>
            )}

            <Link
              href="/api/auth/signout?callbackUrl=/login"
              className="inline-flex items-center gap-1 text-gray-400 hover:text-red-500 p-1.5 rounded-xl hover:bg-red-50 transition"
              title="Sign Out"
            >
              <LogOut size={15} />
            </Link>
          </div>
        </div>

        {/* Mobile secondary nav */}
        <div className="sm:hidden flex items-center gap-1 px-4 py-1.5 border-t border-gray-100 bg-gray-50/50 overflow-x-auto">
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
                <span>Profile</span>
              </Link>
            </>
          )}
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main className="max-w-[95%] 2xl:max-w-[1760px] mx-auto px-2 sm:px-4 py-5 md:py-7 lg:py-9 flex-1 w-full">
        {children}
      </main>
    </div>
  );
}
