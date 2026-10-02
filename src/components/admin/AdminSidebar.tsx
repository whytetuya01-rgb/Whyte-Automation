"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";

import { usePageLoading } from "@/components/providers/NavigationLoaderProvider";

const baseNavItems = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/categories", label: "Categories", icon: Tag },
  { href: "/admin/house-types", label: "House Types", icon: Home },
  { href: "/admin/room-types", label: "Room Types", icon: DoorOpen },
  { href: "/admin/quotations", label: "Quotations", icon: FileText },
  { href: "/admin/dealers", label: "Dealers", icon: Store },
  { href: "/admin/company", label: "Company", icon: Building2 },
];

export default function AdminSidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { startFullscreenLoading } = usePageLoading();

  const navItems = baseNavItems;

  const handleSignOut = () => {
    startFullscreenLoading();
    signOut({ callbackUrl: "/admin/login" });
  };

  return (
    <aside className="w-full bg-[#111111] flex flex-col h-full border-r border-[#1E1E22]">
      {/* Nav */}
      <nav className="flex-1 p-3 sm:p-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-all select-none relative cursor-pointer",
                isActive
                  ? "bg-[rgba(216,91,131,0.14)] text-white font-semibold border-l-3 border-l-[#D85B83] pl-3"
                  : "text-neutral-300 hover:text-white font-medium hover:bg-[#1E1E22] hover:border-[#2A2A30]"
              )}
            >
              <Icon
                size={18}
                className={cn(
                  "transition-colors duration-200 shrink-0",
                  isActive ? "text-[#D85B83]" : "text-neutral-400 group-hover:text-neutral-200"
                )}
              />
              <span className="truncate">{item.label}</span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#D85B83] shadow-[0_0_8px_rgba(216,91,131,0.7)]" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 sm:p-4 border-t border-neutral-850 shrink-0">
        <button
          onClick={handleSignOut}
          className="group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-all w-full cursor-pointer select-none border border-transparent hover:bg-neutral-900/50 hover:border-neutral-800"
        >
          <LogOut size={18} className="text-neutral-400 group-hover:text-neutral-200 transition-colors duration-200 shrink-0" />
          <span className="truncate">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
