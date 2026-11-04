import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Page title. */
  title: string;
  /** Short descriptive sentence shown in muted grey below the title. */
  subtitle?: React.ReactNode;
  /** Page-specific icon, shown in a soft accent tile before the title. */
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
 * Canonical admin page header: the page's icon in a soft accent tile, a confident title, a muted one-line subtitle and
 * optional breadcrumbs / badge / right-side actions. The single source of truth for page titles across the admin panel;
 * it rises in with the page (see "Admin content motion" in globals.css).
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
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)} data-testid="page-header">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/15 text-accent shadow-[0_1px_2px_rgba(16,16,20,0.05)] sm:h-11 sm:w-11"
            style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, #fff), color-mix(in srgb, var(--color-accent) 4%, #fff))" }}
            aria-hidden="true"
          >
            <Icon size={20} strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0">
          {breadcrumbs && <div className="mb-1.5">{breadcrumbs}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight text-neutral-950 sm:text-[1.6rem] sm:leading-tight">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-neutral-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto">{actions}</div>}
    </div>
  );
}
