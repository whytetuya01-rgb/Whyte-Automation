"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, Check, Clock, Home, Save } from "lucide-react";
import {
  Quotation,
  Product,
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
  initialProducts?: Product[];
  initialCategories?: Category[];
  initialRoomTypes?: RoomType[];
  initialCompany?: Company | null;
  initialStep?: ProposalStep;
}

export default function ProposalBuilder({
  initialQuotation = null,
  initialHouseTypes = [],
  initialProducts = [],
  initialCategories = [],
  initialRoomTypes = [],
  initialCompany = null,
  initialStep = 1,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Resolve step from URL query or initialStep
  const stepParam = searchParams.get("step");
  const parsedStep = stepParam ? (parseInt(stepParam, 10) as ProposalStep) : initialStep;
  const [currentStep, setCurrentStep] = useState<ProposalStep>(
    parsedStep >= 1 && parsedStep <= 5 ? parsedStep : 1
  );

  // Core Data States
  const [quotation, setQuotation] = useState<Quotation | null>(
    initialQuotation ? normalizeQuotation(initialQuotation) : null
  );
  const [houseTypes, setHouseTypes] = useState<HouseType[]>(normalizeHouseTypes(initialHouseTypes));
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [categories, setCategories] = useState<Category[]>(normalizeCategories(initialCategories));
  const [roomTypes, setRoomTypes] = useState<RoomType[]>(normalizeRoomTypes(initialRoomTypes));
  const [company, setCompany] = useState<Company | null>(initialCompany);

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

  // Loading & Saving States
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");

  const quotationId = quotation?.id;

  // Browser Back/Forward navigation synchronization
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("step");
      if (s) {
        const p = parseInt(s, 10) as ProposalStep;
        if (p >= 1 && p <= 5) setCurrentStep(p);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Keep URL updated with current step
  const navigateToStep = useCallback(
    (step: ProposalStep) => {
      setCurrentStep(step);
      if (quotationId) {
        window.history.pushState(null, "", `/quotation/${quotationId}?step=${step}`);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [quotationId]
  );

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
    const item = normalizeQuotationItem(rawItem);
    const targetRoomId = Number(item.quotationRoomId);
    setQuotation((prev) => {
      if (!prev) return prev;
      let replaced = false;
      const rooms = (prev.rooms || []).map((room) => {
        const items = room.items || [];
        const idx = items.findIndex((it) => Number(it.id ?? (it as any)._id) === Number(item.id));
        if (idx === -1) return room;
        replaced = true;
        const nextItems = [...items];
        nextItems[idx] = item;
        return { ...room, items: nextItems };
      });
      if (replaced) return { ...prev, rooms };
      // Not found anywhere: a new item, appended to its target room.
      const withAppended = rooms.map((room) => {
        const roomId = Number(room.id ?? (room as any)._id);
        if (roomId !== targetRoomId) return room;
        return { ...room, items: [...(room.items || []), item] };
      });
      return { ...prev, rooms: withAppended };
    });
  }, []);

  const removeItemLocally = useCallback((itemId: number) => {
    setQuotation((prev) => {
      if (!prev) return prev;
      const rooms = (prev.rooms || []).map((room) => ({
        ...room,
        items: (room.items || []).filter((it) => Number(it.id ?? (it as any)._id) !== Number(itemId)),
      }));
      return { ...prev, rooms };
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

    // 2. Heavy product catalog (products ~388KB + categories) - defer until Step 2+ or when Step 3 is needed
    if (currentStep >= 2 || parsedStep >= 2) {
      if (products.length === 0 && !fetchStatusRef.current.products) {
        fetchStatusRef.current.products = true;
        fetch("/api/products")
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
          .catch(() => setProducts([]));
      }

      if (categories.length === 0 && !fetchStatusRef.current.categories) {
        fetchStatusRef.current.categories = true;
        fetch("/api/categories")
          .then((r) => (r.ok ? r.json() : []))
          .then((data) => setCategories(normalizeCategories(Array.isArray(data) ? data : [])))
          .catch(() => setCategories([]));
      }
    }

    // 3. Company details - load for Step 4+ (Review and PDF preview)
    if (currentStep >= 3) {
      if (!company && !fetchStatusRef.current.company) {
        fetchStatusRef.current.company = true;
        fetch("/api/company")
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => setCompany(data && typeof data === "object" && !data.error ? data : null))
          .catch(() => setCompany(null));
      }
    }
  }, [currentStep, parsedStep, houseTypes.length, roomTypes.length, products.length, categories.length, company]);

  // Step 1: Save & Continue Handler
  const handleSaveProjectDetails = async (formData: ProjectFormData) => {
    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const notesWithProject = formData.projectName.trim()
        ? `Project: ${formData.projectName.trim()}${formData.notes.trim() ? `\n${formData.notes.trim()}` : ""}`
        : formData.notes.trim() || null;

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
            notes: notesWithProject,
            ...(formData.dealerId ? { dealerId: formData.dealerId } : {}),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(extractErrorMessage(err, "Failed to create quotation"));
        }

        const resJson = await res.json();
        const newQuote = resJson?.data ?? resJson;
        toast.success("Project initialized!");

        // Fetch full populated record and move to Step 2
        const fullRes = await fetch(`/api/quotations/${newQuote.id || newQuote._id}`);
        const fullJson = fullRes.ok ? await fullRes.json() : newQuote;
        const fullQuote = fullJson?.data ?? fullJson;
        const normalized = normalizeQuotation(fullQuote);

        setQuotation(normalized);
        if (normalized.rooms?.length > 0) {
          setActiveRoomId(normalized.rooms[0].id);
        }
        setSaveStatus("saved");
        router.replace(`/quotation/${normalized.id}?step=2`);
        setCurrentStep(2);
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
            notes: notesWithProject,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(extractErrorMessage(err, "Failed to update project details"));
        }

        let resJson = await res.json();

        // Reassignment is a separate, admin-only, audited endpoint. The server
        // ignores it for any other role, so this only runs when the owner changed.
        const previousDealerId = quotation.dealerId ?? null;
        if (formData.dealerId !== previousDealerId && formData.dealerId !== undefined) {
          const assignRes = await fetch(`/api/quotations/${quotation.id}/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dealerId: formData.dealerId }),
          });
          if (!assignRes.ok) {
            const err = await assignRes.json().catch(() => ({}));
            throw new Error(extractErrorMessage(err, "Failed to update the assigned dealer"));
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
        navigateToStep(2);
      }
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to save project details"));
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
    }
  };

  const handleDeleteRoom = async (roomId: number) => {
    if (!quotation?.id) return;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/quotations/${quotation.id}/rooms/${roomId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to remove room"));
      }

      if (activeRoomId === roomId) {
        const remaining = (quotation.rooms || []).filter((r) => (r.id ?? (r as any)._id) !== roomId);
        setActiveRoomId(remaining[0]?.id ?? (remaining[0] as any)?._id ?? null);
      }

      removeRoomLocally(roomId);
      setSaveStatus("saved");
      toast.success("Space removed");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to remove room"));
      setSaveStatus("unsaved");
    }
  };

  // Step 3: Item Operations
  const handleAddItem = async (
    roomId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>
  ) => {
    if (!quotation?.id) return;
    const targetRoomId = Number(roomId || activeRoomId || quotation.rooms?.[0]?.id);
    if (!targetRoomId) {
      toast.error("Please select a space before adding devices");
      return;
    }
    setSaveStatus("saving");

    try {
      const res = await fetch(`/api/quotations/${quotation.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotationRoomId: targetRoomId,
          productId,
          productVariantId: productVariantId ?? undefined,
          variantConfig: variantConfig ?? undefined,
          quantity: 1,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(extractErrorMessage(err, "Failed to add product"));
      }

      const body = await res.json();
      upsertItemLocally(body?.data ?? body);
      setSaveStatus("saved");
      toast.success("Device added to space");
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to add device"));
      setSaveStatus("unsaved");
    }
  };

  const handleUpdateItem = async (itemId: number, data: any) => {
    if (!quotation?.id) return;
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
    } catch (e: any) {
      toast.error(extractErrorMessage(e, "Failed to update item"));
      setSaveStatus("unsaved");
    }
  };

  const handleReplaceItem = async (
    itemId: number,
    productId: number,
    productVariantId?: number,
    variantConfig?: Record<string, string>,
    unitPrice?: number,
    variantLabel?: string
  ) => {
    if (!quotation?.id) return;
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
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!quotation?.id) return;
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

  const handleUpdateRoomNotes = async (roomId: number, notes: string) => {
    if (!quotation?.id) return;
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

  // A quotation only has a real product once some room item carries a positive quantity.
  const hasAnyItems = useMemo(
    () =>
      (quotation?.rooms ?? []).some((r) =>
        (r.items ?? []).some((i) => (Number(i.quantity) || 0) > 0)
      ),
    [quotation]
  );

  // Determine which steps are completed
  const completedSteps = useMemo(() => {
    const list: ProposalStep[] = [];
    if (quotation?.clientName) list.push(1);
    if ((quotation?.rooms?.length ?? 0) > 0) list.push(2);
    if (hasAnyItems) list.push(3);
    if (hasAnyItems) list.push(4);
    return list;
  }, [quotation, hasAnyItems]);

  const canNavigateToStep = (step: ProposalStep) => {
    if (step === 1) return true;
    if (step === 2) return Boolean(quotation?.id);
    if (step === 3) return Boolean(quotation?.id && (quotation?.rooms?.length ?? 0) > 0);
    // Review & Proposal require at least one product added somewhere in the quotation.
    if (step >= 4) return Boolean(quotation?.id && hasAnyItems);
    return false;
  };

  // Guard against landing on Review/Proposal with no products via a direct URL,
  // a stale bookmark, or browser back/forward — snap back to the furthest valid step.
  useEffect(() => {
    if (!quotation) return;
    if (canNavigateToStep(currentStep)) return;
    const hasRooms = (quotation.rooms?.length ?? 0) > 0;
    const fallback: ProposalStep = currentStep >= 4 && hasRooms ? 3 : hasRooms ? 2 : 1;
    navigateToStep(fallback);
    if (currentStep >= 4 && !hasAnyItems) {
      toast.error("Add at least one product before continuing to Review.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotation?.id, currentStep, hasAnyItems]);

  return (
    <div className="space-y-6 pb-20">
      {/* Top Header / Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition shrink-0"
            title="Exit proposal builder"
          >
            <ArrowLeft size={16} />
          </Link>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-gray-950 text-sm">
                {quotation?.quotationNumber ?? "New Proposal"}
              </span>
              {quotation?.status && (
                <StatusBadge status={quotation.status as QuotationStatus} />
              )}
            </div>
            <p className="text-xs text-gray-500 truncate font-medium">
              {quotation?.clientName ? quotation.clientName : "WHYTE Smart Automation Proposal Builder"}
            </p>
          </div>
        </div>

        {/* Auto-save Status & Actions */}
        <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
          {quotation?.id && (
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
          )}

          <Link
            href="/"
            className="px-3.5 py-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
          >
            Save & Exit
          </Link>
        </div>
      </div>

      {/* Step Indicator Progress Bar */}
      <StepIndicator
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={navigateToStep}
        canNavigateToStep={canNavigateToStep}
      />

      {quotation && <QuotationOwnership quotation={quotation} />}

      {/* Dynamic Step View Rendering */}
      <div>
        {currentStep === 1 && (
          <StepProjectDetails
            initialData={quotation ?? undefined}
            houseTypes={houseTypes}
            onSaveAndContinue={handleSaveProjectDetails}
            isSaving={isSaving}
          />
        )}

        {currentStep === 2 && quotation && (
          <StepSelectSpaces
            quotation={quotation}
            roomTypes={roomTypes}
            houseTypes={houseTypes}
            onAddRoom={handleAddRoom}
            onUpdateRoom={handleUpdateRoom}
            onDeleteRoom={handleDeleteRoom}
            onContinue={() => navigateToStep(3)}
            onBack={() => navigateToStep(1)}
            isLoading={isSaving}
          />
        )}

        {currentStep === 3 && quotation && (
          <StepProductConfig
            quotation={quotation}
            products={products}
            categories={categories}
            activeRoomId={activeRoomId}
            onSelectRoom={setActiveRoomId}
            onAddItem={handleAddItem}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
            onUpdateRoom={handleUpdateRoom}
            onUpdateRoomNotes={handleUpdateRoomNotes}
            onContinue={() => navigateToStep(4)}
            onBack={() => navigateToStep(2)}
          />
        )}

        {currentStep === 4 && quotation && !hasAnyItems && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-400">
            <LoadingSpinner size="md" />
            <p className="text-sm font-medium">Add a product before reviewing — redirecting…</p>
          </div>
        )}

        {currentStep === 4 && quotation && hasAnyItems && (
          <StepReview
            quotation={quotation}
            products={products}
            categories={categories}
            onAddItem={handleAddItem}
            onReplaceItem={handleReplaceItem}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
            onUpdateDiscount={handleUpdateDiscount}
            onContinue={() => navigateToStep(5)}
            onBack={() => navigateToStep(3)}
          />
        )}

        {currentStep === 5 && quotation && !hasAnyItems && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-400">
            <LoadingSpinner size="md" />
            <p className="text-sm font-medium">Add a product before exporting — redirecting…</p>
          </div>
        )}

        {currentStep === 5 && quotation && hasAnyItems && (
          <StepProposalPreview
            quotation={quotation}
            company={company}
            onBackToEdit={() => navigateToStep(4)}
          />
        )}
      </div>
    </div>
  );
}
