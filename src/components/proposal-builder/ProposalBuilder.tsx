"use client";

import QuotationRevisionBar from "./QuotationRevisionBar";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { useSession } from "next-auth/react";
import { AlertTriangle, ArrowLeft, Check, Clock, Copy, Home, Save, X, WifiOff, Database, CloudUpload } from "lucide-react";
import CloneQuotationModal, { type CloneSource } from "@/components/admin/quotations/CloneQuotationModal";
import {
  Quotation,
  QuotationRoom,
  EditorCatalogProduct,
  Category,
  RoomType,
  HouseType,
  Company,
  QuotationStatus,
} from "@/types";
import StepIndicator, { ProposalStep } from "./StepIndicator";
import StepProjectDetails, { ProjectFormData } from "./StepProjectDetails";
import StepSelectSpaces from "./StepSelectSpaces";
import StepProductConfig from "./StepProductConfig";
import StepReview from "./StepReview";
import StepProposalPreview from "./StepProposalPreview";
import QuotationOwnership from "./QuotationOwnership";
import DynamicFormStep from "./DynamicFormStep";
import { useWorkflowEngine } from "./workflow/useWorkflowEngine";
import type { QuotationTemplate } from "@/types/template";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import StatusBadge from "@/components/shared/StatusBadge";
import {
  normalizeQuotation,
  normalizeQuotationItem,
  normalizeQuotationRoom,
  normalizeCategories,
  normalizeRoomTypes,
  normalizeHouseTypes,
} from "@/lib/quotationNormalization";
import { isMultiFloorHouseType } from "@/lib/roomUtils";
import { calculateIntelligentDefaultFloor } from "@/lib/floorAssignment";
import {
  saveOfflineDraft,
  deleteOfflineDraft,
  offlineDraftToQuotation,
  quotationToOfflineDraft,
} from "@/lib/offline/draftStore";
import { useOfflineDraftAutosave } from "@/lib/offline/useOfflineDraftAutosave";
import type { OfflineQuotationDraft } from "@/lib/offline/db";

function extractErrorMessage(err: any, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (err.error) {
    if (typeof err.error === "string") return err.error;
    if (typeof err.error === "object" && err.error.message) return err.error.message;
  }
  if (err.message && typeof err.message === "string") return err.message;
  return fallback;
}

interface Props {
  initialQuotation?: Quotation | null;
  initialHouseTypes?: HouseType[];
  initialProducts?: EditorCatalogProduct[];
  initialCategories?: Category[];
  initialRoomTypes?: RoomType[];
  initialCompany?: Company | null;
  initialStep?: ProposalStep;
  isOfflineDraft?: boolean;
  initialOfflineDraft?: OfflineQuotationDraft | null;
  initialTemplate?: QuotationTemplate | null;
}

