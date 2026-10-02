"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AnimationItem } from "lottie-web";

export interface ApiLoaderProps {
  loading: boolean;
  className?: string;
  animationData?: any;
}

export default function ApiLoader({
  loading,
  className,
  animationData,
}: ApiLoaderProps) {
  const [shouldRender, setShouldRender] = useState(loading);
  const [isExiting, setIsExiting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);

  // Smooth fade-in & fade-out transitions
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (loading) {
      setShouldRender(true);
      setIsExiting(false);
    } else if (shouldRender) {
      setIsExiting(true);
      timer = setTimeout(() => {
        setShouldRender(false);
        setIsExiting(false);
      }, 160);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [loading, shouldRender]);

  // Lock body scroll while overlay is active
  useEffect(() => {
    if (!shouldRender || isExiting) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [shouldRender, isExiting]);

  // Initialize and run the Glass.json Lottie animation via lottie-web
  useEffect(() => {
    if (!shouldRender) return;

    let isMounted = true;

    async function initLottie() {
      try {
        const lottieModule = await import("lottie-web");
        const lottie = lottieModule.default || lottieModule;

        if (!isMounted || !containerRef.current) return;

        if (animRef.current) {
          animRef.current.destroy();
          animRef.current = null;
        }

        const config: any = {
          container: containerRef.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          rendererSettings: {
            preserveAspectRatio: "xMidYMid meet",
            progressiveLoad: true,
          },
        };

        if (animationData) {
          config.animationData = animationData;
        } else {
          config.path = "/loaders/Glass.json";
        }

        animRef.current = lottie.loadAnimation(config);
      } catch (err) {
        console.warn("Failed to load Glass.json Lottie animation:", err);
      }
    }

    initLottie();

    return () => {
      isMounted = false;
      if (animRef.current) {
        animRef.current.destroy();
        animRef.current = null;
      }
    };
  }, [shouldRender, animationData]);

  if (!shouldRender) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-busy="true"
      aria-label="Loading..."
      className={cn(
        "fixed inset-0 z-[99999] flex items-center justify-center select-none cursor-wait pointer-events-auto",
        "transition-opacity duration-150 ease-out",
        // Subtle semi-transparent neutral overlay keeping the page recognizable while dimming it
        "bg-black/25 dark:bg-black/45 backdrop-blur-[2px]",
        isExiting ? "opacity-0" : "opacity-100",
        className
      )}
      onClick={(e) => {
        // Prevent all clicks & interactions on the page underneath while request is active
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {/* Clean centered Lottie animation (No large square/card, No duplicate text) */}
      <div
        className={cn(
          "relative flex items-center justify-center pointer-events-none transition-transform duration-150",
          isExiting ? "scale-95" : "scale-100"
        )}
      >
        <div
          ref={containerRef}
          className="w-44 sm:w-52 md:w-60 h-28 sm:h-32 md:h-36 flex items-center justify-center drop-shadow-sm"
        />
      </div>
    </div>
  );
}
