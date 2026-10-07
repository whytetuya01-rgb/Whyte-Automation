import Link from "next/link";
import { Building2, DoorOpen, FolderTree, Home, Package, Plus, Users, type LucideIcon } from "lucide-react";

interface QuickAction {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Every link here is reachable by both Super Admin and Admin (the whole admin
 * panel is limited to those two roles), so no action is shown to someone who
 * cannot use it.
 */
const ACTIONS: QuickAction[] = [
  { href: "/admin/products", label: "Add Product", icon: Package },
  { href: "/admin/dealers", label: "Dealers", icon: Users },
  { href: "/admin/categories", label: "Categories", icon: FolderTree },
  { href: "/admin/house-types", label: "House Templates", icon: Home },
  { href: "/admin/room-types", label: "Room Presets", icon: DoorOpen },
  { href: "/admin/company", label: "Company Profile", icon: Building2 },
];

export default function QuickActions() {
  return (
    <div className="space-y-2.5">
      <Link
        href="/quotation/new"
        className="flex items-center justify-center gap-2 h-10 rounded-xl bg-[#111111] text-white text-sm font-medium hover:bg-[#1E1E22] transition-colors"
      >
        <Plus size={15} aria-hidden="true" />
        New Quotation
      </Link>
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2 h-9 px-2.5 rounded-lg border border-[#E5E5E7] text-xs font-medium text-[#3F3F46] hover:border-[#F1B8C8] hover:bg-[#FFF6F8] hover:text-[#B83E68] transition-colors min-w-0"
          >
            <Icon size={14} className="shrink-0 text-[#D85B83]" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
