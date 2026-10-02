"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Product, ProductVariant } from "@/types";
import Modal from "@/components/shared/Modal";
import { Button, Input } from "@/components/ui";
import notify from "@/lib/notify";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { ApiClientError, apiJson, toErrorMessage } from "@/lib/apiClient";
import {
  suggestVariantCode,
  validateVariantCode,
  type UnsupportedVariant,
  type VariantMatrixRow,
  type VariantMatrixStatus,
  type VariantMatrixSummary,
} from "@/lib/productVariantService";
import {
  AlertCircle,
  Check,
  History,
  Loader2,
  Package,
  Plus,
  Save,
  Trash2,
  Wand2,
} from "lucide-react";

/**
 * "Edit Variants" — matrix driven.
 *
 * Every valid combination from the product's category matrix is always listed,
 * classified as:
 *
 *   ACTIVE     a live ProductVariant exists      -> edit Code/Price, Delete
 *   REMOVED    hard-deleted, kept in history     -> Restore (new numeric id)
 *   NOT ADDED  never added to this product       -> Add
 *
 * Missing variants are NEVER recreated automatically. The admin decides which
 * combination comes back, and may edit the prefilled Code/Price before
 * committing. Add and Restore take effect immediately for that one row; Save
 * Changes only persists Code/Price edits to variants that are already active.
 */

interface ProductVariantsEditModalProps {
  isOpen: boolean;
  product: Product | null;
  onClose: () => void;
  /** Called after a successful mutation with the refreshed variant list. */
  onVariantsChange: (updatedVariants: ProductVariant[]) => void;
}

interface MatrixResponse {
  productId: number;
  productName: string;
  productCode: string | null;
  categoryId: number | null;
  categoryName: string | null;
  hasMatrix: boolean;
  summary: VariantMatrixSummary;
  rows: VariantMatrixRow[];
  unsupportedVariants: UnsupportedVariant[];
}

interface EditRow {
  key: string;
  displayName: string;
  automationTier: string | null;
  surfaceFinish: string | null;
  tierLabel: string | null;
  finishLabel: string | null;
  status: VariantMatrixStatus;
  variantId: number | null;
  historyId: number | null;
  previousVariantId: number | null;
  variantCode: string;
  price: string;
  /** Values as loaded, used to detect real edits only. */
  originalCode: string;
  originalPrice: string;
  deletedAt: string | null;
  codeError: string | null;
  priceError: string | null;
}

type FilterKey = "all" | VariantMatrixStatus;

const STATUS_ORDER: Record<VariantMatrixStatus, number> = {
  active: 0,
  removed: 1,
  not_added: 2,
};

const STATUS_META: Record<
  VariantMatrixStatus,
  { label: string; chip: string; dot: string }
> = {
  active: {
    label: "Active",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  removed: {
    label: "Removed",
    chip: "bg-amber-50 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
  },
  not_added: {
    label: "Not Added",
    chip: "bg-neutral-100 text-neutral-600 border-neutral-200",
    dot: "bg-neutral-400",
  },
};

function normalisePrice(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const num = Number(trimmed);
  return Number.isFinite(num) ? String(num) : trimmed;
}

/**
 * The legacy `GET /api/products/[id]/variants` endpoint returns raw documents,
 * so a Decimal128 price arrives as `{ $numberDecimal: "..." }` and the id as
 * `_id`. The declared `ProductVariant` type promises `id: number` and
 * `price: string`, so the list handed back to the parent page is normalised
 * here. The endpoint response itself is intentionally left unchanged.
 */
function normaliseVariantList(payload: unknown): ProductVariant[] {
  if (!Array.isArray(payload)) return [];

  return payload.map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const price = record.price as
      | string
      | number
      | { $numberDecimal?: string }
      | null
      | undefined;

    let priceText = "";
    if (typeof price === "string" || typeof price === "number") {
      priceText = String(price);
    } else if (price && typeof price === "object" && typeof price.$numberDecimal === "string") {
      priceText = price.$numberDecimal;
    }

    return {
      id: Number(record.id ?? record._id ?? index),
      productId: Number(record.productId ?? 0),
      variantCode: (record.variantCode as string | null) ?? null,
      name: (record.name as string | null) ?? null,
      code: (record.code as string | null) ?? null,
      automationTier: (record.automationTier as string | null) ?? null,
      surfaceFinish: (record.surfaceFinish as string | null) ?? null,
      config: (record.config as Record<string, string>) ?? {},
      price: normalisePrice(priceText),
      isActive: record.isActive !== false,
      sortOrder: Number(record.sortOrder ?? index),
    };
  });
}

