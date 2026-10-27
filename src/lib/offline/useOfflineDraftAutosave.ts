/**
 * Whyte Automations — useOfflineDraftAutosave Hook
 * Provides debounced local autosave for offline quotation drafts.
 * Guarantees that "Saved" status is only shown after the IndexedDB transaction commits.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { saveOfflineDraft } from "./draftStore";
import type { OfflineQuotationDraft } from "./db";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutosaveOptions {
  debounceMs?: number;
  onSaved?: (revision: number) => void;
  onError?: (error: string) => void;
}

export function getCrashBackupKey(tenantKey: string, draftId: string) {
  return `whyte_draft_backup_${tenantKey}_${draftId}`;
}

export function writeSyncCrashBackup(draft: OfflineQuotationDraft | null) {
  if (!draft || !draft.id || typeof window === "undefined" || !window.localStorage) return;
  try {
    const key = getCrashBackupKey(draft.tenantKey, draft.id);
    localStorage.setItem(
      key,
      JSON.stringify({
        draft,
        revision: draft.revision,
        timestamp: Date.now(),
      })
    );
  } catch {
    // LocalStorage quota or private mode, non-fatal
  }
}

export function clearSyncCrashBackup(tenantKey: string, draftId: string) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.removeItem(getCrashBackupKey(tenantKey, draftId));
  } catch {}
}

export function getSyncCrashBackup(tenantKey: string, draftId: string): OfflineQuotationDraft | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(getCrashBackupKey(tenantKey, draftId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.draft || null;
  } catch {
    return null;
  }
}

export function useOfflineDraftAutosave(
  draft: OfflineQuotationDraft | null,
  options: UseAutosaveOptions = {}
) {
  const { debounceMs = 700, onSaved, onError } = options;
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const draftRef = useRef<OfflineQuotationDraft | null>(draft);
  draftRef.current = draft;

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const lastSavedRevisionRef = useRef(draft?.revision || 0);

  const executeSave = useCallback(async () => {
    const currentDraft = draftRef.current;
    if (!currentDraft || !currentDraft.id) return;

    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    isSavingRef.current = true;
    setStatus("saving");
    setErrorMessage(null);

    try {
      const result = await saveOfflineDraft(currentDraft);
      if (result.success) {
        lastSavedRevisionRef.current = result.revision;
        setStatus("saved");
        setLastSavedAt(new Date());
        clearSyncCrashBackup(currentDraft.tenantKey, currentDraft.id);
        onSaved?.(result.revision);
      } else {
        setStatus("error");
        const msg = result.error || "Failed to commit draft to local storage";
        setErrorMessage(msg);
        onError?.(msg);
      }
    } catch (err: any) {
      setStatus("error");
      const msg = err?.message || "Storage write error";
      setErrorMessage(msg);
      onError?.(msg);
    } finally {
      isSavingRef.current = false;
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        setTimeout(() => executeSave(), 50);
      }
    }
  }, [onSaved, onError]);

  // Trigger debounced save whenever draft changes; write synchronous backup immediately
  const triggerAutosave = useCallback(() => {
    if (draftRef.current) {
      writeSyncCrashBackup(draftRef.current);
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      executeSave();
    }, debounceMs);
  }, [debounceMs, executeSave]);

  // Flush pending changes immediately
  const flushNow = useCallback(async () => {
    if (draftRef.current) {
      writeSyncCrashBackup(draftRef.current);
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return executeSave();
  }, [executeSave]);

  // Flush on page unload or visibilitychange, with synchronous crash backup write
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (draftRef.current) writeSyncCrashBackup(draftRef.current);
        flushNow();
      }
    };

    const handleBeforeUnload = () => {
      if (draftRef.current) writeSyncCrashBackup(draftRef.current);
      flushNow();
    };

    const handlePageHide = () => {
      if (draftRef.current) writeSyncCrashBackup(draftRef.current);
      flushNow();
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flushNow]);

  return {
    status,
    lastSavedAt,
    errorMessage,
    triggerAutosave,
    flushNow,
    isSaving: status === "saving",
  };
}
