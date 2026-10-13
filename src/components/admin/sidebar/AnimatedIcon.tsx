import type { ElementType } from "react";
import { cn } from "@/lib/utils";

/**
 * Per-icon micro-animation names. Each maps to `[data-icon="…"]` keyframes in
 * globals.css that target the real lucide SVG parts (rects/paths, by order),
 * e.g. the Dashboard tiles or the Quotations text lines. Anything not listed
 * falls back to the generic nudge.
 */
export type NavIconAnimation =
  | "dashboard"
  | "products"
  | "categories"
  | "house-types"
  | "room-types"
  | "quotations"
  | "dealers"
  | "activity"
  | "company"
  | "sign-out"
  | "generic";

export const NAV_ICON_ANIMATION_BY_HREF: Record<string, NavIconAnimation> = {
  "/admin/dashboard": "dashboard",
  "/admin/products": "products",
  "/admin/categories": "categories",
  "/admin/house-types": "house-types",
  "/admin/room-types": "room-types",
  "/admin/quotations": "quotations",
  "/admin/dealers": "dealers",
  "/admin/activity": "activity",
  "/admin/users": "generic",
  "/admin/roles": "generic",
  "/admin/company": "company",
};

interface AnimatedIconProps {
  icon: ElementType;
  animation: NavIconAnimation;
  size?: number;
  className?: string;
  /**
   * Play the animation once (used when the item becomes active). Hover/focus
   * on the parent `.nav-anim-trigger` plays it as well.
   */
  play?: boolean;
}

export default function AnimatedIcon({ icon: Icon, animation, size = 17, className, play = false }: AnimatedIconProps) {
  return (
    <span
      data-icon={animation}
      className={cn("nav-icon inline-flex shrink-0", play && "nav-icon-play")}
      aria-hidden="true"
    >
      <Icon size={size} className={className} />
    </span>
  );
}