export default function ProductVariantsEditModal({
  isOpen,
  product,
  onClose,
  onVariantsChange,
}: ProductVariantsEditModalProps) {
  const confirm = useConfirm();

  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  const productId = product?.id ?? null;

  const toEditRow = useCallback((row: VariantMatrixRow): EditRow => {
    const isActive = row.status === "active";
    const code = isActive
      ? row.variant?.variantCode || row.variant?.code || ""
      : row.history?.variantCode || "";
    const price = isActive ? row.variant?.price || "" : row.history?.price || "";

    return {
      key: row.key,
      displayName: row.displayName,
      automationTier: row.automationTier,
      surfaceFinish: row.surfaceFinish,
      tierLabel: row.tierLabel,
      finishLabel: row.finishLabel,
      status: row.status,
      variantId: row.variant?.id ?? null,
      historyId: row.history?.historyId ?? null,
      previousVariantId: row.history?.previousVariantId ?? null,
      variantCode: code,
      price,
      originalCode: code,
      originalPrice: price,
      deletedAt: row.history?.deletedAt ?? null,
      codeError: null,
      priceError: null,
    };
  }, []);

  /** Loads the authoritative matrix and re-syncs the parent's variant list. */
  const loadMatrix = useCallback(
    async (options?: { syncParent?: boolean }) => {
      if (!productId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await apiJson.get<MatrixResponse>(
          `/api/products/${productId}/variants/matrix`
        );
        setMatrix(data);
        setRows(
          [...data.rows]
            .sort((a, b) => {
              const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
              return byStatus !== 0 ? byStatus : 0;
            })
            .map(toEditRow)
        );

        if (options?.syncParent) {
          const freshVariants = await apiJson.get<unknown>(
            `/api/products/${productId}/variants`
          );
          onVariantsChange(normaliseVariantList(freshVariants));
        }
      } catch (err: unknown) {
        setError(toErrorMessage(err, "Failed to load the variant matrix."));
      } finally {
        setLoading(false);
      }
    },
    [productId, onVariantsChange, toEditRow]
  );

  useEffect(() => {
    if (isOpen && productId) {
      setFilter("all");
      void loadMatrix({ syncParent: false });
    } else if (!isOpen) {
      setMatrix(null);
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, productId]);

  // ─── Derived state ──────────────────────────────────────────────────────────

  const activeCount = useMemo(
    () => rows.filter((row) => row.status === "active").length,
    [rows]
  );

  /** A product must always keep at least one active variant. */
  const canDeleteActive = activeCount > 1;

  const dirtyActiveRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.status === "active" &&
          row.variantId !== null &&
          (row.variantCode.trim() !== row.originalCode.trim() ||
            normalisePrice(row.price) !== normalisePrice(row.originalPrice))
      ),
    [rows]
  );

  const visibleRows = useMemo(
    () => (filter === "all" ? rows : rows.filter((row) => row.status === filter)),
    [rows, filter]
  );

  const summary = matrix?.summary;

  // ─── Field helpers ──────────────────────────────────────────────────────────

  const setField = (key: string, patch: Partial<EditRow>) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const handleCodeChange = (key: string, value: string) =>
    setField(key, { variantCode: value, codeError: null });

  const handlePriceChange = (key: string, value: string) => {
    const isInvalid =
      value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0;
    setField(key, { price: value, priceError: isInvalid ? "Enter a valid price" : null });
  };

  /** Codes already used by ACTIVE rows, so pending Add/Restore can catch clashes. */
  const activeCodes = useMemo(
    () =>
      rows
        .filter((row) => row.status === "active")
        .map((row) => row.variantCode.trim().toUpperCase())
        .filter(Boolean),
    [rows]
  );

  const handleSuggest = (key: string) => {
    const row = rows.find((item) => item.key === key);
    if (!row) return;
    const suggestion = suggestVariantCode({
      productCode: matrix?.productCode ?? "",
      automationTier: row.automationTier,
      surfaceFinish: row.surfaceFinish,
      existingCodes: activeCodes,
    });
    setField(key, { variantCode: suggestion, codeError: null });
  };

  /** Client-side gate shared by Add and Restore; the server re-validates. */
  const validateForCommit = (row: EditRow): { ok: true } | { ok: false; message: string } => {
    const code = validateVariantCode(row.variantCode);
    if (!code.valid) return { ok: false, message: code.message };

    const price = Number(row.price);
    if (row.price.trim() === "" || !Number.isFinite(price) || price < 0) {
      return { ok: false, message: "Enter a valid, non-negative price in INR." };
    }

    const clash = activeCodes.includes(code.value.toUpperCase());
    if (clash) {
      return {
        ok: false,
        message: `Variant code '${code.value}' is already used by another variant of this product.`,
      };
    }

    return { ok: true };
  };

  const runRowAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setBusyKey(key);
      setError(null);
      try {
        await action();
        await loadMatrix({ syncParent: true });
      } finally {
        setBusyKey(null);
      }
    },
    [loadMatrix]
  );

  // ─── Add ────────────────────────────────────────────────────────────────────

  const handleAdd = (row: EditRow) => {
    const validation = validateForCommit(row);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    void runRowAction(row.key, async () => {
      try {
        const data = await apiJson.post<{ message: string; variant: ProductVariant }>(
          `/api/products/${productId}/variants`,
          {
            automationTier: row.automationTier,
            surfaceFinish: row.surfaceFinish,
            variantCode: row.variantCode.trim(),
            price: Number(row.price),
          }
        );
        notify.success("Variant added", data.message ?? `"${row.displayName}" added.`);
      } catch (err: unknown) {
        const message = toErrorMessage(err, "Unable to add this variant.");
        setError(message);
        notify.error("Add failed", message);
      }
    });
  };

  // ─── Restore ────────────────────────────────────────────────────────────────

  const handleRestore = (row: EditRow) => {
    if (row.historyId === null) {
      setError("This removed variant has no history record and cannot be restored.");
      return;
    }

    const validation = validateForCommit(row);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    const label = row.displayName;

    void confirm({
      title: "Restore Variant?",
      message: `Restore "${label}" to this product?`,
      detail:
        "A new variant record is created with a fresh id. Its code and price are the ones shown here, not the historical values.",
      confirmText: "Restore Variant",
      cancelText: "Cancel",
      variant: "primary",
      onConfirm: async () => {
        await runRowAction(row.key, async () => {
          try {
            const data = await apiJson.post<{ message: string; variant: ProductVariant }>(
              `/api/products/${productId}/variants/restore`,
              {
                historyId: row.historyId,
                variantCode: row.variantCode.trim(),
                price: Number(row.price),
              }
            );
            notify.success("Variant restored", data.message ?? `"${label}" restored.`);
          } catch (err: unknown) {
            const message = toErrorMessage(err, "Unable to restore this variant.");
            setError(message);
            notify.error("Restore failed", message);
          }
        });
      },
    });
  };

  // ─── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = (row: EditRow) => {
    if (row.variantId === null) return;
    if (!canDeleteActive) {
      setError(
        "This is the only active variant left. A product must always keep at least one variant."
      );
      return;
    }

    const variantId = row.variantId;
    const label = row.displayName;

    void confirm({
      title: "Delete Variant?",
      message: `Are you sure you want to delete "${label}"?`,
      detail:
        "This permanently removes the variant from this product. It becomes a REMOVED combination you can restore later, as long as it stays in the category matrix.",
      confirmText: "Delete Variant",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: async () => {
        await runRowAction(row.key, async () => {
          try {
            await apiJson.delete(`/api/products/${productId}/variants/${variantId}`);
            notify.success("Variant deleted", `Variant "${label}" deleted successfully.`);
          } catch (err: unknown) {
            if (err instanceof ApiClientError && err.code === "NOT_FOUND") {
              notify.error("Variant not found", "This variant is no longer available.");
              return;
            }
            const message = toErrorMessage(err, "Unable to delete this variant.");
            setError(message);
            notify.error(
              err instanceof ApiClientError && err.code === "MINIMUM_VARIANT"
                ? "Cannot delete variant"
                : "Delete failed",
              message
            );
          }
        });
      },
    });
  };

  // ─── Save code / price edits on already-active variants ─────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (dirtyActiveRows.length === 0) return;

    for (const row of dirtyActiveRows) {
      if (row.price.trim() === "" || !Number.isFinite(Number(row.price)) || Number(row.price) < 0) {
        setError("Please ensure every edited variant has a valid, non-negative price in INR.");
        setField(row.key, { priceError: "Enter a valid price" });
        return;
      }
    }

    const payloadRows = dirtyActiveRows.map((row) => ({
      id: row.variantId as number,
      variantCode: row.variantCode.trim(),
      price: Number(row.price),
    }));

    // Pre-flight duplicate detection against the final set of active codes.
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.status !== "active") continue;
      const code = row.variantCode.trim().toUpperCase();
      if (!code) continue;
      if (seen.has(code)) {
        setError(`Variant code '${row.variantCode.trim()}' is used more than once.`);
        return;
      }
      seen.add(code);
    }

    setSaving(true);
    try {
      const data = await apiJson.patch<{ message: string; variants: unknown }>(
        `/api/products/${productId}/variants`,
        { variants: payloadRows }
      );
      notify.success(
        "Variants updated",
        data.message ?? `Updated ${payloadRows.length} variant(s) for "${matrix?.productName}".`
      );
      onVariantsChange(normaliseVariantList(data.variants));
      await loadMatrix({ syncParent: false });
    } catch (err: unknown) {
      const message = toErrorMessage(err, "Failed to save variants");
      setError(message);
      notify.error("Update failed", message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (!product) return null;

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: "All", count: rows.length },
    { key: "active", label: "Active", count: summary?.active ?? 0 },
    { key: "removed", label: "Removed", count: summary?.removed ?? 0 },
    { key: "not_added", label: "Not Added", count: summary?.notAdded ?? 0 },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Variants" size="xl">
      <form onSubmit={handleSave} className="space-y-4">
        {/* ── Product context banner ── */}
        <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 shrink-0 rounded-lg border border-neutral-200 bg-white overflow-hidden flex items-center justify-center shadow-2xs p-0.5">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-full w-full object-contain"
                  onError={(e) => ((e.target as HTMLElement).style.display = "none")}
                />
              ) : (
                <Package className="h-5 w-5 text-neutral-300" />
              )}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 block">
                Parent Product #{product.id}
              </span>
              <h4 className="text-sm font-bold text-neutral-900 truncate">{product.name}</h4>
              <p className="text-xs text-neutral-500 mt-0.5">
                Category:{" "}
                <strong className="font-semibold text-neutral-700">
                  {matrix?.categoryName ?? "—"}
                </strong>
                {matrix?.summary.total ? (
                  <>
                    {" · "}
                    {matrix.summary.total} possible{" "}
                    {matrix.summary.total === 1 ? "combination" : "combinations"}
                  </>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                activeCount > 0
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}
            >
              {activeCount} Active
            </span>
            <span className="text-[10px] text-neutral-400">
              Matrix is the source of truth
            </span>
          </div>
        </div>

        {/* ── Global error banner ── */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Status filter ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((item) => {
            const meta = item.key === "all" ? null : STATUS_META[item.key];
            const isActive = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  isActive
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                }`}
              >
                {meta && <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
                {item.label}
                <span className={isActive ? "text-neutral-300" : "text-neutral-400"}>
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Loading ── */}
        {loading && rows.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading possible variants…</span>
          </div>
        ) : matrix && !matrix.hasMatrix ? (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">This category has no configured variant matrix.</p>
              <p className="text-[11px] text-amber-700/90 mt-0.5">
                No combinations can be added or restored until an administrator configures
                automation tiers or surface finishes for this category.
              </p>
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="py-12 text-center text-xs text-neutral-400 italic">
            {filter === "all"
              ? "No possible variants for this category."
              : `No ${filters.find((f) => f.key === filter)?.label.toLowerCase()} combinations.`}
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-2xs">
            <div className="max-h-[440px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-neutral-900 text-white uppercase text-[10px] font-semibold tracking-wider z-10">
                  <tr className="border-b border-neutral-800">
                    <th className="py-3 px-3.5">STATUS</th>
                    <th className="py-3 px-3.5">VARIANT</th>
                    <th className="py-3 px-3.5 w-[190px]">VARIANT CODE / SKU</th>
                    <th className="py-3 px-3.5 w-[150px] text-right">PRICE (₹ INR)</th>
                    <th className="py-3 px-3.5 w-[130px] text-center">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 text-neutral-700">
                  {visibleRows.map((row) => {
                    const meta = STATUS_META[row.status];
                    const isActive = row.status === "active";
                    const isBusy = busyKey === row.key;
                    const isEdited =
                      isActive &&
                      (row.variantCode.trim() !== row.originalCode.trim() ||
                        normalisePrice(row.price) !== normalisePrice(row.originalPrice));

                    return (
                      <tr
                        key={row.key}
                        className={`align-top transition-colors ${
                          isActive
                            ? "bg-white hover:bg-neutral-50/40"
                            : row.status === "removed"
                              ? "bg-amber-50/30 hover:bg-amber-50/60"
                              : "bg-neutral-50/50 hover:bg-neutral-100/50"
                        }`}
                      >
                        {/* 1. STATUS */}
                        <td className="py-2.5 px-3.5">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${meta.chip}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </span>
                          {row.status === "removed" && row.deletedAt && (
                            <p className="mt-1 text-[10px] text-amber-700/80 flex items-center gap-1">
                              <History className="h-3 w-3" />
                              {new Date(row.deletedAt).toLocaleDateString()}
                            </p>
                          )}
                        </td>

                        {/* 2. VARIANT — read-only, from the category matrix */}
                        <td className="py-2.5 px-3.5">
                          <span className="font-semibold text-neutral-900 block">
                            {row.displayName}
                          </span>
                          <span className="text-[10px] text-neutral-400">
                            {row.tierLabel ?? row.automationTier ?? "—"}
                            {row.tierLabel || row.automationTier ? " · " : ""}
                            {row.finishLabel ?? row.surfaceFinish ?? ""}
                          </span>
                          {row.status === "active" && row.variantId !== null && (
                            <span className="ml-1.5 text-[10px] text-neutral-400">
                              #{row.variantId}
                            </span>
                          )}
                        </td>

                        {/* 3. VARIANT CODE — prefilled from history for REMOVED */}
                        <td className="py-2 px-3.5">
                          <div className="flex items-center gap-1">
                            <Input
                              type="text"
                              value={row.variantCode}
                              onChange={(e) => handleCodeChange(row.key, e.target.value)}
                              placeholder={isActive ? "e.g. TAC-004-RE-A" : "Enter a code"}
                              disabled={busyKey !== null}
                              className={`h-8 font-mono text-xs uppercase ${
                                row.codeError ? "border-red-400" : ""
                              }`}
                            />
                            {!isActive && (
                              <button
                                type="button"
                                onClick={() => handleSuggest(row.key)}
                                disabled={busyKey !== null}
                                title="Suggest a code from the product code and combination"
                                className="shrink-0 rounded border border-neutral-200 bg-white p-1.5 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40"
                              >
                                <Wand2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {row.codeError && (
                            <p className="text-[10px] text-red-600 mt-0.5">{row.codeError}</p>
                          )}
                          {row.status === "removed" && !row.codeError && (
                            <p className="text-[10px] text-amber-700/80 mt-0.5">
                              Prefilled from history
                            </p>
                          )}
                        </td>

                        {/* 4. PRICE — prefilled from history for REMOVED */}
                        <td className="py-2 px-3.5 text-right">
                          <div className="relative inline-block w-full max-w-[140px]">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 font-medium text-xs select-none">
                              ₹
                            </span>
                            <Input
                              type="number"
                              step="1"
                              min="0"
                              value={row.price}
                              onChange={(e) => handlePriceChange(row.key, e.target.value)}
                              placeholder="0"
                              disabled={busyKey !== null}
                              className={`h-8 pl-6 text-right font-semibold text-xs ${
                                row.priceError ? "border-red-500" : ""
                              }`}
                            />
                          </div>
                        </td>

                        {/* 5. ACTION */}
                        <td className="py-2 px-3.5 text-center">
                          {isBusy ? (
                            <Loader2 className="h-4 w-4 mx-auto animate-spin text-neutral-400" />
                          ) : isActive ? (
                            <div className="flex items-center justify-center gap-1">
                              {isEdited && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                                  title="Changed — press Save Changes to apply"
                                >
                                  <Check className="h-3 w-3" />
                                  Edited
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDelete(row)}
                                disabled={busyKey !== null || saving || !canDeleteActive}
                                title={
                                  canDeleteActive
                                    ? `Delete ${row.displayName}`
                                    : "A product must always keep at least one active variant"
                                }
                                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : row.status === "removed" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestore(row)}
                              disabled={busyKey !== null || saving}
                              className="h-7 px-2.5 text-[11px] gap-1"
                            >
                              <History className="h-3.5 w-3.5" />
                              Restore
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              onClick={() => handleAdd(row)}
                              disabled={busyKey !== null || saving}
                              className="h-7 px-2.5 text-[11px] gap-1"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Legacy variants outside the matrix ── */}
        {matrix && matrix.unsupportedVariants.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-[11px] font-semibold text-amber-900">
              {matrix.unsupportedVariants.length} existing variant
              {matrix.unsupportedVariants.length === 1 ? "" : "s"} not in the current category
              matrix
            </p>
            <p className="text-[10px] text-amber-800/80 mt-0.5">
              These are left untouched. They can still be deleted, but not edited or restored
              here.
            </p>
            <div className="mt-2 space-y-1">
              {matrix.unsupportedVariants.map((variant) => (
                <div
                  key={variant.id}
                  className="flex items-center justify-between gap-2 text-[11px] text-amber-900"
                >
                  <span className="truncate">
                    {variant.displayName}
                    {variant.variantCode ? ` · ${variant.variantCode}` : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void confirm({
                        title: "Delete Variant?",
                        message: `Delete "${variant.displayName}"?`,
                        detail:
                          "This variant is not part of the category matrix. It will be permanently removed.",
                        confirmText: "Delete Variant",
                        cancelText: "Cancel",
                        variant: "danger",
                        onConfirm: async () => {
                          try {
                            await apiJson.delete(
                              `/api/products/${productId}/variants/${variant.id}`
                            );
                            notify.success(
                              "Variant deleted",
                              `Variant "${variant.displayName}" deleted successfully.`
                            );
                            await loadMatrix({ syncParent: true });
                          } catch (err: unknown) {
                            const message = toErrorMessage(
                              err,
                              "Unable to delete this variant."
                            );
                            setError(message);
                            notify.error("Delete failed", message);
                          }
                        },
                      })
                    }
                    disabled={busyKey !== null || saving || !canDeleteActive}
                    className="h-6 px-2 text-[10px] text-red-600 hover:bg-red-50 gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex items-center justify-between pt-3 border-t border-neutral-100 gap-3">
          <p className="text-[11px] text-neutral-400 leading-snug">
            Add and Restore apply immediately to that one variant and create a new variant with a
            fresh id. Save Changes only writes Code &amp; Price edits to variants that are
            already active.
            {!canDeleteActive && activeCount === 1 && (
              <span className="block text-amber-600">
                This is the last active variant, so it cannot be deleted.
              </span>
            )}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={saving || busyKey !== null}
            >
              Close
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || busyKey !== null || dirtyActiveRows.length === 0}
              className="gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {saving
                ? "Saving..."
                : dirtyActiveRows.length > 0
                  ? `Save Changes (${dirtyActiveRows.length})`
                  : "Save Changes"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
