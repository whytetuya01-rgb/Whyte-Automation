"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE } from "./motionTokens";

/**
 * Wraps a sidebar control and, while `enabled` (collapsed mode), shows its
 * label in a tooltip to the right on hover or keyboard focus. Portalled to
 * <body> with fixed positioning: the sidebar's scrolling nav (and its
 * transformed container) would otherwise clip it.
 */
export default function CollapsedTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const show = (el: HTMLElement) => {
    if (enabled) setAnchor(el.getBoundingClientRect());
  };
  const hide = () => setAnchor(null);

  return (
    <div
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={hide}
    >
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {enabled && anchor && (
              <motion.div
                role="tooltip"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0, transition: { delay: 0.12, duration: DURATION.fast, ease: EASE } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                style={{ position: "fixed", top: anchor.top + anchor.height / 2, left: anchor.right + 12, y: "-50%", zIndex: "var(--z-dropdown)" }}
                className="pointer-events-none whitespace-nowrap rounded-lg border border-white/10 border-l-[var(--color-admin-primary,#D85B83)] bg-[#151518] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-black/40"
              >
                {label}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
