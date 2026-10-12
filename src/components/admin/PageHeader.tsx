import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Bold dark-charcoal page title. */
  title: string;
  /** Short descriptive sentence shown in muted grey below the title. */
  subtitle?: React.ReactNode;
  /** Page-specific icon, rendered inline before the title in Whyte pink. */
  icon?: LucideIcon;
  /** Optional inline node rendered next to the title (e.g. a count badge). */
  badge?: React.ReactNode;
  /** Optional breadcrumb navigation rendered above the title. */
  breadcrumbs?: React.ReactNode;
  /** Optional right-side actions, aligned with the title area. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Canonical admin page header — pink inline icon, bold charcoal title, muted
 * subtitle, optional breadcrumbs / badge / right-side actions. Matches the
 * Activity Log reference design and is the single source of truth for page
 * titles across the admin panel.
 */
export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  badge,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {breadcrumbs && <div className="mb-2">{breadcrumbs}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="flex min-w-0 items-center gap-2 text-xl font-bold text-neutral-900 sm:text-2xl">
            {Icon && <Icon size={22} className="shrink-0 text-accent" aria-hidden="true" />}
            <span className="min-w-0 break-words">{title}</span>
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
          {actions}
        </div>
      )}
    </div>
  );
}
