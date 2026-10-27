"use client";

import { useEffect, useState, use } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  WifiOff,
  Database,
  ArrowLeft,
  Download,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import ProposalBuilder from "@/components/proposal-builder/ProposalBuilder";
import { ProposalStep } from "@/components/proposal-builder/StepIndicator";
import {
  loadOfflineDraft,
  createEmptyOfflineDraft,
  saveOfflineDraft,
  offlineDraftToQuotation,
} from "@/lib/offline/draftStore";
import {
  OfflineCatalogRepository,
  type OfflineCatalogSnapshot,
} from "@/lib/offline/catalogRepository";
import type { OfflineQuotationDraft } from "@/lib/offline/db";
import OfflineCatalogModal from "@/components/offline/OfflineCatalogModal";
import {
  useOfflineDraftAutosave,
  getSyncCrashBackup,
  clearSyncCrashBackup,
} from "@/lib/offline/useOfflineDraftAutosave";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { loadOfflineIdentity } from "@/lib/offline/identity";

export default function OfflineDraftPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status: authStatus } = useSession();

  // Offline there is no session; fall back to the identity remembered on this device while signed in. A cached
  // page shell serves every draft URL, so the id is read from the real address (not the cached route params).
  const [storedIdentity] = useState(() => (typeof window === "undefined" ? null : loadOfflineIdentity()));
  const sessionUser = session?.user as any;
  const user = sessionUser?.companyId && sessionUser?.id
    ? sessionUser
    : storedIdentity && {
        companyId: storedIdentity.companyId,
        id: storedIdentity.userId,
        companyName: storedIdentity.companyName,
        role: storedIdentity.role,
        discountAllocationPercent: storedIdentity.allocatedDiscountPercent,
        name: "Dealer",
      };
  const companyId = user?.companyId;
  const userId = user?.id;

  const draftId = decodeURIComponent((pathname || "").split("/").filter(Boolean)[2] ?? "");
  const stepParam = searchParams.get("step");
  const initialStep: ProposalStep = stepParam
    ? (Math.min(5, Math.max(1, parseInt(stepParam, 10))) as ProposalStep)
    : 1;

  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<OfflineQuotationDraft | null>(null);
  const [catalogSnapshot, setCatalogSnapshot] = useState<OfflineCatalogSnapshot | null>(null);
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === "loading" && !user) return;

    if (!user || !companyId || !userId) {
      setError("You must be signed in to access local drafts.");
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        // 1. Fetch authorized offline catalog snapshot
        const snapshot = await OfflineCatalogRepository.getCatalogSnapshot(companyId, userId);
        if (!isMounted) return;
        setCatalogSnapshot(snapshot);

        if (!snapshot.isAvailable || snapshot.products.length === 0) {
          setLoading(false);
          return;
        }

        // 2. Load or initialize draft
        if (draftId === "new") {
          const newDraft = createEmptyOfflineDraft({
            companyId: Number(companyId),
            companyName: user.companyName || "My Company",
            userId: Number(userId),
            userName: user.name || "Dealer",
            userRole: user.role || "dealer",
            catalogVersion: snapshot.meta?.catalogVersion || "v0",
            allocatedDiscountPercent: user.discountAllocationPercent || 0,
          });

          await saveOfflineDraft(newDraft);
          if (!isMounted) return;
          setDraft(newDraft);
          // Replace URL quietly to the actual draft id
          window.history.replaceState(null, "", `/quotation/draft/${newDraft.id}?step=1`);
        } else {
          let loaded = await loadOfflineDraft(companyId, userId, draftId);
          if (!isMounted) return;

          // Check if a synchronous crash backup exists with newer uncommitted edits
          const tenantKey = `${companyId}_${userId}`;
          const crashBackup = getSyncCrashBackup(tenantKey, draftId);
          if (crashBackup && (!loaded || (crashBackup.revision || 0) > (loaded.revision || 0))) {
            loaded = crashBackup;
            // Catch up IndexedDB storage asynchronously
            await saveOfflineDraft(loaded);
            clearSyncCrashBackup(tenantKey, draftId);
          }

          if (!loaded) {
            setError(`Offline draft "${draftId}" was not found in local storage for this user and company.`);
          } else {
            setDraft(loaded);
          }
        }
      } catch (err: any) {
        console.error("Failed to load offline draft:", err);
        if (isMounted) {
          setError(err?.message || "Failed to load offline draft from local storage.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [authStatus, companyId, userId, draftId]);

  if ((authStatus === "loading" && !user) || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm font-medium text-gray-500">Loading local quotation draft…</p>
      </div>
    );
  }

  // Case: No offline catalog downloaded yet
  if (!catalogSnapshot?.isAvailable || catalogSnapshot.products.length === 0) {
    return (
      <div className="max-w-xl mx-auto my-12 bg-white rounded-3xl border border-gray-200/80 p-8 shadow-sm text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto mb-4">
          <Database size={24} />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Offline Catalog Required</h2>
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          To create or edit local drafts offline, you must first download the product catalog while connected to the internet.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setCatalogModalOpen(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gray-950 text-white font-semibold text-sm hover:bg-gray-800 transition"
          >
            <Download size={15} />
            Download Offline Catalog
          </button>
          <Link
            href="/"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition"
          >
            <ArrowLeft size={15} />
            Back to Quotations
          </Link>
        </div>

        <OfflineCatalogModal
          isOpen={catalogModalOpen}
          onClose={() => {
            setCatalogModalOpen(false);
            window.location.reload();
          }}
        />
      </div>
    );
  }

  if (error || !draft) {
    return (
      <div className="max-w-xl mx-auto my-12 bg-white rounded-3xl border border-red-200/80 p-8 shadow-sm text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 mx-auto mb-4">
          <AlertTriangle size={24} />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Local Draft Error</h2>
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          {error || "Draft could not be found."}
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gray-950 text-white font-semibold text-sm hover:bg-gray-800 transition"
          >
            <ArrowLeft size={15} />
            Back to Quotations
          </Link>
        </div>
      </div>
    );
  }

  // Convert draft to initial quotation for ProposalBuilder
  const initialQuotation = offlineDraftToQuotation(
    draft,
    catalogSnapshot.products,
    catalogSnapshot.roomTypes
  );

  return (
    <ProposalBuilder
      isOfflineDraft={true}
      initialOfflineDraft={draft}
      initialQuotation={initialQuotation}
      initialHouseTypes={catalogSnapshot.houseTypes}
      initialProducts={catalogSnapshot.products}
      initialCategories={catalogSnapshot.categories}
      initialRoomTypes={catalogSnapshot.roomTypes}
      initialStep={initialStep}
    />
  );
}
