"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Download,
  RefreshCw,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Layers,
  Image as ImageIcon,
  Clock,
  Trash2,
  X,
  Wifi,
  WifiOff,
  Sparkles,
} from "lucide-react";
import {
  downloadOfflineCatalog,
  checkForCatalogUpdate,
  clearTenantCatalog,
  getTenantStorageUsage,
  type CatalogDownloadProgress,
} from "@/lib/offline/catalogManager";
import {
  getCatalogMeta,
  buildTenantKey,
  type CatalogMetadata,
  type OfflineDownloadStatus,
} from "@/lib/offline/db";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCatalogUpdated?: () => void;
}

export default function OfflineCatalogModal({ isOpen, onClose, onCatalogUpdated }: Props) {
  const { data: session } = useSession();
  const user = session?.user as any;
  const companyId = user?.companyId;
  const userId = user?.id;
  const role = user?.role;

  const [meta, setMeta] = useState<CatalogMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<CatalogDownloadProgress | null>(null);
  const [storageUsage, setStorageUsage] = useState<{ totalBytes: number; imageBytes: number } | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [includeImages, setIncludeImages] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tenantKey = companyId && userId ? buildTenantKey(companyId, userId) : null;

  // Track online/offline status
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

  // Load existing metadata and storage metrics
  const refreshStatus = useCallback(async () => {
    if (!tenantKey) return;
    try {
      const [m, usage] = await Promise.all([
        getCatalogMeta(tenantKey),
        getTenantStorageUsage(tenantKey),
      ]);
      setMeta(m);
      setStorageUsage(usage);

      // Check if update is available when online
      if (navigator.onLine && m?.lastSyncedAt) {
        checkForCatalogUpdate(tenantKey).then((res) => {
          if (res.updateAvailable) {
            setMeta((prev) => (prev ? { ...prev, status: "Update Available" } : null));
          }
        });
      }
    } catch (e: any) {
      console.warn("Error refreshing offline catalog meta:", e);
    }
  }, [tenantKey]);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      refreshStatus();
    }
  }, [isOpen, refreshStatus]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (!companyId || !userId) {
      setErrorMsg("You must be logged in to an authorized company to download an offline catalog.");
      return;
    }

    if (!isOnline) {
      setErrorMsg("Cannot download catalog while offline. Please connect to internet.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setDownloadProgress({
      stage: "fetching_data",
      percent: 5,
      message: "Starting catalog download...",
    });

    try {
      const updatedMeta = await downloadOfflineCatalog(
        {
          companyId: Number(companyId),
          companyName: (user?.companyName as string) || "Whyte Automations",
          userId: Number(userId),
          role: role || "dealer",
          allocatedDiscountPercent: Number(user?.allocatedDiscountPercent || 0),
        },
        {
          downloadImages: includeImages,
          maxImages: 80,
          onProgress: (p) => setDownloadProgress(p),
        }
      );

      setMeta(updatedMeta);
      await refreshStatus();
      onCatalogUpdated?.();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to download offline catalog package.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!tenantKey) return;
    if (!window.confirm("Are you sure you want to remove the offline catalog from this device? You will need internet to download it again.")) {
      return;
    }

    try {
      await clearTenantCatalog(tenantKey);
      setMeta(null);
      setStorageUsage(null);
      setDownloadProgress(null);
      refreshStatus();
      onCatalogUpdated?.();
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to clear catalog");
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return "0 KB";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTimestamp = (iso?: string | null) => {
    if (!iso) return "Never";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const currentStatus: OfflineDownloadStatus = meta?.status || "Not Downloaded";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 bg-gray-50/80 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-accent-light,#FCEAF0)] text-[var(--color-admin-primary,#D85B83)] flex items-center justify-center">
              <Database size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 leading-tight">Offline Catalog Management</h3>
              <p className="text-xs text-gray-500">Cache products and space configurations on this device</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5">
          {/* Status & Connectivity Bar */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50 border border-gray-200/80">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isOnline ? "bg-emerald-500 shadow-xs shadow-emerald-500/50" : "bg-amber-500 shadow-xs shadow-amber-500/50"
                }`}
              />
              <span className="text-xs font-semibold text-gray-800">
                {isOnline ? "Online (Connected)" : "Offline (No Internet)"}
              </span>
            </div>

            {/* Catalog Status Badge */}
            <div className="flex items-center gap-1.5">
              {currentStatus === "Ready for Offline Use" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={13} />
                  <span>Ready Offline</span>
                </span>
              )}
              {currentStatus === "Update Available" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <Sparkles size={13} className="text-blue-500" />
                  <span>Update Available</span>
                </span>
              )}
              {currentStatus === "Downloading" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <RefreshCw size={13} className="animate-spin text-amber-600" />
                  <span>Downloading</span>
                </span>
              )}
              {currentStatus === "Not Downloaded" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                  <span>Not Downloaded</span>
                </span>
              )}
              {currentStatus === "Download Failed" && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                  <AlertTriangle size={13} />
                  <span>Download Failed</span>
                </span>
              )}
            </div>
          </div>

          {/* Progress Bar (if active download) */}
          {downloadProgress && downloadProgress.stage !== "complete" && (
            <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-amber-900">
                <span>{downloadProgress.message}</span>
                <span>{downloadProgress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-amber-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-[var(--color-admin-primary,#D85B83)] transition-all duration-300"
                  style={{ width: `${downloadProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Statistics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-xl bg-gray-50/70 border border-gray-100">
              <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Products</div>
              <div className="text-lg font-bold text-gray-900 mt-0.5">{meta?.counts?.products || 0}</div>
              <div className="text-[11px] text-gray-400">{meta?.counts?.variants || 0} variants</div>
            </div>

            <div className="p-3 rounded-xl bg-gray-50/70 border border-gray-100">
              <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Spaces</div>
              <div className="text-lg font-bold text-gray-900 mt-0.5">
                {(meta?.counts?.houseTypes || 0) + (meta?.counts?.roomTypes || 0)}
              </div>
              <div className="text-[11px] text-gray-400">
                {meta?.counts?.houseTypes || 0} house &bull; {meta?.counts?.roomTypes || 0} room
              </div>
            </div>

            <div className="p-3 rounded-xl bg-gray-50/70 border border-gray-100 col-span-2 sm:col-span-1">
              <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Device Storage</div>
              <div className="text-lg font-bold text-gray-900 mt-0.5">
                {formatBytes(storageUsage?.totalBytes || meta?.totalStorageBytes)}
              </div>
              <div className="text-[11px] text-gray-400">{meta?.counts?.cachedImages || 0} cached images</div>
            </div>
          </div>

          {/* Metadata details */}
          <div className="space-y-2 text-xs text-gray-600 border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 flex items-center gap-1.5">
                <Clock size={13} className="text-gray-400" />
                <span>Last Synchronized:</span>
              </span>
              <span className="font-semibold text-gray-800">{formatTimestamp(meta?.lastSyncedAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 flex items-center gap-1.5">
                <Layers size={13} className="text-gray-400" />
                <span>Catalog Version:</span>
              </span>
              <span className="font-mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
                {meta?.catalogVersion || "v0 (None)"}
              </span>
            </div>
          </div>

          {/* Image Caching Toggle */}
          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-gray-50 border border-gray-200/70 text-xs text-gray-700 cursor-pointer hover:bg-gray-100/70 transition">
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(e) => setIncludeImages(e.target.checked)}
              className="w-4 h-4 rounded text-[var(--color-admin-primary,#D85B83)] focus:ring-0 cursor-pointer"
            />
            <div className="flex-1">
              <span className="font-semibold text-gray-900">Pre-cache product device photos</span>
              <p className="text-[11px] text-gray-500">Allows product imagery to render offline during client presentations</p>
            </div>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 bg-gray-50/80 border-t border-gray-100">
          {meta?.lastSyncedAt ? (
            <button
              type="button"
              onClick={handleClear}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              <Trash2 size={14} />
              <span>Clear Cache</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition cursor-pointer"
            >
              Close
            </button>

            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || !isOnline}
              className="inline-flex items-center gap-1.5 px-4.5 py-2 text-xs font-semibold text-white bg-[var(--color-admin-primary,#D85B83)] hover:opacity-95 rounded-xl transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Downloading...</span>
                </>
              ) : meta?.status === "Update Available" ? (
                <>
                  <RefreshCw size={14} />
                  <span>Update Catalog</span>
                </>
              ) : meta?.lastSyncedAt ? (
                <>
                  <RefreshCw size={14} />
                  <span>Refresh Catalog</span>
                </>
              ) : (
                <>
                  <Download size={14} />
                  <span>Download Catalog</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
