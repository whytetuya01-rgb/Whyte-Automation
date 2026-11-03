"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  Suspense,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getAppById,
  getDefaultAppForRoute,
  resolveAppId,
  formatAppHref,
  type AppNavigationEntry,
} from "@/lib/appNavigationRegistry";

const APP_STORAGE_KEY = "whyte_admin_active_app";

interface AppNavigationContextValue {
  activeAppId: string;
  activeApp: AppNavigationEntry;
  switchApp: (appId: string) => void;
  formatHref: (href: string, overrideAppId?: string) => string;
}

const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

/**
 * Isolated Suspense consumer for Next.js searchParams.
 * Keeps useSearchParams() inside a tiny 0-byte component so the main layout
 * and children never bail out of static rendering or require whole-page Suspense.
 */
function SearchParamsWatcher({
  onParamsAppChange,
}: {
  onParamsAppChange: (appParam: string | null) => void;
}) {
  const searchParams = useSearchParams();
  const appParam = searchParams.get("app");

  useEffect(() => {
    onParamsAppChange(appParam);
  }, [appParam, onParamsAppChange]);

  return null;
}

export function AppNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // Initial determination of active app
  const [activeAppId, setActiveAppId] = useState<string>(() => {
    // 1. Direct SSR / pre-hydration safe fallback
    if (typeof window === "undefined") {
      return "dashboard";
    }
    // 2. Immediate check from window.location.search
    try {
      const urlApp = new URLSearchParams(window.location.search).get("app");
      if (urlApp) return resolveAppId(urlApp);
    } catch {
      // ignore
    }
    // 3. Session storage
    try {
      const stored = sessionStorage.getItem(APP_STORAGE_KEY);
      if (stored) return resolveAppId(stored);
    } catch {
      // ignore
    }
    // 4. Default by route
    return getDefaultAppForRoute(window.location.pathname).id;
  });

  const persistAppId = useCallback((id: string) => {
    const canonical = resolveAppId(id);
    setActiveAppId(canonical);
    try {
      sessionStorage.setItem(APP_STORAGE_KEY, canonical);
    } catch {
      // ignore private mode error
    }
  }, []);

  // Called whenever URL search params change (including browser Back/Forward)
  const handleParamsAppChange = useCallback(
    (appParam: string | null) => {
      if (appParam) {
        persistAppId(appParam);
      } else {
        // Direct link or internal navigation without ?app query:
        // Check session storage first; if empty, use route-based default
        try {
          const stored = sessionStorage.getItem(APP_STORAGE_KEY);
          if (stored) {
            setActiveAppId(resolveAppId(stored));
            return;
          }
        } catch {
          // ignore
        }
        const routeDefault = getDefaultAppForRoute(pathname || "");
        setActiveAppId(routeDefault.id);
      }
    },
    [pathname, persistAppId]
  );

  const activeApp = useMemo(() => getAppById(activeAppId), [activeAppId]);

  const switchApp = useCallback(
    (targetAppId: string) => {
      const targetApp = getAppById(targetAppId);
      persistAppId(targetApp.id);
      const targetUrl = formatAppHref(targetApp.landingRoute, targetApp.id);
      router.push(targetUrl);
    },
    [persistAppId, router]
  );

  const formatHref = useCallback(
    (href: string, overrideAppId?: string) => {
      return formatAppHref(href, overrideAppId ?? activeAppId);
    },
    [activeAppId]
  );

  const contextValue = useMemo<AppNavigationContextValue>(
    () => ({
      activeAppId,
      activeApp,
      switchApp,
      formatHref,
    }),
    [activeAppId, activeApp, switchApp, formatHref]
  );

  return (
    <AppNavigationContext.Provider value={contextValue}>
      <Suspense fallback={null}>
        <SearchParamsWatcher onParamsAppChange={handleParamsAppChange} />
      </Suspense>
      {children}
    </AppNavigationContext.Provider>
  );
}

export function useAppNavigation(): AppNavigationContextValue {
  const context = useContext(AppNavigationContext);
  if (!context) {
    // Graceful fallback for components rendered outside the provider (e.g. tests or isolated modals)
    const defaultApp = getAppById("dashboard");
    return {
      activeAppId: defaultApp.id,
      activeApp: defaultApp,
      switchApp: () => {},
      formatHref: (href: string) => href,
    };
  }
  return context;
}

