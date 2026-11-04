import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Colour of a stat's icon tile. The number itself always stays in the text colour. */
export type StatTone = "neutral" | "accent" | "emerald" | "sky" | "amber" | "rose" | "violet";

const TONE: Record<StatTone, string> = {
  neutral: "bg-neutral-100 text-neutral-600 border-neutral-200/70",
  accent: "border-accent/15 text-accent",
  emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
  sky: "bg-sky-50 text-sky-600 border-sky-100",
  amber: "bg-amber-50 text-amber-600 border-amber-100",
  rose: "bg-rose-50 text-rose-600 border-rose-100",
  violet: "bg-violet-50 text-violet-600 border-violet-100",
};

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  /** A short line under the number. */
  hint?: React.ReactNode;
  /** Makes the tile a button (for example a filter); `active` marks the chosen one. */
  onClick?: () => void;
  active?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * One summary number, the same on every admin screen: the icon in a soft tile, the label, the number and an optional
 * note. Tiles in a `StatGrid` rise in one after another; clickable ones lift a little on hover.
 */
export function StatTile({ label, value, icon: Icon, tone = "neutral", hint, onClick, active, className, "data-testid": testId }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span
            className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", TONE[tone])}
            style={tone === "accent" ? { background: "color-mix(in srgb, var(--color-accent) 10%, #fff)" } : undefined}
            aria-hidden="true"
          >
            <Icon size={15} strokeWidth={2} />
          </span>
        )}
        <p className="min-w-0 truncate text-xs font-medium text-neutral-500">{label}</p>
      </div>
      <p className="mt-2.5 truncate text-[1.45rem] font-semibold leading-none tracking-tight text-neutral-950">{value}</p>
      {hint && <p className="mt-1.5 truncate text-[11px] text-neutral-500">{hint}</p>}
    </>
  );
  const shell = cn(
    "min-w-0 rounded-2xl border bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,16,20,0.04)]",
    active ? "border-neutral-950 ring-1 ring-neutral-950" : "border-neutral-200/80",
    onClick && "admin-card-hover cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
    className
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={shell} data-testid={testId}>
        {body}
      </button>
    );
  }
  return (
    <div className={shell} data-testid={testId}>
      {body}
    </div>
  );
}

/** A row of stat tiles: two per row on a phone, up to `columns` on wide screens. */
export function StatGrid({ children, columns = 4, className, "data-testid": testId }: { children: React.ReactNode; columns?: 2 | 3 | 4 | 5; className?: string; "data-testid"?: string }) {
  const wide = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4", 5: "sm:grid-cols-3 xl:grid-cols-5" }[columns];
  return (
    <div className={cn("admin-stagger grid grid-cols-2 gap-3", wide, className)} data-testid={testId}>
      {children}
    </div>
  );
}
