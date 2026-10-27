"use client";

import { useEffect, useState } from "react";

export default function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // 1. Check if already running in standalone PWA mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsInstalled(isStandalone);

    // 2. Register Service Worker in production or supporting browsers
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV !== "production") {
        // The worker caches unhashed dev chunks and serves stale code, so development runs without it and
        // removes one left over from an earlier session.
        void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
        if ("caches" in window) {
          void caches.keys().then((keys) => keys.filter((k) => k.startsWith("whyte-")).forEach((k) => void caches.delete(k)));
        }
      } else {
        // This effect runs after the window "load" event has usually fired, so register immediately.
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then((registration) => {
            registration.addEventListener("updatefound", () => {
              const newWorker = registration.installing;
              newWorker?.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  console.log("[PWA] A new version of Whyte Quotations is ready.");
                }
              });
            });
          })
          .catch((error) => console.warn("[PWA] Service Worker registration failed:", error));
      }
    }

    // 3. Capture beforeinstallprompt for installability
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      (window as any).__whyteInstallPrompt = e;
      window.dispatchEvent(new CustomEvent("whyte:pwa-installable"));
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      (window as any).__whyteInstallPrompt = null;
      console.log("[PWA] Whyte Quotations successfully installed.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  return null;
}
