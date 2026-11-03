import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  badge?: React.ReactNode;
  action?: { href: string; label: string };
  className?: string;
  /** Remove the body padding, for full-bleed lists and tables. */
  flush?: boolean;
  children: React.ReactNode;
}

/**
 * Premium Executive Card shell with subtle specular highlights,
 * micro-elevation, and refined action links.
 */
export default function DashboardCard({
  title,
  description,
  icon: Icon,
  badge,
  action,
  className,
  flush = false,
  children,
}: DashboardCardProps) {
  return (
    <section
      className={cn(
        "group/card bg-white rounded-2xl border border-[#E5E5E7] flex flex-col min-w-0 overflow-hidden",
        "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.03),0_1px_2px_0_rgba(0,0,0,0.02)]",
        "hover:shadow-[0_12px_28px_-8px_rgba(0,0,0,0.06)] hover:border-neutral-300/80 transition-all duration-300",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3.5 border-b border-[#F0F0F2] bg-gradient-to-b from-white to-[#FAFAFB]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon && (
              <span className="w-6 h-6 rounded-lg bg-[#F6F6F7] border border-[#E5E5E7] flex items-center justify-center shrink-0 text-[#5F5F68] group-hover/card:text-[var(--color-admin-primary,#D85B83)] group-hover/card:border-[var(--color-admin-primary-border,#F1B8C8)] transition-colors">
                <Icon size={13} aria-hidden="true" />
              </span>
            )}
            <h2 className="text-sm font-bold text-[#111111] tracking-tight leading-tight flex items-center gap-2">
              <span>{title}</span>
              {badge}
            </h2>
          </div>
          {description && (
            <p className="text-xs text-[#8A8A93] mt-0.5 font-normal leading-normal truncate">
              {description}
            </p>
          )}
        </div>

        {action && (
          <Link
            href={action.href}
            className="group/link shrink-0 inline-flex items-center gap-1 text-xs font-bold text-[var(--color-admin-primary-foreground,#B83E68)] hover:text-[#111111] transition-colors"
          >
            <span>{action.label}</span>
            <ArrowRight size={12} className="transition-transform duration-200 group-hover/link:translate-x-0.5" />
          </Link>
        )}
      </header>

      <div className={cn("flex-1 min-w-0", !flush && "p-5")}>
        {children}
      </div>
    </section>
  );
}
