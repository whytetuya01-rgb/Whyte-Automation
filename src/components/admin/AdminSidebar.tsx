"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Tag,
  Home,
  DoorOpen,
  FileText,
  Building2,
  LogOut,
  Store,
  UserCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { useConfirmSignOut } from "@/components/shared/SignOutButton";
import { usePageLoading } from "@/components/providers/NavigationLoaderProvider";

interface NavGroup {
  title: string;
  items: {
    href: string;
    label: string;
    icon: React.ElementType;
  }[];
}

const navGroups: NavGroup[] = [
  {
    title: "OVERVIEW",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "CATALOG MANAGEMENT",
    items: [
      { href: "/admin/products", label: "Products", icon: Package },
      { href: "/admin/categories", label: "Categories", icon: Tag },
      { href: "/admin/house-types", label: "House Types", icon: Home },
      { href: "/admin/room-types", label: "Room Types", icon: DoorOpen },
    ],
  },
  {
    title: "PROPOSALS & DEALERS",
    items: [
      { href: "/admin/quotations", label: "Quotations", icon: FileText },
      { href: "/admin/dealers", label: "Dealers", icon: Store },
    ],
  },
  {
    title: "SYSTEM SETTINGS",
    items: [
      { href: "/admin/company", label: "Company Profile", icon: Building2 },
    ],
  },
];

export default function AdminSidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { startFullscreenLoading } = usePageLoading();

  const confirmSignOut = useConfirmSignOut("/admin/login");

  const handleSignOut = () => {
    void confirmSignOut(startFullscreenLoading);
  };

  const userName = session?.user?.name || "Administrator";
  const userEmail = session?.user?.email || "";
  const userRole = (session?.user as { role?: string })?.role === "super_admin" ? "Super Admin" : "Admin";

  return (
    <aside className="w-full bg-[#111111] flex flex-col h-full border-r border-[#1E1E22] select-none">
      {/* Scrollable Navigation Groups */}
      <nav className="flex-1 p-3 sm:p-4 space-y-6 overflow-y-auto custom-scrollbar">
        {navGroups.map((group) => (
          <div key={group.title} className="space-y-1.5">
            <div className="px-3 text-[10px] font-bold text-[#666672] uppercase tracking-wider flex items-center gap-1.5">
              <span>{group.title}</span>
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || (item.href !== "/admin/dashboard" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer",
                      isActive
                        ? "bg-[#D85B83]/15 text-white border border-[#D85B83]/30 shadow-[0_0_15px_rgba(216,91,131,0.12)]"
                        : "text-neutral-300 hover:text-white hover:bg-white/[0.06] border border-transparent glass-nav-hover"
                    )}
                  >
                    {/* Active Left Indicator Bar */}
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-1 bg-[#D85B83] rounded-r-full shadow-[0_0_8px_#D85B83]" />
                    )}
                    <Icon
                      size={17}
                      className={cn(
                        "transition-colors duration-200 shrink-0",
                        isActive ? "text-[#D85B83]" : "text-neutral-400 group-hover:text-white"
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#D85B83] shadow-[0_0_6px_rgba(216,91,131,0.9)]" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User Profile & Sign Out Footer */}
      <div className="p-3.5 border-t border-[#1E1E22] shrink-0 bg-[#0A0A0C] space-y-2">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl bg-white/[0.03] border border-white/5">
          <div className="w-8 h-8 rounded-lg bg-[#D85B83]/20 border border-[#D85B83]/40 text-[#D85B83] flex items-center justify-center font-bold text-xs shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <p className="text-xs font-bold text-white truncate">{userName}</p>
              <span className="text-[9px] font-bold text-[#D85B83] bg-[#D85B83]/10 border border-[#D85B83]/20 px-1.5 py-0.2 rounded-md uppercase tracking-wider">
                {userRole}
              </span>
            </div>
            {userEmail && (
              <p className="text-[11px] text-neutral-400 truncate">{userEmail}</p>
            )}
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className="group flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-neutral-400 hover:text-white hover:bg-red-500/10 hover:border-red-500/30 transition-all w-full cursor-pointer border border-transparent"
        >
          <LogOut size={15} className="text-neutral-400 group-hover:text-red-400 transition-colors shrink-0" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}

