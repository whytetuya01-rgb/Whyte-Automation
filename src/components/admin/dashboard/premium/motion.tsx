"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion, type Variants } from "motion/react";
import { EASE } from "@/components/admin/sidebar/motionTokens";

/** A number that counts up to its value when it scrolls into view (and simply shows it for reduced-motion users). */
export function CountUp({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 1.1,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-30px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, { duration, ease: EASE, onUpdate: (latest) => setDisplay(latest) });
    return () => controls.stop();
  }, [inView, value, reduce, duration]);

  return (
    <span ref={ref} className={className} data-value={value}>
      {format(reduce ? value : display)}
    </span>
  );
}

/** A tab panel and its children: the panel fades in and its children rise one after another. */
export const panelVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2, staggerChildren: 0.07, delayChildren: 0.03 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export const riseVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
};