export default function ProposalBuilder({
  initialQuotation = null,
  initialHouseTypes = [],
  initialProducts = [],
  initialCategories = [],
  initialRoomTypes = [],
  initialCompany = null,
  initialStep = 1,
  isOfflineDraft = false,
  initialOfflineDraft = null,
  initialTemplate = null,
}: Props) {
  const searchParams = useSearchParams();

  // Resolve step from URL query or initialStep
  const stepParam = searchParams.get("step");

  // Products skipped while cloning this quotation (unavailable — soft-deleted
  // product/variant/room type) — carried here via a query param on the
  // redirect after duplicating (see `QuotationsListing.tsx`), never written
  // to the database just to display this banner. Dismissible, shown once.
  const skippedParam = searchParams.get("skipped");
  const skippedLabels = useMemo(
    () => (skippedParam ? skippedParam.split(",").filter(Boolean) : []),
    [skippedParam]
  );
  const [skippedBannerDismissed, setSkippedBannerDismissed] = useState(false);

  // Core Data States
  const [quotation, setQuotation] = useState<Quotation | null>(
    initialQuotation ? normalizeQuotation(initialQuotation) : null
  );
  const [houseTypes, setHouseTypes] = useState<HouseType[]>(normalizeHouseTypes(initialHouseTypes));
  const [products, setProducts] = useState<EditorCatalogProduct[]>(initialProducts);
  const [categories, setCategories] = useState<Category[]>(normalizeCategories(initialCategories));
  const [roomTypes, setRoomTypes] = useState<RoomType[]>(normalizeRoomTypes(initialRoomTypes));
  const [company, setCompany] = useState<Company | null>(() => {
    if (initialCompany) return initialCompany;
    if (typeof window !== "undefined") {
      const cId = (initialQuotation as any)?.companyId || initialOfflineDraft?.companyId;
      if (cId) {
        try {
          const cached = localStorage.getItem(`whyte:company_profile:${cId}`);
          if (cached) return JSON.parse(cached);
        } catch {}
      }
    }
    return null;
  });

  useEffect(() => {
    if (initialCompany) {
      setCompany(initialCompany);
    }
  }, [initialCompany]);

  // "Clone this quotation": the dialog and, for Admins, the dealers a clone can be given to.
  const { data: authSession } = useSession();
  const sessionRole = (authSession?.user as { role?: string } | undefined)?.role;
  const canChooseCloneOwner = sessionRole === "super_admin" || sessionRole === "company_owner" || sessionRole === "admin";
  const [cloneSource, setCloneSource] = useState<CloneSource | null>(null);
  const [cloneDealers, setCloneDealers] = useState<Array<{ value: string; label: string }>>([]);
  const openCloneDialog = () => {
    if (!quotation?.id) return;
    setCloneSource({ id: String(quotation.id), quotationNumber: String(quotation.quotationNumber ?? "quotation"), clientName: String(quotation.clientName ?? "this client") });
    if (canChooseCloneOwner && cloneDealers.length === 0) {
      fetch("/api/admin/dealers?pageSize=100")
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          const list = Array.isArray(body?.data) ? body.data : [];
          setCloneDealers(list.map((dealer: { id: number; name?: string | null; email?: string }) => ({ value: String(dealer.id), label: dealer.name || dealer.email || "Dealer" })));
        })
        .catch(() => {});
    }
  };

  // Fetch status ref to guard against redundant/duplicate network fetches
  const fetchStatusRef = useRef({
    houseTypes: initialHouseTypes.length > 0,
    products: initialProducts.length > 0,
    categories: initialCategories.length > 0,
    roomTypes: initialRoomTypes.length > 0,
    company: !!initialCompany,
  });

  // Active Room state for Step 3
  const initialRooms = initialQuotation?.rooms || [];
  const firstRoomId = initialRooms.length > 0 ? (initialRooms[0].id ?? (initialRooms[0] as any)._id) : null;
  const [activeRoomId, setActiveRoomId] = useState<number | null>(firstRoomId);

  // Keep activeRoomId in sync with valid rooms
  useEffect(() => {
    const rooms = quotation?.rooms || [];
    if (rooms.length === 0) {
      if (activeRoomId !== null) setActiveRoomId(null);
      return;
    }
    const isActiveValid = rooms.some(
      (r) => Number(r.id ?? (r as any)._id) === Number(activeRoomId)
    );
    if (!isActiveValid) {
      setActiveRoomId(Number(rooms[0].id ?? (rooms[0] as any)._id));
    }
  }, [quotation?.rooms, activeRoomId]);

  // Loading & Saving States
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");

  const quotationId = quotation?.id;
  const isQuotationLocked = quotation?.status === "approved" || quotation?.status === "delivered";

  // Catalog-driven unavailability (a referenced product/variant/room type
  // has since been soft-deleted) — computed server-side on every GET
  // (`normalizeQuotation`/`normalizeQuotationItem`/`normalizeQuotationRoom`
  // in `@/lib/quotationNormalization`, using the same `quotationAvailability.ts`
  // predicates everywhere else). This banner is purely informational: it
  // never triggers a write, and for an Approved/Delivered quotation the
  // wording makes clear the saved totals are untouched (see the `isLocked`
  // suppression already in place on the per-item/per-room indicators below,
  // which still apply only to the non-locked wording).
  const [unavailableBannerDismissed, setUnavailableBannerDismissed] = useState(false);
  const unavailableItemLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const room of quotation?.rooms ?? []) {
      if (room.isUnavailable) {
        labels.add(room.customName || room.roomType?.name || "A space in this quotation");
        continue;
      }
      for (const item of room.items ?? []) {
        if (item.isUnavailable) labels.add(item.product?.name || item.variantLabel || "A product in this quotation");
      }
    }
    return [...labels];
  }, [quotation?.rooms]);

  // Offline Draft & Autosave state
  const [offlineDraft, setOfflineDraft] = useState<OfflineQuotationDraft | null>(initialOfflineDraft);

  const {
    status: draftAutosaveStatus,
    triggerAutosave,
    flushNow: flushDraftAutosave,
  } = useOfflineDraftAutosave(offlineDraft, {
    debounceMs: 700,
    onSaved: () => {
      setSaveStatus("saved");
    },
    onError: (err) => {
      setSaveStatus("unsaved");
      toast.error(`Local save error: ${err}`);
    },
  });

  // Dynamic Workflow Engine
  const engine = useWorkflowEngine({
    quotation,
    initialTemplate,
    initialStepParam: stepParam || initialStep,
    isOfflineDraft,
    onNavigateUrl: (stepId) => {
      if (isOfflineDraft && (offlineDraft?.id || quotationId)) {
        flushDraftAutosave();
        window.history.pushState(null, "", `/quotation/draft/${offlineDraft?.id || quotationId}?step=${stepId}`);
      } else if (quotationId) {
        window.history.pushState(null, "", `/quotation/${quotationId}?step=${stepId}`);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const {
    currentStep,
    currentStepId,
    currentStepNumber,
    workflowSteps,
    stepIndicatorItems,
    completedStepIds,
    canNavigateToStep,
    navigateToStep,
    goToNextStep,
    goToPrevStep,
  } = engine;

  // Browser Back/Forward navigation synchronization
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("step");
      if (s) {
        engine.navigateToStep(s);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [engine]);

  // Network connectivity status for offline drafts
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [isSyncingToCloud, setIsSyncingToCloud] = useState(false);

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

  // Always ensure company details are loaded & cached (works both online and offline)
  useEffect(() => {
    const cId = (quotation as any)?.companyId || initialCompany?.id || offlineDraft?.companyId;
    if (!cId) return;

    // Load from localStorage if not yet set
    if (!company && typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(`whyte:company_profile:${cId}`);
        if (cached) setCompany(JSON.parse(cached));
      } catch {}
    }

    // Refresh from /api/company if online
    if (typeof navigator === "undefined" || navigator.onLine) {
      fetch("/api/company")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data === "object" && !data.error) {
            setCompany(data);
            try {
              localStorage.setItem(`whyte:company_profile:${cId}`, JSON.stringify(data));
            } catch {}
          }
        })
        .catch(() => {});
    }
  }, [(quotation as any)?.companyId, initialCompany, offlineDraft?.companyId, company]);

  const handleSyncToCloud = async () => {
    if (!offlineDraft || isSyncingToCloud) return;
    if (!isOnline) {
      toast.error("You are currently offline. Please connect to the internet to sync this draft.");
      return;
    }

    setIsSyncingToCloud(true);
    const toastId = toast.loading("Syncing draft to cloud...");

    try {
      flushDraftAutosave();

      const res = await fetch("/api/quotations/sync-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: offlineDraft }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to sync quotation to cloud"));
      }

      const json = await res.json();
      const createdQuote = json?.data ?? json;

      try {
        await deleteOfflineDraft(offlineDraft.companyId, offlineDraft.userId, offlineDraft.id);
      } catch {}

      toast.success(`Quotation ${createdQuote.quotationNumber || ""} synced to cloud!`, { id: toastId });

      window.location.href = `/quotation/${createdQuote.id}?step=${currentStepId}`;
    } catch (err: any) {
      toast.error(err?.message || "Failed to sync draft to cloud", { id: toastId });
      setIsSyncingToCloud(false);
    }
  };

  // Refetch latest quotation data from API
  const refreshQuotation = useCallback(async () => {
    if (!quotationId) return;
    try {
      const res = await fetch(`/api/quotations/${quotationId}`);
      if (res.ok) {
        const fresh = await res.json();
        const normalized = normalizeQuotation(fresh);
        setQuotation(normalized);
        const validRooms = normalized.rooms || [];
        if (validRooms.length > 0) {
          if (!activeRoomId || !validRooms.some((r) => r.id === activeRoomId)) {
            setActiveRoomId(validRooms[0].id);
          }
        } else {
          setActiveRoomId(null);
        }
      }
    } catch (e) {
      console.error("Failed to refresh quotation:", e);
    }
  }, [quotationId, activeRoomId]);

  // ── Local state updates from a mutation's own response ──────────────────
  //
  // Every item/room mutation endpoint already returns the created/updated
  // entity, normalized the exact same way a GET does (same
  // `normalizeQuotationItem`/`normalizeQuotationRoom` server-side). These
  // helpers apply that response to local state directly, instead of
  // discarding it and issuing a second full `GET /api/quotations/[id]`
  // request. No quotation-level total (subtotal/grandTotal/GST/earning) is
  // read from `quotation` directly anywhere in this wizard — every screen
  // recomputes those from `quotation.rooms` — so updating `rooms` correctly
  // is sufficient; there is no separate cached total to go stale.
  //
  // Ordering stays correct because the only new-position case (adding an
  // item) always appends to the END of its target room, matching every
  // existing item's `sortOrder: 0` (ties keep insertion order); replacing or
  // removing an item/room never changes its position. `handleUpdateItem`/
  // `handleReplaceItem` never send `quotationRoomId` (grep-verified: neither
  // caller ever does), so an updated item always stays in the room it was
  // already in.

  const upsertItemLocally = useCallback((rawItem: any) => {
    if (!rawItem) return;
    const incomingItems = Array.isArray(rawItem) ? rawItem : [rawItem];
    if (incomingItems.length === 0) return;

    setQuotation((prev) => {
      if (!prev) return prev;
      let rooms = [...(prev.rooms || [])];
      let directItems = [...(prev.items || [])];

      for (const raw of incomingItems) {
        const item = normalizeQuotationItem(raw);
        const targetRoomId = item.quotationRoomId != null ? Number(item.quotationRoomId) : null;
        let replaced = false;

        if (targetRoomId) {
          rooms = rooms.map((room) => {
            const items = room.items || [];
            const idx = items.findIndex((it) => Number(it.id ?? (it as any)._id) === Number(item.id));
            if (idx === -1) return room;
            replaced = true;
            const nextItems = [...items];
            nextItems[idx] = item;
            return { ...room, items: nextItems };
          });

          if (!replaced) {
            // Not found in any existing room: append to target room
            rooms = rooms.map((room) => {
              const roomId = Number(room.id ?? (room as any)._id);
              if (roomId !== targetRoomId) return room;
              return { ...room, items: [...(room.items || []), item] };
            });
          }
        } else {
          // Direct quotation item (room-less)
          const idx = directItems.findIndex((it) => Number(it.id ?? (it as any)._id) === Number(item.id));
          if (idx !== -1) {
            directItems[idx] = item;
          } else {
            directItems.push(item);
          }
        }
      }

      return { ...prev, rooms, items: directItems };
    });
  }, []);

  const removeItemLocally = useCallback((itemId: number) => {
    setQuotation((prev) => {
      if (!prev) return prev;
      const rooms = (prev.rooms || []).map((room) => ({
        ...room,
        items: (room.items || []).filter((it) => Number(it.id ?? (it as any)._id) !== Number(itemId)),
      }));
      const items = (prev.items || []).filter((it) => Number(it.id ?? (it as any)._id) !== Number(itemId));
      return { ...prev, rooms, items };
    });
  }, []);

  const upsertRoomLocally = useCallback((rawRoom: any) => {
    const room = normalizeQuotationRoom(rawRoom, quotationId);
    setQuotation((prev) => {
      if (!prev) return prev;
      const rooms = prev.rooms || [];
      const idx = rooms.findIndex((r) => Number(r.id ?? (r as any)._id) === Number(room.id));
      if (idx === -1) {
        return { ...prev, rooms: [...rooms, room] };
      }
      const nextRooms = [...rooms];
      nextRooms[idx] = room;
      return { ...prev, rooms: nextRooms };
    });
  }, [quotationId]);

  const removeRoomLocally = useCallback((roomId: number) => {
    setQuotation((prev) => {
      if (!prev) return prev;
      return { ...prev, rooms: (prev.rooms || []).filter((r) => Number(r.id ?? (r as any)._id) !== Number(roomId)) };
    });
  }, []);

  // Load auxiliary data with step-aware prioritization and deduplication
  useEffect(() => {
    if (isOfflineDraft) return;
    // 1. Data needed for early steps (House types for Step 1/2, Room types for Step 2)
    if (houseTypes.length === 0 && !fetchStatusRef.current.houseTypes) {
      fetchStatusRef.current.houseTypes = true;
      fetch("/api/house-types")
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setHouseTypes(normalizeHouseTypes(Array.isArray(data) ? data : [])))
        .catch(() => setHouseTypes([]));
    }

    if (roomTypes.length === 0 && !fetchStatusRef.current.roomTypes) {
      fetchStatusRef.current.roomTypes = true;
      fetch("/api/room-types")
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setRoomTypes(normalizeRoomTypes(Array.isArray(data) ? data : [])))
        .catch(() => setRoomTypes([]));
    }

    // 2. Heavy product catalog (products ~330KB + categories) - defer until Step 2+ or when Step 3 is needed
    if (currentStepNumber >= 2) {
      if (products.length === 0 && !fetchStatusRef.current.products) {
        fetchStatusRef.current.products = true;
        fetch("/api/products?editor=true")
          .then((r) => (r.ok ? r.json() : []))
          .then((data) => {
            const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
            setProducts(
              list.map((p: any) => ({
                ...p,
                id: Number(p.id ?? p._id),
                variants: Array.isArray(p.variants)
                  ? p.variants.map((v: any) => ({
                      ...v,
                      id: Number(v.id ?? v._id),
                      price: String(v.price),
                    }))
                  : [],
              }))
            );
          })
          .catch(() => {
            fetchStatusRef.current.products = false;
            setProducts([]);
          });
      }

      if (categories.length === 0 && !fetchStatusRef.current.categories) {
        fetchStatusRef.current.categories = true;
        fetch("/api/categories")
          .then((r) => (r.ok ? r.json() : []))
          .then((data) => setCategories(normalizeCategories(Array.isArray(data) ? data : [])))
          .catch(() => {
            fetchStatusRef.current.categories = false;
            setCategories([]);
          });
      }
    }

    // 3. Company details - load for Step 3+ (Review and PDF preview)
    if (currentStepNumber >= 3) {
      if (!company && !fetchStatusRef.current.company) {
        fetchStatusRef.current.company = true;
        fetch("/api/company")
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => setCompany(data && typeof data === "object" && !data.error ? data : null))
          .catch(() => setCompany(null));
      }
    }
  }, [currentStepNumber, houseTypes.length, roomTypes.length, products.length, categories.length, company]);

  // Step 1: Save & Continue Handler
  const handleSaveProjectDetails = async (formData: ProjectFormData) => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const notesWithProject = formData.projectName.trim()
        ? `Project: ${formData.projectName.trim()}${formData.notes.trim() ? `\n${formData.notes.trim()}` : ""}`
        : formData.notes.trim() || null;

      if (isOfflineDraft && offlineDraft) {
        const nextQuote: any = {
          ...(quotation || {}),
          clientName: formData.clientName.trim(),
          clientAddress: formData.location.trim() || null,
          clientPhone: formData.clientPhone.trim() || null,
          clientEmail: formData.clientEmail.trim() || null,
          clientGstNumber: formData.clientGstNumber.trim() || null,
          houseTypeId: formData.houseTypeId,
          premisesName: formData.houseTypeId ? null : formData.premisesName.trim() || null,
          notes: notesWithProject,
          customerId: formData.customerId ?? null,
          leadId: formData.leadId ?? null,
        };
        const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
        setOfflineDraft(nextDraft);
        const norm = offlineDraftToQuotation(nextDraft, products, roomTypes);
        setQuotation(norm);
        if (norm.rooms?.length > 0) {
          setActiveRoomId(norm.rooms[0].id);
        }
        await saveOfflineDraft(nextDraft);
        setSaveStatus("saved");
        toast.success("Project details saved locally");
        goToNextStep();
        return;
      }

      if (!quotation?.id) {
        // Create new quotation via POST /api/quotations
        const res = await fetch("/api/quotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientName: formData.clientName.trim(),
            clientAddress: formData.location.trim() || null,
            clientPhone: formData.clientPhone.trim() || null,
            clientEmail: formData.clientEmail.trim() || null,
            clientGstNumber: formData.clientGstNumber.trim() || null,
            houseTypeId: formData.houseTypeId,
            premisesName: formData.houseTypeId ? null : formData.premisesName.trim() || null,
            notes: notesWithProject,
            ...(formData.templateId ? { templateId: formData.templateId } : {}),
            ...(formData.customFieldValues ? { customFieldValues: formData.customFieldValues } : {}),
            ...(formData.customerId ? { customerId: formData.customerId } : {}),
            ...(formData.leadId ? { leadId: formData.leadId } : {}),
            ...(formData.dealerId ? { dealerId: formData.dealerId } : {}),
            ...(formData.assignedSalesId ? { assignedSalesId: formData.assignedSalesId } : {}),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(extractErrorMessage(err, "Failed to create quotation"));
        }

        const resJson = await res.json();
        const newQuote = resJson?.data ?? resJson;
        toast.success("Project initialized!");

        // Consume the populated quotation directly from POST response, avoiding redundant GET fetch
        const normalized = normalizeQuotation(newQuote);

        setQuotation(normalized);
        if (normalized.rooms?.length > 0) {
          setActiveRoomId(normalized.rooms[0].id);
        }
        setSaveStatus("saved");

        // Seamless navigation to next step:
        // 1. Replace current '/quotation/new' history entry with '/quotation/[id]?step=project_details'
        // 2. Advance to next step in workflow
        window.history.replaceState(null, "", `/quotation/${normalized.id}?step=project_details`);
        goToNextStep();
      } else {
        // Update existing quotation via PATCH /api/quotations/[id]
        const res = await fetch(`/api/quotations/${quotation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientName: formData.clientName.trim(),
            clientAddress: formData.location.trim() || null,
            clientPhone: formData.clientPhone.trim() || null,
            clientEmail: formData.clientEmail.trim() || null,
            clientGstNumber: formData.clientGstNumber.trim() || null,
            houseTypeId: formData.houseTypeId,
            premisesName: formData.houseTypeId ? null : formData.premisesName.trim() || null,
            notes: notesWithProject,
            ...(formData.templateId ? { templateId: formData.templateId } : {}),
            ...(formData.customFieldValues ? { customFieldValues: formData.customFieldValues } : {}),
            ...(formData.customerId !== undefined ? { customerId: formData.customerId } : {}),
            ...(formData.leadId !== undefined ? { leadId: formData.leadId } : {}),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(extractErrorMessage(err, "Failed to update project details"));
        }

        let resJson = await res.json();

        // Reassignment is a separate, admin-only, audited endpoint.
        const previousDealerId = quotation.dealerId ?? null;
        const previousSalesId = quotation.assignedSalesId ?? null;
        const dealerChanged = formData.dealerId !== previousDealerId && formData.dealerId !== undefined;
        const salesChanged = formData.assignedSalesId !== previousSalesId && formData.assignedSalesId !== undefined;

        if (dealerChanged || salesChanged) {
          const assignRes = await fetch(`/api/quotations/${quotation.id}/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(dealerChanged ? { dealerId: formData.dealerId } : {}),
              ...(salesChanged ? { assignedSalesId: formData.assignedSalesId } : {}),
            }),
          });
          if (!assignRes.ok) {
            const err = await assignRes.json().catch(() => ({}));
            throw new Error(extractErrorMessage(err, "Failed to update quotation assignment"));
          }
          const freshRes = await fetch(`/api/quotations/${quotation.id}`);
          if (freshRes.ok) resJson = await freshRes.json();
        }

        const updated = resJson?.data ?? resJson;
        const normalized = normalizeQuotation(updated);
        setQuotation(normalized);
        if (normalized.rooms?.length > 0 && (!activeRoomId || !normalized.rooms.some((r) => r.id === activeRoomId))) {
          setActiveRoomId(normalized.rooms[0].id);
        }
        setSaveStatus("saved");
        toast.success("Project details saved");
        goToNextStep();
      }
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to save project details"));
      setSaveStatus("unsaved");
    } finally {
      setIsSaving(false);
    }
  };

  // Custom Form Step Save Handler (Supports workflow-independent quotation initialization)
  const handleSaveCustomFormStep = async (newValues: Record<string, any>) => {
    if (isSaving || isQuotationLocked) return;
    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const mergedValues = {
        ...((quotation?.customFieldValues as Record<string, any>) || {}),
        ...newValues,
      };

      // Extract system-bound fields from newValues using currentStep field definitions
      let clientName = newValues.clientName || "";
      let clientPhone = newValues.clientPhone || undefined;
      let clientEmail = newValues.clientEmail || undefined;
      let clientAddress = newValues.clientAddress || newValues.siteAddress || newValues.location || undefined;
      let clientGstNumber = newValues.clientGstNumber || undefined;
      let premisesName = newValues.premisesName || undefined;
      let notes = newValues.notes || undefined;
      let customerId = newValues.customerId || undefined;
      let leadId = newValues.leadId || undefined;

      // Inspect sections and fields for explicit systemBinding mappings
      for (const sec of currentStep.sections || []) {
        for (const f of sec.fields || []) {
          const val = newValues[f.key];
          if (val !== undefined && val !== null && val !== "") {
            if (f.systemBinding === "clientName") clientName = String(val).trim();
            else if (f.systemBinding === "clientPhone") clientPhone = String(val).trim();
            else if (f.systemBinding === "clientEmail") clientEmail = String(val).trim();
            else if (f.systemBinding === "clientAddress") clientAddress = String(val).trim();
            else if (f.systemBinding === "clientGstNumber") clientGstNumber = String(val).trim();
            else if (f.systemBinding === "premisesName") premisesName = String(val).trim();
            else if (f.systemBinding === "notes") notes = String(val).trim();
            else if (f.systemBinding === "customerId") customerId = Number(val) || undefined;
            else if (f.systemBinding === "leadId") leadId = String(val).trim();
          }
        }
      }

      if (isOfflineDraft && offlineDraft) {
        const nextQuote = {
          ...(quotation || {}),
          ...(clientName ? { clientName } : {}),
          ...(clientAddress ? { clientAddress } : {}),
          ...(clientPhone ? { clientPhone } : {}),
          ...(clientEmail ? { clientEmail } : {}),
          customFieldValues: mergedValues,
        };
        const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
        setOfflineDraft(nextDraft);
        const norm = offlineDraftToQuotation(nextDraft, products, roomTypes);
        setQuotation(norm);
        await saveOfflineDraft(nextDraft);
        setSaveStatus("saved");
        toast.success("Step saved locally");
        goToNextStep();
        return;
      }

      if (!quotation?.id) {
        // Workflow-independent creation: Step 1 is a custom form initializing the quotation record
        const templateId = engine.template?.id || undefined;
        const templateVersion = engine.template?.version || 1;

        const res = await fetch("/api/quotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientName: clientName || "Valued Client",
            clientPhone: clientPhone || null,
            clientEmail: clientEmail || null,
            clientAddress: clientAddress || null,
            clientGstNumber: clientGstNumber || null,
            premisesName: premisesName || null,
            notes: notes || null,
            customerId: customerId || null,
            leadId: leadId || null,
            templateId,
            templateVersion,
            customFieldValues: mergedValues,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(extractErrorMessage(err, "Failed to initialize quotation"));
        }

        const resJson = await res.json();
        const newQuote = resJson?.data ?? resJson;
        const normalized = normalizeQuotation(newQuote);
        setQuotation(normalized);
        if (normalized.rooms?.length > 0) {
          setActiveRoomId(normalized.rooms[0].id);
        }
        setSaveStatus("saved");
        toast.success("Quotation initialized!");

        window.history.replaceState(null, "", `/quotation/${normalized.id}?step=${currentStepId}`);
        goToNextStep();
      } else {
        // Update existing quotation step values
        const patchBody: Record<string, any> = {
          customFieldValues: mergedValues,
        };
        if (clientName) patchBody.clientName = clientName;
        if (clientPhone !== undefined) patchBody.clientPhone = clientPhone;
        if (clientEmail !== undefined) patchBody.clientEmail = clientEmail;
        if (clientAddress !== undefined) patchBody.clientAddress = clientAddress;
        if (clientGstNumber !== undefined) patchBody.clientGstNumber = clientGstNumber;
        if (premisesName !== undefined) patchBody.premisesName = premisesName;
        if (notes !== undefined) patchBody.notes = notes;

        const res = await fetch(`/api/quotations/${quotation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(extractErrorMessage(err, "Failed to save step"));
        }

        const body = await res.json();
        setQuotation(normalizeQuotation(body?.data ?? body));
        setSaveStatus("saved");
        toast.success("Step saved");
        goToNextStep();
      }
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to save step"));
      setSaveStatus("unsaved");
    } finally {
      setIsSaving(false);
    }
  };

  // Step 2: Room Operations
  const handleAddRoom = async (
    roomTypeId: number | null,
    customName?: string,
    subArea?: string
  ) => {
    if (!quotation?.id) return;
    setSaveStatus("saving");

    let roomName = customName || "";
    if (!roomName && roomTypeId) {
      const foundType = roomTypes.find((r) => Number(r.id ?? (r as any)._id) === Number(roomTypeId));
      roomName = foundType?.name || "";
    }

    const isMultiFloor = isMultiFloorHouseType(
      houseTypes.find((h) => Number(h.id ?? (h as any)._id) === Number(quotation.houseTypeId))
    );

    const finalFloor = calculateIntelligentDefaultFloor({
      roomName,
      existingRooms: quotation.rooms || [],
      isMultiFloor,
      explicitFloorContext: subArea,
    });

    if (isOfflineDraft && offlineDraft) {
      const newRoomId = Date.now();
      const newRoomObj: any = {
        id: newRoomId,
        _id: newRoomId,
        quotationId: quotation.id,
        roomTypeId,
        roomType: roomTypes.find((r) => Number(r.id ?? (r as any)._id) === Number(roomTypeId)),
        customName: customName || null,
        subArea: finalFloor,
        sortOrder: (quotation.rooms?.length ?? 0) * 10,
        items: [],
      };

      const nextQuote = {
        ...quotation,
        rooms: [...(quotation.rooms || []), newRoomObj],
      };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      const converted = offlineDraftToQuotation(nextDraft, products, roomTypes);
      setQuotation(converted);
      const addedRoom = converted.rooms?.[converted.rooms.length - 1];
      if (addedRoom) {
        setActiveRoomId(addedRoom.id);
      }
      triggerAutosave();
      toast.success(`Space "${roomName || "Room"}" added`);
      return;
    }

    try {
      const res = await fetch(`/api/quotations/${quotation.id}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomTypeId,
          customName: customName || null,
          subArea: finalFloor,
          sortOrder: (quotation.rooms?.length ?? 0) * 10,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to add room"));
      }
      const roomRes = await res.json();
      const createdRoom = roomRes?.data ?? roomRes;
      const createdId = Number(createdRoom.id ?? createdRoom._id);
      if (createdId) {
        setActiveRoomId(createdId);
      }
      upsertRoomLocally(createdRoom);
      setSaveStatus("saved");
      toast.success(`Space "${createdRoom.customName ?? "Room"}" added`);
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to add room"));
      setSaveStatus("unsaved");
    }
  };

  const handleUpdateRoom = async (
    roomId: number,
    data: Partial<{
      roomTypeId: number | null;
      customName: string | null;
      subArea: string | null;
      notes: string | null;
      sortOrder: number;
    }>
  ) => {
    if (!quotation?.id) return;

    if (isOfflineDraft && offlineDraft) {
      const nextRooms = (quotation.rooms || []).map((r) =>
        Number(r.id ?? (r as any)._id) === Number(roomId) ? { ...r, ...data } : r
      );
      const nextQuote = { ...quotation, rooms: nextRooms };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      return;
    }

    // Optimistically update local quotation state for immediate UI regrouping
    setQuotation((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rooms: (prev.rooms || []).map((r) =>
          Number(r.id ?? (r as any)._id) === Number(roomId) ? { ...r, ...data } : r
        ),
      };
    });

    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to update space"));
      }
      const body = await res.json();
      upsertRoomLocally(body?.data ?? body);
      setSaveStatus("saved");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to update space"));
      // The optimistic update above may be wrong; only this path still needs
      // a real refetch, to recover a known-correct state after a failure.
      await refreshQuotation();
      setSaveStatus("unsaved");
      throw e;
    }
  };

  const handleDeleteRoom = async (roomId: number) => {
    if (!quotation?.id) return;
    if (isOfflineDraft && offlineDraft) {
      const nextRooms = (quotation.rooms || []).filter((r) => Number(r.id ?? (r as any)._id) !== Number(roomId));
      if (activeRoomId === roomId) {
        setActiveRoomId(nextRooms[0]?.id ?? null);
      }
      const nextQuote = { ...quotation, rooms: nextRooms };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      toast.success("Space removed");
      return;
    }
    const previousRooms = quotation.rooms || [];
    const remaining = previousRooms.filter((r) => Number(r.id ?? (r as any)._id) !== Number(roomId));

    // Optimistic UI update: instantly remove room from screen
    if (activeRoomId === roomId) {
      setActiveRoomId(remaining[0]?.id ?? (remaining[0] as any)?._id ?? null);
    }
    removeRoomLocally(roomId);
    setSaveStatus("saving");

    try {
      const res = await fetch(`/api/quotations/${quotation.id}/rooms/${roomId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to remove room"));
      }

      setSaveStatus("saved");
      toast.success("Space removed");
    } catch (e: any) {
      // Rollback to previous state on failure
      setQuotation((prev) => (prev ? { ...prev, rooms: previousRooms } : prev));
      toast.error(extractErrorMessage(e, "Failed to remove room"));
      setSaveStatus("unsaved");
      throw e;
    }
  };

  // Step 3: Item Operations
  // Resolves `true` once the item is saved and shown, `false` when the request failed (already toasted), so callers
  // that type a quantity can keep it instead of reporting a success that did not happen.
  const handleAddItem = async (
    roomId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>,
    quantity: number = 1
  ): Promise<boolean> => {
    if (!quotation?.id) return false;
    const hasRooms = (quotation.rooms?.length ?? 0) > 0;
    const targetRoomId = hasRooms ? Number(roomId || activeRoomId || quotation.rooms?.[0]?.id) : null;
    if (hasRooms && !targetRoomId) {
      toast.error("Please select a space before adding devices");
      return false;
    }

    if (isOfflineDraft && offlineDraft) {
      const prod = products.find((p) => p.id === productId);
      const variant = prod?.variants?.find((v) => v.id === productVariantId);
      const unitPrice = variant?.price ? String(variant.price) : String(prod?.price || 0);

      // Every Add is its own entry, so the new id must differ from every item already in the quotation.
      const takenItemIds = new Set([
        ...(quotation.rooms || []).flatMap((room) => (room.items || []).map((existing) => Number(existing.id ?? (existing as any)._id))),
        ...(quotation.items || []).map((existing) => Number(existing.id ?? (existing as any)._id)),
      ]);
      let newItemId = Date.now() + Math.floor(Math.random() * 1000);
      while (takenItemIds.has(newItemId)) newItemId += 1;
      const newItem: any = {
        id: newItemId,
        _id: newItemId,
        quotationRoomId: targetRoomId,
        productId,
        productVariantId: productVariantId ?? null,
        product: prod,
        productVariant: variant,
        variantLabel: variant?.automationTier || prod?.name || "Standard",
        variantConfig: variantConfig ?? null,
        quantity,
        unitPrice,
        originalUnitPrice: unitPrice,
        isCustomPrice: false,
        taxPercent: 18,
        sortOrder: 0,
      };

      let nextQuote = { ...quotation };
      if (targetRoomId) {
        const nextRooms = (quotation.rooms || []).map((room) => {
          if (Number(room.id ?? (room as any)._id) !== targetRoomId) return room;
          return { ...room, items: [...(room.items || []), newItem] };
        });
        nextQuote.rooms = nextRooms;
      } else {
        nextQuote.items = [...(quotation.items || []), newItem];
      }

      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      toast.success(quantity > 1 ? `${quantity} items added` : "Item added to quotation");
      return true;
    }

    setSaveStatus("saving");

    try {
      const res = await fetch(`/api/quotations/${quotation.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotationRoomId: targetRoomId ?? undefined,
          productId,
          productVariantId: productVariantId ?? undefined,
          variantConfig: variantConfig ?? undefined,
          quantity,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to add product"));
      }

      const body = await res.json();
      upsertItemLocally(body?.data ?? body);
      setSaveStatus("saved");
      toast.success(quantity > 1 ? `${quantity} items added` : "Item added to quotation");
      return true;
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to add item"));
      setSaveStatus("unsaved");
      return false;
    }
  };

  const handleUpdateItem = async (itemId: number, data: any): Promise<boolean> => {
    if (!quotation?.id) return false;

    if (isOfflineDraft && offlineDraft) {
      if (data.discountType !== undefined) {
        toast.error("Product discounts need a connection. Go online to give one.");
        return false;
      }
      const nextRooms = (quotation.rooms || []).map((room) => {
        const nextItems = (room.items || []).map((item) => {
          if (Number(item.id ?? (item as any)._id) !== Number(itemId)) return item;
          const updated = { ...item, ...data };
          if (data.resetToDefaultPrice) {
            const prod = products.find((p) => p.id === item.productId);
            const variant = prod?.variants?.find((v) => v.id === item.productVariantId);
            const defaultPrice = variant?.price ? String(variant.price) : String(prod?.price || item.originalUnitPrice || item.unitPrice);
            updated.unitPrice = defaultPrice;
            updated.isCustomPrice = false;
            delete (updated as any).resetToDefaultPrice;
          } else if (data.unitPrice !== undefined) {
            updated.unitPrice = String(data.unitPrice);
            updated.isCustomPrice = true;
          }
          return updated;
        });
        return { ...room, items: nextItems };
      });

      const nextQuote = { ...quotation, rooms: nextRooms };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      return true;
    }

    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to update item"));
      }
      const body = await res.json();
      upsertItemLocally(body?.data ?? body);
      setSaveStatus("saved");
      return true;
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to update item"));
      setSaveStatus("unsaved");
      return false;
    }
  };

  const handleReplaceItem = async (
    itemId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>,
    unitPrice?: number,
    variantLabel?: string,
    quantity?: number
  ) => {
    if (!quotation?.id) return;

    if (isOfflineDraft && offlineDraft) {
      const prod = products.find((p) => p.id === productId);
      const variant = prod?.variants?.find((v) => v.id === productVariantId);
      const price = unitPrice !== undefined ? String(unitPrice) : variant?.price ? String(variant.price) : String(prod?.price || 0);

      const nextRooms = (quotation.rooms || []).map((room) => {
        const nextItems = (room.items || []).map((item) => {
          if (Number(item.id ?? (item as any)._id) !== Number(itemId)) return item;
          return {
            ...item,
            productId,
            productVariantId: productVariantId ?? null,
            product: prod,
            productVariant: variant,
            variantConfig: variantConfig ?? null,
            unitPrice: price,
            variantLabel: variantLabel || variant?.automationTier || prod?.name || "Standard",
            quantity: quantity !== undefined ? quantity : item.quantity,
          };
        });
        return { ...room, items: nextItems };
      });

      const nextQuote = { ...quotation, rooms: nextRooms };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      toast.success("Product replaced");
      return;
    }

    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          productVariantId: productVariantId ?? null,
          variantConfig: variantConfig ?? null,
          unitPrice: unitPrice ?? undefined,
          variantLabel: variantLabel ?? null,
          quantity: quantity !== undefined ? quantity : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to replace product"));
      }
      const body = await res.json();
      upsertItemLocally(body?.data ?? body);
      setSaveStatus("saved");
      toast.success("Product replaced");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to replace product"));
      setSaveStatus("unsaved");
      throw e;
    }
  };

  const handleMassUpdateRoomItems = async (
    roomId: number,
    updates: Array<{
      itemId: number;
      productId: number;
      productVariantId?: number | null;
      variantConfig?: Record<string, string> | null;
      variantLabel?: string | null;
      quantity?: number;
    }>
  ) => {
    if (!quotation?.id) return;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/rooms/${roomId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: updates }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to update room products"));
      }
      const body = await res.json();
      const updatedRoom = body?.data?.room ?? body?.room ?? body?.data ?? body;
      upsertRoomLocally(updatedRoom);
      setSaveStatus("saved");
      toast.success("Room products updated");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to update room products"));
      setSaveStatus("unsaved");
      throw e;
    }
  };


  const handleDeleteItem = async (itemId: number) => {
    if (!quotation?.id) return;
    if (isOfflineDraft && offlineDraft) {
      const nextRooms = (quotation.rooms || []).map((room) => ({
        ...room,
        items: (room.items || []).filter((i) => Number(i.id ?? (i as any)._id) !== Number(itemId)),
      }));
      const nextItems = (quotation.items || []).filter((i) => Number(i.id ?? (i as any)._id) !== Number(itemId));
      const nextQuote = { ...quotation, rooms: nextRooms, items: nextItems };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      toast.success("Item removed");
      return;
    }

    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/items/${itemId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to remove item"));
      }
      removeItemLocally(itemId);
      setSaveStatus("saved");
      toast.success("Device removed");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to remove item"));
      setSaveStatus("unsaved");
    }
  };

  const handleClearRoom = async (roomId: number) => {
    if (!quotation?.id) return;
    if (isOfflineDraft && offlineDraft) {
      const nextRooms = (quotation.rooms || []).map((r) =>
        Number(r.id ?? (r as any)._id) === Number(roomId) ? { ...r, items: [] } : r
      );
      const nextQuote = { ...quotation, rooms: nextRooms };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      toast.success("Room devices cleared");
      return;
    }

    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/rooms/${roomId}/items`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to clear room"));
      }
      const body = await res.json();
      const updatedRoom = body?.data?.room ?? body?.room ?? body?.data;
      if (updatedRoom) {
        upsertRoomLocally(updatedRoom);
      } else {
        setQuotation((prev) => {
          if (!prev) return prev;
          const nextRooms = (prev.rooms || []).map((r) =>
            Number(r.id ?? (r as any)._id) === Number(roomId) ? { ...r, items: [] } : r
          );
          return { ...prev, rooms: nextRooms };
        });
      }
      setSaveStatus("saved");
      toast.success("Room devices cleared");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to clear room"));
      setSaveStatus("unsaved");
    }
  };

  const handleRoomsUpdated = (updatedRooms: QuotationRoom[]) => {
    setQuotation((prev) => {
      if (!prev) return prev;
      const updatedMap = new Map(
        updatedRooms.map((r) => [Number(r.id ?? (r as any)._id), r])
      );
      const nextRooms = (prev.rooms || []).map((r) => {
        const rId = Number(r.id ?? (r as any)._id);
        return updatedMap.get(rId) || r;
      });
      const nextQuote = { ...prev, rooms: nextRooms };
      if (isOfflineDraft && offlineDraft) {
        const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
        setOfflineDraft(nextDraft);
        triggerAutosave();
      }
      return nextQuote;
    });
  };

  const handleUpdateRoomNotes = async (roomId: number, notes: string) => {
    if (!quotation?.id) return;
    if (isOfflineDraft && offlineDraft) {
      const nextRooms = (quotation.rooms || []).map((r) =>
        Number(r.id ?? (r as any)._id) === Number(roomId) ? { ...r, notes: notes || null } : r
      );
      const nextQuote = { ...quotation, rooms: nextRooms };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      toast.success("Notes saved");
      return;
    }

    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes || null }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to save notes"));
      }
      const body = await res.json();
      upsertRoomLocally(body?.data ?? body);
      setSaveStatus("saved");
      toast.success("Notes saved");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to save notes"));
      setSaveStatus("unsaved");
    }
  };

  // Step 4: Discount Update
  const handleUpdateDiscount = async (
    type: "percentage" | "fixed" | "none",
    value: number
  ) => {
    if (!quotation?.id) return;
    if (isOfflineDraft && offlineDraft) {
      const nextQuote = {
        ...quotation,
        discountType: type,
        discountValue: value,
        customerDiscountPercent: type === "percentage" ? value : 0,
      };
      const nextDraft = quotationToOfflineDraft(nextQuote, offlineDraft);
      setOfflineDraft(nextDraft);
      setQuotation(offlineDraftToQuotation(nextDraft, products, roomTypes));
      triggerAutosave();
      toast.success("Discount updated");
      return;
    }

    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discountType: type,
          discountValue: value,
          customerDiscountPercent: type === "percentage" ? value : 0,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to apply discount"));
      }
      // The PATCH response is the full quotation, normalized the exact same
      // way a GET would be (same server-side `normalizeQuotation` call) — no
      // need to issue a second request to fetch what this response already is.
      const body = await res.json();
      setQuotation(normalizeQuotation(body?.data ?? body));
      setSaveStatus("saved");
      toast.success("Discount updated");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to update discount"));
      setSaveStatus("unsaved");
    }
  };

  // A quotation only has a real product once some room item or direct item carries a positive quantity.
  const hasAnyItems = useMemo(
    () =>
      (quotation?.rooms ?? []).some((r) =>
        (r.items ?? []).some((i) => (Number(i.quantity) || 0) > 0)
      ) ||
      (quotation?.items ?? []).some((i) => (Number(i.quantity) || 0) > 0),
    [quotation]
  );

  // Guard against landing on Review/Proposal with no products via a direct URL,
  // a stale bookmark, or browser back/forward — snap back to the furthest valid step.
  useEffect(() => {
    if (!quotation) return;
    if (canNavigateToStep(currentStepId)) return;
    const hasRooms = (quotation.rooms?.length ?? 0) > 0;
    const fallback: ProposalStep = hasRooms
      ? "space_selection"
      : workflowSteps.find((s) => s.id === "product_config" || s.moduleRef === "product_config")
      ? "product_config"
      : ((workflowSteps[0]?.id as ProposalStep) || "project_details");
    navigateToStep(fallback);
    if (
      currentStep.type === "built_in_module" &&
      (currentStep.moduleRef === "pricing_review" || currentStep.moduleRef === "proposal_preview") &&
      !hasAnyItems
    ) {
      toast.error("Add at least one product before continuing to Review.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotation?.id, currentStepId, hasAnyItems]);

  return (
    <div className="space-y-6 pb-20">
      {/* Skipped-on-clone warning — shown once, right at the top of the new quotation */}
      {skippedLabels.length > 0 && !skippedBannerDismissed && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">
              Some products were skipped because they are no longer available.
            </p>
            <p className="text-xs text-amber-700 mt-0.5 break-words">{skippedLabels.join(", ")}</p>
          </div>
          <button
            type="button"
            onClick={() => setSkippedBannerDismissed(true)}
            className="shrink-0 p-1 rounded-lg hover:bg-amber-100 text-amber-600"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {quotation?.id && !isOfflineDraft && (
        <QuotationRevisionBar quotationId={String(quotation.id)} status={String(quotation.status ?? "draft")} revision={Number((quotation as { revision?: number }).revision ?? 1)} />
      )}

      {/* Unavailable-catalog-reference warning — reappears on every load
          for as long as the underlying product/variant/room type stays
          soft-deleted (it is derived, never stored, so there is nothing to
          "persist" about the warning itself — only dismissible per-visit). */}
      {unavailableItemLabels.length > 0 && !unavailableBannerDismissed && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">
              {isQuotationLocked
                ? "One or more products in this quotation are no longer available in the catalog."
                : "One or more products in this quotation are no longer available."}
            </p>
            <p className="text-xs text-amber-700 mt-0.5 break-words">
              {isQuotationLocked
                ? `This is informational only — the saved amounts on this ${quotation?.status} quotation are unaffected. `
                : "They have been excluded from the totals below. "}
              {unavailableItemLabels.join(", ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUnavailableBannerDismissed(true)}
            className="shrink-0 p-1 rounded-lg hover:bg-amber-100 text-amber-600"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top Header / Status Bar */}
      <div className="flex flex-col gap-2.5 pb-3 border-b border-gray-100 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between sm:justify-start gap-3 min-w-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <Link
              href={isOfflineDraft ? "/quotations" : "/"}
              className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-gray-950 transition shrink-0 flex items-center justify-center min-w-[38px] min-h-[38px]"
              title="Exit proposal builder"
              aria-label="Exit proposal builder"
            >
              <ArrowLeft size={16} />
            </Link>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-gray-950 text-sm tracking-tight truncate max-w-[140px] xs:max-w-[190px] sm:max-w-none">
                  {isOfflineDraft ? (offlineDraft?.id ?? "draft_local") : (quotation?.quotationNumber ?? "New Proposal")}
                </span>
                {isOfflineDraft ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide uppercase bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs">
                    <WifiOff size={11} className="text-amber-600" />
                    <span>Offline Draft</span>
                  </span>
                ) : (
                  quotation?.status && (
                    <StatusBadge status={quotation.status as QuotationStatus} />
                  )
                )}
              </div>
              <p className="text-xs text-gray-500 truncate font-medium mt-0.5">
                {quotation?.clientName ? quotation.clientName : isOfflineDraft ? "Offline Smart Automation Draft" : "WHYTE Smart Automation Proposal Builder"}
              </p>
            </div>
          </div>

          {/* On mobile: Save & Exit placed top-right next to metadata */}
          <Link
            href={isOfflineDraft ? "/quotations" : "/"}
            className="sm:hidden px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition shrink-0"
          >
            Save & Exit
          </Link>
        </div>

        {/* Auto-save Status & Desktop Save & Exit */}
        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          {isOfflineDraft ? (
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <span
                className={`w-2 h-2 rounded-full ${
                  draftAutosaveStatus === "saving"
                    ? "bg-amber-400 animate-pulse"
                    : draftAutosaveStatus === "saved"
                    ? "bg-emerald-500"
                    : draftAutosaveStatus === "error"
                    ? "bg-red-400"
                    : "bg-emerald-500"
                }`}
              />
              <span className="font-medium text-[11px]">
                {draftAutosaveStatus === "saving"
                  ? "Saving locally..."
                  : draftAutosaveStatus === "error"
                  ? "Save Failed"
                  : "Saved Locally (IndexedDB)"}
              </span>
            </div>
          ) : quotation?.id ? (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span
                className={`w-2 h-2 rounded-full ${
                  saveStatus === "saving"
                    ? "bg-amber-400 animate-pulse"
                    : saveStatus === "saved"
                    ? "bg-emerald-500"
                    : "bg-red-400"
                }`}
              />
              <span className="font-medium capitalize text-[11px]">
                {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Auto-saved" : "Unsaved"}
              </span>
            </div>
          ) : null}

          {quotation?.id && !isOfflineDraft && (
            <button
              type="button"
              onClick={openCloneDialog}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
              title="Clone this quotation into a new draft"
              aria-label="Clone this quotation"
              data-testid="builder-clone"
            >
              <Copy size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Clone</span>
            </button>
          )}

          <Link
            href={isOfflineDraft ? "/quotations" : "/"}
            className="hidden sm:inline-flex px-3.5 py-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
          >
            Save & Exit
          </Link>
        </div>
      </div>

      {quotation?.id && !isOfflineDraft && (
        <CloneQuotationModal
          source={cloneSource}
          dealerOptions={cloneDealers}
          canChooseOwner={canChooseCloneOwner}
          onClose={() => setCloneSource(null)}
        />
      )}

      {/* Offline Draft Banner */}
      {isOfflineDraft && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-amber-500/10 via-amber-50/50 to-emerald-500/10 border border-amber-200/80 rounded-2xl text-xs">
          <div className="flex items-center gap-2 text-amber-900 font-medium">
            <Database size={15} className="text-amber-600 shrink-0" />
            <span>
              <strong>Offline Draft Mode:</strong> Saved locally in browser storage.
              {isOnline ? (
                <span className="ml-1 text-emerald-800 font-semibold">
                  • You are online. You can sync this draft to the cloud to get an official quotation number.
                </span>
              ) : (
                <span className="ml-1 text-amber-800">
                  • Working offline. Connect to the internet to sync to cloud.
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {offlineDraft?.catalogVersion && (
              <span className="text-[11px] font-mono text-gray-500 bg-white/80 px-2 py-1 rounded-md border border-gray-200/60 hidden sm:inline">
                Catalog: {offlineDraft.catalogVersion.slice(0, 10)}
              </span>
            )}
            {isOnline && offlineDraft && (
              <button
                type="button"
                onClick={handleSyncToCloud}
                disabled={isSyncingToCloud}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-semibold rounded-xl text-xs transition shadow-xs disabled:opacity-50 cursor-pointer"
                title="Upload draft to server and assign official quotation number"
              >
                <CloudUpload size={14} className={isSyncingToCloud ? "animate-spin" : ""} />
                <span>{isSyncingToCloud ? "Syncing to Cloud..." : "Sync to Cloud"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step Indicator Progress Bar */}
      <StepIndicator
        currentStep={currentStepId}
        completedSteps={completedStepIds}
        onStepClick={navigateToStep}
        canNavigateToStep={canNavigateToStep}
        steps={stepIndicatorItems}
      />

      {quotation && <QuotationOwnership quotation={quotation} />}

      {/* Dynamic Step View Rendering */}
      <div>
        {currentStep.type === "custom_form" && (
          <DynamicFormStep
            key={currentStep.id}
            step={currentStep}
            initialValues={quotation?.customFieldValues || {}}
            onSaveAndContinue={handleSaveCustomFormStep}
            onBack={goToPrevStep}
            onSkip={goToNextStep}
            isSaving={isSaving}
            isLocked={isQuotationLocked}
          />
        )}

        {currentStep.type === "built_in_module" && currentStep.moduleRef === "project_details" && (
          <StepProjectDetails
            initialData={quotation ?? undefined}
            houseTypes={houseTypes}
            onSaveAndContinue={handleSaveProjectDetails}
            isSaving={isSaving}
            step={currentStep}
          />
        )}

        {currentStep.type === "built_in_module" && currentStep.moduleRef === "space_selection" && quotation && (
          <StepSelectSpaces
            quotation={quotation}
            roomTypes={roomTypes}
            houseTypes={houseTypes}
            onAddRoom={handleAddRoom}
            onUpdateRoom={handleUpdateRoom}
            onDeleteRoom={handleDeleteRoom}
            onContinue={goToNextStep}
            onBack={goToPrevStep}
            isLoading={isSaving}
          />
        )}

        {currentStep.type === "built_in_module" && currentStep.moduleRef === "product_config" && quotation && (
          <StepProductConfig
            quotation={quotation}
            products={products}
            categories={categories}
            activeRoomId={activeRoomId}
            onSelectRoom={setActiveRoomId}
            onAddItem={handleAddItem}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
            onClearRoom={handleClearRoom}
            onRoomsUpdated={handleRoomsUpdated}
            onReplaceItem={handleReplaceItem}
            onUpdateRoom={handleUpdateRoom}
            onUpdateRoomNotes={handleUpdateRoomNotes}
            onContinue={goToNextStep}
            onBack={goToPrevStep}
          />
        )}

        {currentStep.type === "built_in_module" && currentStep.moduleRef === "pricing_review" && quotation && !hasAnyItems && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-400">
            <LoadingSpinner size="md" />
            <p className="text-sm font-medium">Add a product before reviewing — redirecting…</p>
          </div>
        )}

        {currentStep.type === "built_in_module" && currentStep.moduleRef === "pricing_review" && quotation && hasAnyItems && (
          <StepReview
            quotation={quotation}
            products={products}
            categories={categories}
            onAddItem={handleAddItem}
            onReplaceItem={handleReplaceItem}
            onMassUpdateRoomItems={handleMassUpdateRoomItems}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
            onUpdateDiscount={handleUpdateDiscount}
            onUpdateRoom={handleUpdateRoom}
            onContinue={goToNextStep}
            onBack={goToPrevStep}
          />
        )}

        {currentStep.type === "built_in_module" && currentStep.moduleRef === "proposal_preview" && quotation && !hasAnyItems && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-400">
            <LoadingSpinner size="md" />
            <p className="text-sm font-medium">Add a product before exporting — redirecting…</p>
          </div>
        )}

        {currentStep.type === "built_in_module" && currentStep.moduleRef === "proposal_preview" && quotation && hasAnyItems && (
          <StepProposalPreview
            quotation={quotation}
            company={company}
            onBackToEdit={goToPrevStep}
            activeTemplateOverride={engine.template}
          />
        )}
      </div>
    </div>
  );
}
