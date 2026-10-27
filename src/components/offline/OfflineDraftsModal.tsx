"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import {
  FileText,
  Plus,
  Trash2,
  Copy,
  Edit2,
  ExternalLink,
  Clock,
  Layers,
  Cpu,
  AlertTriangle,
  X,
  CheckCircle2,
  FolderOpen,
} from "lucide-react";
import {
  listOfflineDrafts,
  deleteOfflineDraft,
  duplicateOfflineDraft,
  createEmptyOfflineDraft,
  saveOfflineDraft,
} from "@/lib/offline/draftStore";
import { OfflineCatalogRepository } from "@/lib/offline/catalogRepository";
import type { OfflineQuotationDraft } from "@/lib/offline/db";
import { formatCurrency } from "@/lib/utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function OfflineDraftsModal({ isOpen, onClose }: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user as any;
  const companyId = user?.companyId;
  const userId = user?.id;

  const [drafts, setDrafts] = useState<OfflineQuotationDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState<boolean | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [renamingDraft, setRenamingDraft] = useState<OfflineQuotationDraft | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const refreshDrafts = useCallback(async () => {
    if (!companyId || !userId) {
      setDrafts([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [list, snapshot] = await Promise.all([
        listOfflineDrafts(companyId, userId),
        OfflineCatalogRepository.getCatalogSnapshot(companyId, userId),
      ]);
      setDrafts(list);
      setCatalogReady(snapshot.isAvailable && snapshot.products.length > 0);
    } catch (err) {
      console.error("Failed to load offline drafts:", err);
      toast.error("Failed to load local drafts");
    } finally {
      setLoading(false);
    }
  }, [companyId, userId]);

  useEffect(() => {
    if (isOpen) {
      refreshDrafts();
      try {
        router.prefetch("/quotation/draft/new");
      } catch {}
    }
  }, [isOpen, refreshDrafts, router]);

  // Create brand new draft
  const handleCreateNewDraft = async () => {
    if (!companyId || !userId) {
      toast.error("You must be logged in to create an offline draft.");
      return;
    }

    // Check if offline catalog is available
    const snapshot = await OfflineCatalogRepository.getCatalogSnapshot(companyId, userId);
    if (!snapshot.isAvailable) {
      toast.error("Offline catalog must be downloaded before creating offline drafts.");
      return;
    }

    const newDraft = createEmptyOfflineDraft({
      companyId: Number(companyId),
      companyName: user.companyName || "My Company",
      userId: Number(userId),
      userName: user.name || "Dealer",
      userRole: user.role || "dealer",
      catalogVersion: snapshot.meta?.catalogVersion || "v0",
      allocatedDiscountPercent: user.discountAllocationPercent || 0,
    });

    const res = await saveOfflineDraft(newDraft);
    if (res.success) {
      toast.success("New offline draft created");
      onClose();
      router.push(`/quotation/draft/${newDraft.id}`);
    } else {
      toast.error(res.error || "Failed to create draft");
    }
  };

  // Duplicate draft
  const handleDuplicate = async (draft: OfflineQuotationDraft) => {
    if (!companyId || !userId) return;

    try {
      setDuplicatingId(draft.id);
      const snapshot = await OfflineCatalogRepository.getCatalogSnapshot(companyId, userId);
      const { newDraft, skippedUnavailableItems } = await duplicateOfflineDraft({
        sourceDraft: draft,
        currentCatalog: snapshot.products,
        catalogVersion: snapshot.meta?.catalogVersion || draft.catalogVersion,
      });

      if (skippedUnavailableItems.length > 0) {
        toast(
          `Draft duplicated. ${skippedUnavailableItems.length} unavailable items were skipped. Prices reset to default catalog prices.`,
          { icon: "⚠️" }
        );
      } else {
        toast.success("Draft duplicated. Item prices reset to current catalog defaults.");
      }

      await refreshDrafts();
    } catch (err: any) {
      toast.error(err?.message || "Failed to duplicate draft");
    } finally {
      setDuplicatingId(null);
    }
  };

  // Delete draft
  const handleDelete = async (draftId: string) => {
    if (!companyId || !userId) return;
    if (!confirm("Are you sure you want to permanently delete this local draft? This action cannot be undone.")) {
      return;
    }

    try {
      setDeletingId(draftId);
      const success = await deleteOfflineDraft(companyId, userId, draftId);
      if (success) {
        toast.success("Local draft deleted");
        await refreshDrafts();
      } else {
        toast.error("Failed to delete local draft");
      }
    } finally {
      setDeletingId(null);
    }
  };

  // Rename draft
  const handleRenameSubmit = async () => {
    if (!renamingDraft || !renameValue.trim()) return;

    const updated: OfflineQuotationDraft = {
      ...renamingDraft,
      clientName: renameValue.trim(),
    };

    const res = await saveOfflineDraft(updated);
    if (res.success) {
      toast.success("Draft renamed");
      setRenamingDraft(null);
      await refreshDrafts();
    } else {
      toast.error("Failed to rename draft");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
              <FolderOpen size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-gray-900">Offline Quotation Drafts</h2>
                {catalogReady === true && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <CheckCircle2 size={11} /> Catalog Ready
                  </span>
                )}
                {catalogReady === false && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    <AlertTriangle size={11} /> Catalog Not Downloaded
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Logged in: <strong className="text-gray-700">{user?.name || user?.email || "Dealer"}</strong>
                {user?.companyName && <span> • {user.companyName}</span>}
                <span className="text-gray-400 font-mono text-[11px] ml-1.5">(Tenant: {companyId}_{userId})</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateNewDraft}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gray-900 text-white rounded-xl text-xs font-semibold hover:bg-gray-800 transition-all shadow-xs"
            >
              <Plus size={14} />
              New Offline Draft
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Informational Callout */}
        <div className="px-6 py-2.5 bg-amber-50/80 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-900">
          <AlertTriangle size={14} className="text-amber-600 shrink-0" />
          <span>
            Offline drafts are saved locally in your browser. They do not have official quotation numbers until
            synchronized with the server.
          </span>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading local drafts...</div>
          ) : drafts.length === 0 ? (
            <div className="py-16 text-center">
              <div className="inline-flex p-4 bg-gray-50 rounded-2xl text-gray-400 mb-3">
                <FileText size={32} />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">No offline drafts found</h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1 mb-5">
                No local drafts have been saved yet in this browser for <strong className="text-gray-700">{user?.name || "your account"}</strong>.
                Click &quot;Create First Offline Draft&quot; to start authoring offline quotations.
              </p>
              <button
                onClick={handleCreateNewDraft}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-semibold hover:bg-gray-800 transition-all shadow-xs"
              >
                <Plus size={14} />
                Create First Offline Draft
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="group relative flex flex-col justify-between p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-md transition-all"
                >
                  <div>
                    {/* Header line: Title + Status */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <h4 className="font-semibold text-gray-900 text-sm truncate max-w-[240px]">
                          {draft.clientName || "Untitled Draft"}
                        </h4>
                        <p className="text-[11px] text-gray-500">
                          {draft.houseTypeName || "Custom Layout"} • {draft.id}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        Local Draft
                      </span>
                    </div>

                    {/* Meta stats */}
                    <div className="grid grid-cols-3 gap-2 py-2.5 my-2 border-y border-gray-100 text-center">
                      <div>
                        <div className="text-[10px] text-gray-400 font-medium">Rooms</div>
                        <div className="text-xs font-bold text-gray-800 flex items-center justify-center gap-1 mt-0.5">
                          <Layers size={11} className="text-gray-400" />
                          {draft.roomCount || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 font-medium">Devices</div>
                        <div className="text-xs font-bold text-gray-800 flex items-center justify-center gap-1 mt-0.5">
                          <Cpu size={11} className="text-gray-400" />
                          {draft.deviceCount || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 font-medium">Est. Total</div>
                        <div className="text-xs font-bold text-gray-900 mt-0.5">
                          {formatCurrency(draft.calculation?.grandTotal || 0)}
                        </div>
                      </div>
                    </div>

                    {/* Footer info */}
                    <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {new Date(draft.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>Rev {draft.revision}</span>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-100">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setRenamingDraft(draft);
                          setRenameValue(draft.clientName || "");
                        }}
                        title="Rename Draft"
                        className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDuplicate(draft)}
                        disabled={duplicatingId === draft.id}
                        title="Duplicate Draft (Reset Prices to Master)"
                        className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(draft.id)}
                        disabled={deletingId === draft.id}
                        title="Delete Local Draft"
                        className="p-1.5 text-red-400 hover:text-red-700 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        onClose();
                        router.push(`/quotation/draft/${draft.id}`);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 transition-colors shadow-2xs"
                    >
                      Continue
                      <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rename Modal Overlay */}
        {renamingDraft && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/40 backdrop-blur-2xs">
            <div className="w-full max-w-sm p-5 bg-white rounded-2xl shadow-xl border border-gray-100 animate-in zoom-in-95 duration-150">
              <h4 className="text-sm font-bold text-gray-900 mb-1">Rename Offline Draft</h4>
              <p className="text-xs text-gray-500 mb-4">Enter a client or project name for this draft.</p>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Client Name"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900 mb-4"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRenamingDraft(null)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRenameSubmit}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-lg shadow-2xs"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
