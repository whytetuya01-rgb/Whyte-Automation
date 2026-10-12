"use client";

import { useRef, useState, type ElementType, type PointerEvent } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import ActiveIndicator from "./ActiveIndicator";
import AnimatedIcon, { type NavIconAnimation } from "./AnimatedIcon";
import CollapsedTooltip from "./CollapsedTooltip";
import { DURATION, EASE } from "./motionTokens";

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface AnimatedNavItemProps {
  href: string;
  label: string;
  icon: ElementType;
  animation: NavIconAnimation;
  isActive: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}

export default function AnimatedNavItem({
  href,
  label,
  icon,
  animation,
  isActive,
  collapsed,
  onNavigate,
}: AnimatedNavItemProps) {
  const reduceMotion = useReducedMotion();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);

  // Purely decorative and pointer-events-none, so it can never block navigation.
  const spawnRipple = (event: PointerEvent<HTMLAnchorElement>) => {
    if (reduceMotion || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const id = ++rippleId.current;
    setRipples((prev) => [...prev, { id, x: event.clientX - rect.left, y: event.clientY - rect.top }]);
  };

  return (
    <CollapsedTooltip label={label} enabled={collapsed}>
      <Link
        href={href}
        onClick={onNavigate}
        onPointerDown={spawnRipple}
        aria-label={collapsed ? label : undefined}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          // Fixed min-heights (= the current rendered heights) so removing the label in rail mode can't change row height.
          "nav-anim-trigger group relative flex min-h-[38px] items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-xs font-semibold sm:min-h-[42px] sm:text-sm",
          // Tailwind v4: scale-* uses the standalone `scale` property, so it must be listed explicitly.
          "cursor-pointer select-none outline-hidden transition-[color,scale] duration-[var(--motion-fast)] ease-[var(--motion-ease)] active:scale-[0.98]",
          "focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-[#D85B83]",
          isActive ? "text-white" : "text-neutral-300 hover:text-white/95 focus-visible:text-white/95"
        )}
      >
        {/* Ghost pill (hover / keyboard focus) on inactive items. */}
        {!isActive && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-xl bg-white/[0.04] opacity-0 transition-opacity duration-[var(--motion-fast)] ease-[var(--motion-ease)] group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}

        {isActive && <ActiveIndicator collapsed={collapsed} />}

        {/* Click ripple, clipped to the pill. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
          <AnimatePresence>
            {ripples.map((r) => (
              <motion.span
                key={r.id}
                className="absolute h-28 w-28 rounded-full"
                style={{
                  left: r.x - 56,
                  top: r.y - 56,
                  background: "radial-gradient(circle, rgba(216,91,131,0.35) 0%, rgba(216,91,131,0) 70%)",
                }}
                initial={{ scale: 0, opacity: 1 }}
                animate={{ scale: 1, opacity: 0 }}
                transition={{ duration: 0.45, ease: EASE }}
                onAnimationComplete={() => setRipples((prev) => prev.filter((p) => p.id !== r.id))}
              />
            ))}
          </AnimatePresence>
        </span>

        <span className="relative z-10 inline-flex transition-transform duration-[var(--motion-fast)] ease-[var(--motion-ease)] group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5">
          <AnimatedIcon
            icon={icon}
            animation={animation}
            play={isActive}
            className={cn(
              "transition-colors duration-[var(--motion-base)] ease-[var(--motion-ease)]",
              isActive ? "text-[#D85B83]" : "text-neutral-400 group-hover:text-white"
            )}
          />
        </span>

        {/* Label: fades + slides out in the first 120ms of a collapse, back in once the expand settles. */}
        <AnimatePresence initial={false} mode="popLayout">
          {!collapsed && (
            <motion.span
              key="label"
              className="relative z-10 truncate transition-colors duration-[var(--motion-base)]"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0, transition: { delay: DURATION.layout, duration: DURATION.base, ease: EASE } }}
              exit={{ opacity: 0, x: -6, transition: { duration: 0.12, ease: EASE } }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>

        {isActive && !collapsed && (
          <span aria-hidden="true" className="nav-active-dot relative z-10 ml-auto h-1.5 w-1.5 rounded-full bg-[#D85B83] shadow-[0_0_6px_rgba(216,91,131,0.9)]" />
        )}
      </Link>
    </CollapsedTooltip>
  );
}
