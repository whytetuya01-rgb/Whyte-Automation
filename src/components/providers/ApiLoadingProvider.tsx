"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import ApiLoader from "@/components/ui/ApiLoader";
import { usePageLoading } from "./NavigationLoaderProvider";

interface ApiLoadingContextType {
  isApiLoading: boolean;
  activeCount: number;
  startApiLoading: () => void;
  stopApiLoading: () => void;
}

const ApiLoadingContext = createContext<ApiLoadingContextType>({
  isApiLoading: false,
  activeCount: 0,
  startApiLoading: () => {},
  stopApiLoading: () => {},
});

export const useApiLoading = () => useContext(ApiLoadingContext);

/**
 * Determine whether a request is an API mutation/action that should display
 * the Glass.json Lottie loader.
 *
 * LOADING PRIORITY:
 * - Table/grid/list GET requests already have their own dedicated skeletons;
 *   they do NOT trigger this Lottie loader (keeping skeletons intact).
 * - Mutations (POST, PATCH, PUT, DELETE) like create, update, delete, upload
 *   do NOT have skeletons and MUST trigger this Lottie loader.
 */
function isTrackableApiRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  // Check for explicit opt-out header
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      if (init.headers.get("x-skip-api-loader") === "true") return false;
    } else if (Array.isArray(init.headers)) {
      if (init.headers.some(([k, v]) => k.toLowerCase() === "x-skip-api-loader" && v === "true")) {
        return false;
      }
    } else if (typeof init.headers === "object") {
      if ((init.headers as Record<string, string>)["x-skip-api-loader"] === "true") {
        return false;
      }
    }
  }

  // Extract URL string
  let urlStr = "";
  if (typeof input === "string") {
    urlStr = input;
  } else if (input instanceof URL) {
    urlStr = input.pathname + input.search;
  } else if (input && typeof (input as Request).url === "string") {
    urlStr = (input as Request).url;
  }

  // Must target an /api/ route
  if (!urlStr.includes("/api/")) {
    return false;
  }

  // Exclude static assets or files
  if (urlStr.endsWith(".json") || urlStr.endsWith(".png") || urlStr.endsWith(".webp")) {
    return false;
  }

  // Exclude background session polling from NextAuth
  if (urlStr.includes("/api/auth/session")) {
    return false;
  }

  // Extract HTTP method
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

  // Allow explicit opt-in for GET requests if specifically tagged
  const hasExplicitOptIn =
    init?.headers &&
    ((init.headers instanceof Headers && init.headers.get("x-show-api-loader") === "true") ||
      (typeof init.headers === "object" &&
        (init.headers as Record<string, string>)["x-show-api-loader"] === "true"));

  if (hasExplicitOptIn) return true;

  // GET requests are used by tables, grids, and lists that already have dedicated skeleton loaders.
  // Do NOT show the Lottie loader on GET requests so existing skeletons take priority.
  if (method === "GET") {
    return false;
  }

  // All mutations (POST, PATCH, PUT, DELETE) trigger the Glass Lottie loader
  return true;
}

export default function ApiLoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeCount, setActiveCount] = useState(0);
  const [isApiLoading, setIsApiLoading] = useState(false);
  const [cachedAnimationData, setCachedAnimationData] = useState<any>(null);

  // Active requests counter ref to avoid stale closures in fetch interceptor
  const activeCountRef = useRef(0);
  const safetyTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check if existing navigation loader is active (keep systems independent)
  const { isPageLoading } = usePageLoading();

  // Clear safety timer
  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  // Preload and cache /loaders/Glass.json once on client mount
  useEffect(() => {
    let isMounted = true;
    fetch("/loaders/Glass.json", {
      headers: { "x-skip-api-loader": "true" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data) {
          setCachedAnimationData(data);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  // Request started — immediately show loader and increment counter
  const startRequest = useCallback(() => {
    activeCountRef.current += 1;
    const current = activeCountRef.current;
    setActiveCount(current);
    setIsApiLoading(true);

    // Safety timeout: automatically reset after 30 seconds if a network request hangs indefinitely
    if (current === 1) {
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = setTimeout(() => {
        activeCountRef.current = 0;
        setActiveCount(0);
        setIsApiLoading(false);
        clearSafetyTimer();
      }, 30000);
    }
  }, [clearSafetyTimer]);

  // Request completed — decrement counter; hide overlay when all requests are done
  const endRequest = useCallback(() => {
    activeCountRef.current = Math.max(0, activeCountRef.current - 1);
    const current = activeCountRef.current;
    setActiveCount(current);

    // If all pending requests have finished (resolved or failed)
    if (current === 0) {
      clearSafetyTimer();
      setIsApiLoading(false);
    }
  }, [clearSafetyTimer]);

  // Global fetch interceptor
  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalFetch = window.fetch;

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const isTracked = isTrackableApiRequest(input, init);

      if (isTracked) {
        startRequest();
      }

      try {
        const response = await originalFetch.apply(this, [input, init]);
        return response;
      } finally {
        if (isTracked) {
          endRequest();
        }
      }
    };

    return () => {
      window.fetch = originalFetch;
      clearSafetyTimer();
    };
  }, [startRequest, endRequest, clearSafetyTimer]);

  return (
    <ApiLoadingContext.Provider
      value={{
        isApiLoading: isApiLoading && !isPageLoading,
        activeCount,
        startApiLoading: startRequest,
        stopApiLoading: endRequest,
      }}
    >
      {/* Visual API Glass.json loader overlay (completely independent of page navigation loader) */}
      <ApiLoader
        loading={isApiLoading && !isPageLoading}
        animationData={cachedAnimationData}
      />
      {children}
    </ApiLoadingContext.Provider>
  );
}

export { ApiLoader };
