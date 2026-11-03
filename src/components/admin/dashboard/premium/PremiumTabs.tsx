"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface PremiumTabItem<K extends string> {
  key: K;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
}

/** The dashboard's section tabs: a pill slides to the chosen tab; scrolls sideways on a phone. */
export default function PremiumTabs<K extends string>({ items, active, onChange }: { items: Array<PremiumTabItem<K>>; active: K; onChange: (key: K) => void }) {
  // On a phone the tab bar scrolls sideways: keep the chosen tab in view.
  useEffect(() => {
    document.getElementById(`dash-tab-${active}`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div className="relative" data-testid="dashboard-tabs">
      <div role="tablist" aria-label="Dashboard sections" className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-neutral-200/80 bg-white p-1.5 shadow-[0_1px_2px_rgba(16,16,20,0.04)] [scrollbar-width:none]">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              id={`dash-tab-${item.key}`}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`dash-panel-${item.key}`}
              onClick={() => onChange(item.key)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-admin-primary,#D85B83)]",
                isActive ? "text-white" : "text-neutral-500 hover:text-neutral-900"
              )}
            >
              {isActive && <motion.span layoutId="dash-tab-pill" className="absolute inset-0 rounded-xl bg-gradient-to-b from-[#26262C] to-[#101014] shadow-md" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <Icon size={15} className={cn("relative transition-colors", isActive ? "text-[var(--color-admin-primary-on-dark,#F08BAB)]" : "text-neutral-400")} />
              <span className="relative">{item.label}</span>
              {item.badge && (
                <span className={cn("relative rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums", isActive ? "bg-white/15 text-white" : "bg-neutral-100 text-neutral-500")}>{item.badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
