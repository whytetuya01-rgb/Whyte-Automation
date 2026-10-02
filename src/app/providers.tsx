"use client";
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "swr";
import { SWR_ADMIN_OPTIONS } from "@/lib/swr";
import NavigationLoaderProvider from "@/components/providers/NavigationLoaderProvider";
import ApiLoadingProvider from "@/components/providers/ApiLoadingProvider";
import { ConfirmProvider } from "@/components/providers/ConfirmProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // Reduce session polling: re-check every 5 minutes instead of the default
      // (which polls on every window focus + every few seconds). This cuts
      // /api/auth/session calls dramatically during normal admin usage.
      refetchInterval={5 * 60}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={SWR_ADMIN_OPTIONS}>
        <NavigationLoaderProvider>
          <ApiLoadingProvider>
            <ConfirmProvider>
              {children}
            </ConfirmProvider>
          </ApiLoadingProvider>
        </NavigationLoaderProvider>
      </SWRConfig>
    </SessionProvider>
  );
}


