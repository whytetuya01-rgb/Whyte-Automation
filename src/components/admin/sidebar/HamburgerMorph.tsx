"use client";

import { motion } from "motion/react";
import { DURATION, EASE } from "./motionTokens";

export type HamburgerState = "menu" | "close" | "arrow";

type Line = { x1: number; y1: number; x2: number; y2: number; opacity: number };

/**
 * Three-line icon that morphs between: `menu` (≡), `close` (×, mobile drawer
 * open) and `arrow` (desktop sidebar collapsed — the arrow is drawn pointing
 * left and the whole glyph rotates 180°, so it ends up pointing right, i.e.
 * "expand").
 */
const SHAPES: Record<HamburgerState, { lines: [Line, Line, Line]; rotate: number }> = {
  menu: {
    rotate: 0,
    lines: [
      { x1: 4, y1: 6, x2: 20, y2: 6, opacity: 1 },
      { x1: 4, y1: 12, x2: 20, y2: 12, opacity: 1 },
      { x1: 4, y1: 18, x2: 20, y2: 18, opacity: 1 },
    ],
  },
  close: {
    rotate: 90,
    lines: [
      { x1: 6, y1: 6, x2: 18, y2: 18, opacity: 1 },
      { x1: 12, y1: 12, x2: 12, y2: 12, opacity: 0 },
      { x1: 6, y1: 18, x2: 18, y2: 6, opacity: 1 },
    ],
  },
  arrow: {
    rotate: 180,
    lines: [
      { x1: 5, y1: 12, x2: 11, y2: 6, opacity: 1 },
      { x1: 5, y1: 12, x2: 19, y2: 12, opacity: 1 },
      { x1: 5, y1: 12, x2: 11, y2: 18, opacity: 1 },
    ],
  },
};

export default function HamburgerMorph({ state, size = 18 }: { state: HamburgerState; size?: number }) {
  const shape = SHAPES[state];
  const transition = { duration: DURATION.base, ease: EASE };
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      initial={false}
      animate={{ rotate: shape.rotate }}
      transition={transition}
    >
      {shape.lines.map((line, i) => (
        <motion.line key={i} initial={false} animate={line} transition={transition} />
      ))}
    </motion.svg>
  );
}
