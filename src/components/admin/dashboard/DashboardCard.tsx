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
 * The canonical executive card shell used across the dashboard.
 * Designed with Linear / Stripe aesthetics: clean white surface, subtle micro-shadow,
 * crisp border, and structured typography.
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
        "bg-white rounded-2xl border border-[#E5E5E7] flex flex-col min-w-0",
        "shadow-[0_1px_3px_0_rgba(0,0,0,0.02)] transition-all duration-200",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3.5 border-b border-[#F0F0F2]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon && (
              <span className="w-6 h-6 rounded-lg bg-[#F6F6F7] border border-[#E5E5E7] flex items-center justify-center shrink-0 text-[#5F5F68]">
                <Icon size={13} aria-hidden="true" />
              </span>
            )}
            <h2 className="text-sm font-semibold text-[#111111] tracking-tight leading-tight flex items-center gap-2">
              <span>{title}</span>
              {badge}
            </h2>
          </div>
          {description && (
            <p className="text-xs text-[#8A8A93] mt-0.5 font-normal leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {action && (
          <Link
            href={action.href}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#5F5F68] hover:text-[#111111] hover:underline underline-offset-2 transition-colors self-center"
          >
            <span>{action.label}</span>
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        )}
      </header>

      <div className={cn("flex-1 min-w-0", flush ? "" : "p-5")}>
        {children}
      </div>
    </section>
  );
}
