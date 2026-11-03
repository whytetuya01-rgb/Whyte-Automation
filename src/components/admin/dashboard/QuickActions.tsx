import Link from "next/link";
import {
  Building2,
  DoorOpen,
  FolderTree,
  Home,
  Package,
  Plus,
  Users,
  type LucideIcon,
} from "lucide-react";

interface QuickAction {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const ACTIONS: QuickAction[] = [
  { href: "/admin/products", label: "Add Product", description: "Hardware & variants", icon: Package },
  { href: "/admin/dealers", label: "Partner Network", description: "Dealers & allocations", icon: Users },
  { href: "/admin/categories", label: "Categories", description: "Catalog hierarchy", icon: FolderTree },
  { href: "/admin/house-types", label: "House Templates", description: "Villas & apartments", icon: Home },
  { href: "/admin/room-types", label: "Room Presets", description: "Living, master bed...", icon: DoorOpen },
  { href: "/admin/company", label: "Branding & Details", description: "Logo, theme & socials", icon: Building2 },
];

/**
 * Executive Quick Launchpad modeled after Linear & Vercel control centers.
 * Features icon-forward action tiles, micro-descriptions, and interactive hover cues.
 */
export default function QuickActions() {
  return (
    <div className="space-y-3">
      {/* Primary Hero Action */}
      <Link
        href="/quotation/new"
        className="group relative flex items-center justify-between h-11 px-4 rounded-xl bg-[#111111] text-white text-xs font-semibold hover:bg-[#1E1E22] transition-all shadow-xs overflow-hidden"
      >
        <span
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"
          aria-hidden="true"
        />
        <span className="flex items-center gap-2">
          <Plus size={16} className="text-[var(--color-admin-primary,#D85B83)] shrink-0" aria-hidden="true" />
          <span>Create New Quotation</span>
        </span>
        <span className="text-[10px] font-mono text-neutral-400 bg-white/10 px-1.5 py-0.5 rounded">
          ⌘N
        </span>
      </Link>

      {/* Grid of Secondary Shortcuts */}
      <div className="grid grid-cols-3 gap-2">
        {ACTIONS.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={`${label}: ${description}`}
            className="group flex min-w-0 flex-col items-center gap-1.5 rounded-xl border border-[#E5E5E7] bg-white px-1.5 py-3 text-center transition-all duration-150 hover:border-neutral-300 hover:bg-[#F6F6F7]/60 hover:shadow-2xs"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E5E5E7] bg-[#F6F6F7] text-[#5F5F68] transition-colors group-hover:border-neutral-300 group-hover:bg-white group-hover:text-[var(--color-admin-primary,#D85B83)]">
              <Icon size={14} aria-hidden="true" />
            </span>
            <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-[#111111]">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
