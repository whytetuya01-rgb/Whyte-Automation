"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Database, Wifi, WifiOff, RefreshCw, Sparkles, CheckCircle2 } from "lucide-react";
import { getCatalogMeta, buildTenantKey, type CatalogMetadata } from "@/lib/offline/db";
import { downloadOfflineCatalog } from "@/lib/offline/catalogManager";
import { loadOfflineIdentity, saveOfflineIdentity } from "@/lib/offline/identity";
import OfflineCatalogModal from "./OfflineCatalogModal";

export default function OfflineStatusPill() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const companyId = user?.companyId;
  const userId = user?.id;

  const [meta, setMeta] = useState<CatalogMetadata | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [modalOpen, setModalOpen] = useState(false);

  const tenantKey = companyId && userId ? buildTenantKey(companyId, userId) : null;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const refreshMeta = async () => {
    if (!tenantKey) return;
    try {
      const m = await getCatalogMeta(tenantKey);
      setMeta(m);
    } catch {
      // Ignore
    }
  };

  // Remember who is signed in so the offline builder can open without the network.
  const companyName = user?.companyName ?? "";
  const role = user?.role ?? "user";
  const discount = Number(user?.discountAllocationPercent ?? 0);
  // True when this device last saw no account or a different one, so cached pages rendered for that account
  // (they carry its company branding) are dropped before the builder is cached again for this one.
  const accountChanged = useRef(false);
  useEffect(() => {
    if (!companyId || !userId) return;
    const previous = loadOfflineIdentity();
    accountChanged.current = !previous || String(previous.userId) !== String(userId) || String(previous.companyId) !== String(companyId);
    saveOfflineIdentity({ companyId, userId, companyName, role, allocatedDiscountPercent: discount });
  }, [companyId, userId, companyName, role, discount]);

  // While online: cache the offline builder, and fetch the catalog (without images) once if the device has none,
  // so "create a quotation offline" works without the user having to prepare anything.
  useEffect(() => {
    if (!tenantKey || !isOnline) return;
    let cancelled = false;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker?.ready;
        registration?.active?.postMessage({ type: "PRECACHE_BUILDER", replace: accountChanged.current });
      } catch {
        // No service worker (development / unsupported browser).
      }
      try {
        const existing = await getCatalogMeta(tenantKey);
        if (cancelled || existing?.status === "Ready for Offline Use" || existing?.status === "Downloading") return;
        if (sessionStorage.getItem(`whyte:auto-catalog:${tenantKey}`)) return;
        sessionStorage.setItem(`whyte:auto-catalog:${tenantKey}`, "1");
        await downloadOfflineCatalog(
          { companyId, companyName, userId, role, allocatedDiscountPercent: discount },
          { downloadImages: false }
        );
        if (!cancelled) void refreshMeta();
      } catch (err) {
        console.warn("[Offline] Automatic catalog download failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey, isOnline]);

  // Offline, "New Quotation" (a server-rendered page) cannot load; open the local builder instead.
  useEffect(() => {
    if (isOnline) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || new URL(anchor.href, location.href).pathname !== "/quotation/new") return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign("/quotation/draft/new");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [isOnline]);

  useEffect(() => {
    refreshMeta();
    const interval = setInterval(refreshMeta, 20000);
    return () => clearInterval(interval);
  }, [tenantKey]);

  // Don't render for unauthenticated visitors
  if (!session?.user) return null;

  const status = meta?.status;
  const isReady = status === "Ready for Offline Use";
  const hasUpdate = status === "Update Available";
  const isDownloading = status === "Downloading";

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all duration-150 border cursor-pointer bg-white hover:bg-gray-50 border-gray-200/80 text-gray-700 shadow-2xs"
        title="Manage Offline Catalog"
      >
        {/* Network indicator dot */}
        <span
          className={`w-2 h-2 rounded-full ${
            isOnline ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
          }`}
        />

        {/* Catalog condition */}
        {isDownloading ? (
          <span className="flex items-center gap-1 text-amber-700">
            <RefreshCw size={11} className="animate-spin" />
            <span className="hidden sm:inline">Downloading Catalog...</span>
          </span>
        ) : hasUpdate ? (
          <span className="flex items-center gap-1 text-blue-700 font-bold">
            <Sparkles size={11} className="text-blue-500" />
            <span className="hidden sm:inline">Catalog Update</span>
          </span>
        ) : isReady ? (
          <span className="flex items-center gap-1 text-gray-700">
            <Database size={11} className="text-emerald-600" />
            <span className="hidden sm:inline">Offline Ready</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-gray-500">
            <Database size={11} />
            <span className="hidden sm:inline">Offline Catalog</span>
          </span>
        )}
      </button>

      <OfflineCatalogModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          refreshMeta();
        }}
        onCatalogUpdated={refreshMeta}
      />
    </>
  );
}
