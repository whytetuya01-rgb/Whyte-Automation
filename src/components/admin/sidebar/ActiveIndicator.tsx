"use client";

import { motion } from "motion/react";
import { SPRING } from "./motionTokens";

/**
 * The active nav item's pink pill + left bar, as ONE shared element
 * (`layoutId="nav-active"`). Rendered only inside the active item, so on a
 * route change motion glides it from the old item to the new one. On first
 * mount there is no previous position, so it simply appears.
 *
 * Collapsed mode: the parent link is a 44px square, so `inset-0` makes this a
 * rounded square behind the icon, and the left bar is dropped.
 */
export default function ActiveIndicator({ collapsed }: { collapsed: boolean }) {
  return (
    <motion.span
      layoutId="nav-active"
      transition={SPRING}
      aria-hidden="true"
      // borderRadius as a style (not a class) so motion corrects it during the
      // layout animation instead of stretching the corners.
      style={{ borderRadius: 12 }}
      className="pointer-events-none absolute inset-0 border border-[#D85B83]/30 bg-[#D85B83]/15 shadow-[0_0_15px_rgba(216,91,131,0.12)] will-change-transform"
    >
      {!collapsed && (
        <motion.span
          layout
          className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#D85B83] shadow-[0_0_8px_#D85B83]"
        />
      )}
    </motion.span>
  );
}
