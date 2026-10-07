import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardCardProps {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  className?: string;
  /** Remove the body padding, for full-bleed lists and tables. */
  flush?: boolean;
  children: React.ReactNode;
}

/** The single card shell used by every dashboard widget. */
export default function DashboardCard({ title, description, action, className, flush = false, children }: DashboardCardProps) {
  return (
    <section className={cn("bg-white rounded-2xl border border-[#E5E5E7] flex flex-col min-w-0", className)}>
      <header className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#111111] leading-tight">{title}</h2>
          {description && <p className="text-xs text-[#8A8A93] mt-0.5">{description}</p>}
        </div>
        {action && (
          <Link
            href={action.href}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[#5F5F68] hover:text-[#B83E68] transition-colors"
          >
            {action.label}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        )}
      </header>
      <div className={cn("flex-1 min-w-0", flush ? "" : "px-4 sm:px-5 pb-4 sm:pb-5")}>{children}</div>
    </section>
  );
}
