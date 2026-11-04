import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What a list shows when it has nothing to show, the same on every admin screen: the icon in a soft tile with a faint
 * accent halo, a short title, one helpful line and an optional action. `compact` fits inside a card section.
 */
export default function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  compact = false,
  className,
  "data-testid": testId,
}: {
  icon: LucideIcon;
  title: string;
  text?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16", className)} data-testid={testId}>
      <span className="relative flex items-center justify-center" aria-hidden="true">
        {!compact && <span className="absolute h-20 w-20 rounded-full opacity-60 blur-xl" style={{ background: "color-mix(in srgb, var(--color-accent) 18%, transparent)" }} />}
        <span className={cn("relative flex items-center justify-center rounded-2xl border border-neutral-200/80 bg-white text-neutral-400 shadow-[0_1px_2px_rgba(16,16,20,0.05)]", compact ? "h-10 w-10" : "h-14 w-14")}>
          <Icon size={compact ? 18 : 24} strokeWidth={1.8} />
        </span>
      </span>
      <div className="max-w-sm space-y-1">
        <h3 className={cn("font-semibold tracking-tight text-neutral-900", compact ? "text-sm" : "text-base")}>{title}</h3>
        {text && <p className="text-xs leading-relaxed text-neutral-500">{text}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
