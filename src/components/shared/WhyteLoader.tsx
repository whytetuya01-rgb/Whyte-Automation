"use client";

import WhyteLogo from "@/components/shared/WhyteLogo";
import { cn } from "@/lib/utils";

export interface WhyteLoaderProps {
  variant?: "fullscreen" | "content";
  isExiting?: boolean;
  className?: string;
  message?: string;
}

export default function WhyteLoader({
  variant = "content",
  isExiting = false,
  className,
  message = "Loading...",
}: WhyteLoaderProps) {
  const isFullScreen = variant === "fullscreen";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message}
      className={cn(
        "flex flex-col items-center justify-center select-none transition-opacity duration-300 ease-out",
        isFullScreen
          ? "fixed inset-0 z-[999999] bg-white pointer-events-auto"
          : "w-full h-full min-h-[55vh] flex-1 bg-gray-50 pointer-events-auto py-12 sm:py-20",
        isExiting ? "opacity-0 pointer-events-none" : "opacity-100",
        className
      )}
    >
      <div className="relative flex flex-col items-center justify-center">
        {/* Logo Container with Left-to-Right Reveal Animation */}
        <div className="relative w-[180px] sm:w-[220px] md:w-[250px] aspect-[43/10] flex items-center justify-center">
          {/* Base Layer: Subdued background track */}
          <div className="absolute inset-0 flex items-center justify-center opacity-15 pointer-events-none">
            <WhyteLogo
              theme="light"
              alt="Whyte Automations"
              width={250}
              preload
              className="w-full h-auto"
            />
          </div>

          {/* Top Reveal Layer: Progressive Left-to-Right sweep */}
          <div className="absolute inset-0 flex items-center justify-center animate-whyte-reveal pointer-events-none">
            <WhyteLogo
              theme="light"
              alt="Whyte Automations"
              width={250}
              className="w-full h-auto"
            />
          </div>
        </div>

        {/* Subtle Bottom Loading Progress Beam */}
        <div className="relative w-28 sm:w-36 h-[2.5px] mt-4 bg-slate-200/80 rounded-full overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-accent to-transparent animate-whyte-glow" />
        </div>

        {/* Screen reader only announcement */}
        <span className="sr-only">Whyte is loading, please wait...</span>
      </div>
    </div>
  );
}

export function WhyteFullScreenLoader(
  props: Omit<WhyteLoaderProps, "variant">
) {
  return <WhyteLoader variant="fullscreen" {...props} />;
}

export function WhyteContentLoader(
  props: Omit<WhyteLoaderProps, "variant">
) {
  return <WhyteLoader variant="content" {...props} />;
}

// Backward compatibility alias
export { WhyteLoader as GlobalPageLoader };
