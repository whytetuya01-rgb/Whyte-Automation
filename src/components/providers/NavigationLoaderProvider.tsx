"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { WhyteFullScreenLoader } from "@/components/shared/WhyteLoader";

interface NavigationLoaderContextType {
  isPageLoading: boolean;
  isContentLoading: boolean;
  isFullscreenLoading: boolean;
  startFullscreenLoading: () => void;
  startContentLoading: () => void;
  stopLoading: () => void;
}

const NavigationLoaderContext = createContext<NavigationLoaderContextType>({
  isPageLoading: false,
  isContentLoading: false,
  isFullscreenLoading: false,
  startFullscreenLoading: () => {},
  startContentLoading: () => {},
  stopLoading: () => {},
});

export const usePageLoading = () => useContext(NavigationLoaderContext);

function isAdminPanelPath(path: string): boolean {
  return path.startsWith("/admin") && !path.startsWith("/admin/login");
}

function isAuthPath(path: string): boolean {
  return (
    path === "/login" ||
    path === "/register" ||
    path.startsWith("/admin/login") ||
    path.startsWith("/admin/register")
  );
}

function NavigationWatcher({
  onRouteChanged,
}: {
  onRouteChanged: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    onRouteChanged();
  }, [pathname, searchParams, onRouteChanged]);

  return null;
}

export default function NavigationLoaderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [fullscreenLoading, setFullscreenLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const exitTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearAllTimeouts = useCallback(() => {
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
    if (exitTimeoutRef.current) {
      clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }
  }, []);

  const stopLoading = useCallback(() => {
    clearAllTimeouts();
    setIsExiting(true);
    exitTimeoutRef.current = setTimeout(() => {
      setFullscreenLoading(false);
      setContentLoading(false);
      setIsExiting(false);
    }, 200);
  }, [clearAllTimeouts]);

  const startFullscreenLoading = useCallback(() => {
    clearAllTimeouts();
    setIsExiting(false);
    setContentLoading(false);
    setFullscreenLoading(true);

    safetyTimeoutRef.current = setTimeout(() => {
      stopLoading();
    }, 6000);
  }, [clearAllTimeouts, stopLoading]);

  const startContentLoading = useCallback(() => {
    clearAllTimeouts();
    setIsExiting(false);
    setFullscreenLoading(false);
    setContentLoading(true);

    safetyTimeoutRef.current = setTimeout(() => {
      stopLoading();
    }, 6000);
  }, [clearAllTimeouts, stopLoading]);

  // Intercept click on <a> tags across the entire application
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const anchor = target.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      const targetAttr = anchor.getAttribute("target");
      const downloadAttr = anchor.getAttribute("download");

      if (!href || targetAttr === "_blank" || downloadAttr !== null) return;
      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      ) {
        return;
      }

      try {
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) return;

        const currentPath = window.location.pathname;
        const currentPathWithQuery = currentPath + window.location.search;
        const targetPath = url.pathname;
        const targetPathWithQuery = targetPath + url.search;

        if (
          targetPathWithQuery !== currentPathWithQuery &&
          !url.hash.startsWith("#")
        ) {
          const fromAuth = isAuthPath(currentPath);
          const toAuth = isAuthPath(targetPath);
          const fromAdmin = isAdminPanelPath(currentPath);
          const toAdmin = isAdminPanelPath(targetPath);

          if (fromAuth || toAuth) {
            // Scenario A: Transitioning to or from auth pages (login/register) -> Full-Screen Loader
            startFullscreenLoading();
          } else if (fromAdmin && toAdmin) {
            // Scenario B: Admin to Admin navigation -> Content Area Loader only!
            startContentLoading();
          } else {
            // Scenario C: Authenticated App / Dealer portal navigation -> Smooth Next.js client transition
            // Do not block the entire viewport with a full-screen whiteout overlay
          }
        }
      } catch {
        // Ignore invalid URLs
      }
    };

    document.addEventListener("click", handleDocumentClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleDocumentClick, {
        capture: true,
      });
    };
  }, [startContentLoading, startFullscreenLoading]);

  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  return (
    <NavigationLoaderContext.Provider
      value={{
        isPageLoading: fullscreenLoading || contentLoading,
        isContentLoading: contentLoading,
        isFullscreenLoading: fullscreenLoading,
        startFullscreenLoading,
        startContentLoading,
        stopLoading,
      }}
    >
      <Suspense fallback={null}>
        <NavigationWatcher onRouteChanged={stopLoading} />
      </Suspense>

      {/* Scenario A: Full-screen loader for auth/login/logout transitions */}
      {fullscreenLoading && (
        <WhyteFullScreenLoader isExiting={isExiting} />
      )}

      {children}
    </NavigationLoaderContext.Provider>
  );
}
