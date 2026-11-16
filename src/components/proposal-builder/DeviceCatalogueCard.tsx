"use client";

import React, { memo } from "react";
import {
  Package,
  Check,
  Layers,
  ChevronDown,
  Plus,
  Minus,
  Loader2,
} from "lucide-react";
import {
  EditorCatalogProduct,
  EditorCatalogVariant,
  QuotationRoom,
} from "@/types";
import { formatCurrency } from "@/lib/utils";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";
import {
  FilteredProductResult,
  getVariantTier,
  getVariantFinish,
} from "@/lib/productFiltering";
import { parseQuantityInput } from "@/lib/quantity";
import { getRoomDisplayName } from "@/lib/roomUtils";

const DEFAULT_NEW_ENTRY_QUANTITY = "1";

// Helper to extract clean display name for a variant
function getVariantName(v: EditorCatalogVariant): string {
  const tier = formatTierLabel(v.automationTier);
  const finish = formatFinishLabel(v.surfaceFinish);
  const parts: string[] = [];
  if (tier) parts.push(tier);
  if (finish) parts.push(finish);
  if (parts.length === 0 && v.config && Object.keys(v.config).length > 0) {
    for (const [, val] of Object.entries(v.config)) {
      if (val) parts.push(String(val));
    }
  }
  return parts.length > 0 ? parts.join(" · ") : (v.name || "Standard");
}

export interface DeviceCatalogueCardProps {
  catItem: FilteredProductResult;
  currentRoom: QuotationRoom | null;
  allRooms: QuotationRoom[];
  isLocked: boolean;
  selectedTier: string;
  selectedFinish: string;
  categoryConfig: {
    configuredTiers: Array<{ value: string; label: string }>;
    configuredFinishes: Array<{ value: string; label: string }>;
  };
  isCardExpanded: boolean;
  onToggleExpand: (productId: number) => void;
  cardKey: string;
  draftValue: string;
  cardError?: string;
  isAdding: boolean;
  onDraftChange: (cardKey: string, value: string) => void;
  onClearQtyError: (cardKey: string) => void;
  onAddTypedQuantity: (catItem: FilteredProductResult) => void;
  onAddProduct: (catItem: FilteredProductResult) => void;
  onRemoveProductInstance: (catItem: FilteredProductResult) => void;
  onAddVariant: (prod: EditorCatalogProduct, v: EditorCatalogVariant) => void;
}

export const DeviceCatalogueCard = memo(function DeviceCatalogueCard({
  catItem,
  currentRoom,
  allRooms,
  isLocked,
  selectedTier,
  selectedFinish,
  categoryConfig,
  isCardExpanded,
  onToggleExpand,
  cardKey,
  draftValue,
  cardError,
  isAdding,
  onDraftChange,
  onClearQtyError,
  onAddTypedQuantity,
  onAddProduct,
  onRemoveProductInstance,
  onAddVariant,
}: DeviceCatalogueCardProps) {
  const { product: prod, eligibleVariants, minPrice, exactVariant } = catItem;
  const prodId = Number(prod.id ?? (prod as any)._id);
  const exactVarId = exactVariant ? Number(exactVariant.id ?? (exactVariant as any)._id) : null;
  const roomItems = currentRoom ? (currentRoom.items || []) : [];

  const productTotalInRoom = roomItems
    .filter((i) => {
      const pId = Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id);
      return pId === prodId;
    })
    .reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);

  const inRoomCount = roomItems
    .filter((i) => {
      const pId = Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id);
      if (pId !== prodId) return false;
      if (exactVarId !== null) {
        const pvId = Number(i.productVariantId ?? (i as any).productVariant?.id ?? (i as any).productVariant?._id);
        return pvId === exactVarId;
      }
      if (eligibleVariants.length > 0) {
        const pvId = Number(i.productVariantId ?? (i as any).productVariant?.id ?? (i as any).productVariant?._id);
        return eligibleVariants.some((v) => Number(v.id ?? (v as any)._id) === pvId);
      }
      return true;
    })
    .reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);

  const otherVariantsInRoom = productTotalInRoom - inRoomCount;

  const entriesInRoom = roomItems.filter((i) => {
    const pId = Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id);
    if (pId !== prodId) return false;
    if (exactVarId !== null) {
      const pvId = Number(i.productVariantId ?? (i as any).productVariant?.id ?? (i as any).productVariant?._id);
      return pvId === exactVarId;
    }
    if (eligibleVariants.length > 0) {
      const pvId = Number(i.productVariantId ?? (i as any).productVariant?.id ?? (i as any).productVariant?._id);
      return eligibleVariants.some((v) => Number(v.id ?? (v as any)._id) === pvId);
    }
    return true;
  }).length;

  const effectiveDraft = draftValue || DEFAULT_NEW_ENTRY_QUANTITY;
  const draftParsed = draftValue ? parseQuantityInput(effectiveDraft) : null;
  const needsVariantChoice = !exactVariant && eligibleVariants.length > 1;
  const addHint =
    !cardError && !needsVariantChoice
      ? inRoomCount > 0
        ? `${inRoomCount} in this room (${entriesInRoom} ${entriesInRoom === 1 ? "entry" : "entries"}). Add creates a new entry${draftParsed?.ok ? ` of ${draftParsed.value}` : ""
        }.`
        : null
      : null;

  return (
    <div
      className={`bg-white rounded-xl border p-3.5 transition-all duration-200 flex flex-col justify-between group shadow-none ${inRoomCount > 0
          ? "border-accent/40 ring-1 ring-accent/20 shadow-2xs"
          : otherVariantsInRoom > 0
            ? "border-amber-300/60 ring-1 ring-amber-200/40"
            : "border-gray-200 hover:border-gray-300"
        }`}
    >
      {/* Top: Product Image */}
      <div className="w-full h-28 bg-[#FAFAFA] rounded-lg mb-2.5 flex items-center justify-center overflow-hidden relative border border-gray-100">
        {prod.imageUrl ? (
          <img
            src={prod.imageUrl}
            alt={prod.name}
            className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-gray-300">
            <Package size={26} className="text-gray-300" />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
              {prod.type ? prod.type.replace("_", " ") : "Whyte Device"}
            </span>
          </div>
        )}

        {prod.moduleSize && (
          <span className="absolute top-2 right-2 text-[10px] font-mono px-2 py-0.5 rounded bg-white/95 text-gray-700 border border-gray-200 shadow-none">
            {prod.moduleSize}
          </span>
        )}

        {inRoomCount > 0 ? (
          <span className="absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded bg-accent text-white shadow-xs flex items-center gap-1">
            <Check size={10} strokeWidth={3} />
            <span>{inRoomCount > 1 ? `${inRoomCount} in Room` : "In Room"}</span>
          </span>
        ) : otherVariantsInRoom > 0 ? (
          <span
            className="absolute top-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/90 text-white shadow-xs flex items-center gap-1"
            title={`${otherVariantsInRoom} unit(s) of a different variant are currently in this room`}
          >
            <span>{otherVariantsInRoom > 1 ? `${otherVariantsInRoom} other in Room` : "Other variant in Room"}</span>
          </span>
        ) : null}
      </div>

      {/* Content */}
      <div className="space-y-1 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-accent block truncate">
            {prod.category?.name ?? "Automation"}
          </span>
          {eligibleVariants.length > 0 && (
            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
              {eligibleVariants.length} {eligibleVariants.length === 1 ? "variant" : "variants"}
            </span>
          )}
        </div>
        <h4 className="font-bold text-gray-950 text-sm leading-snug line-clamp-2">
          {prod.name}
        </h4>
        {prod.code && (
          <p className="text-[11px] font-mono text-gray-400">{prod.code}</p>
        )}
        {prod.description && (
          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
            {prod.description}
          </p>
        )}
        {prod.specs && prod.specs.length > 0 && (
          <dl className="flex flex-wrap gap-1 pt-0.5" data-testid="picker-specs">
            {prod.specs.map((spec) => (
              <div key={spec.key} className="inline-flex max-w-full items-baseline gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                <dt className="shrink-0 text-gray-400">{spec.label}</dt>
                <dd className="min-w-0 truncate font-semibold text-gray-800">{spec.text}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Selected configuration preview */}
        {(selectedTier || selectedFinish) && (
          <div className="flex flex-wrap gap-1 pt-1">
            {selectedTier && selectedTier !== "all" && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-accent-light text-accent-foreground border border-accent-border/60">
                {categoryConfig.configuredTiers.find((t) => t.value === selectedTier)?.label ?? selectedTier}
              </span>
            )}
            {selectedFinish && selectedFinish !== "all" && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-accent-light text-accent-foreground border border-accent-border/60">
                {categoryConfig.configuredFinishes.find((f) => f.value === selectedFinish)?.label ?? selectedFinish}
              </span>
            )}
          </div>
        )}

        {/* Variants inline display & toggle (strictly scoped to eligibleVariants) */}
        {eligibleVariants.length > 1 && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onToggleExpand(prodId)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-50 hover:bg-gray-100 text-gray-800 transition-colors border border-gray-200/80 cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Layers size={12} className="text-accent" />
                <span>{eligibleVariants.length} Matching Variants</span>
              </span>
              <span className="flex items-center gap-1 text-[11px] text-accent font-semibold">
                <span>{isCardExpanded ? "Hide" : "View"}</span>
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-200 ${isCardExpanded ? "rotate-180" : ""
                    }`}
                />
              </span>
            </button>

            {/* Expanded Variants List right on card - ONLY eligible variants shown */}
            {isCardExpanded && (
              <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {eligibleVariants.map((v) => {
                  const vid = Number(v.id ?? (v as any)._id);
                  const vLabel = getVariantName(v);
                  const vTier = getVariantTier(v);
                  const vFinish = getVariantFinish(v);
                  const vCount = currentRoom
                    ? (currentRoom.items || [])
                      .filter(
                        (i) => {
                          const pId = Number(i.productId ?? (i as any).product?.id ?? (i as any).product?._id);
                          const pvId = Number(i.productVariantId ?? (i as any).productVariant?.id ?? (i as any).productVariant?._id);
                          return pId === prodId && pvId === vid;
                        }
                      )
                      .reduce((acc, i) => acc + (Number(i.quantity) || 1), 0)
                    : 0;

                  return (
                    <div
                      key={vid}
                      className={`p-2 rounded-lg border text-xs flex items-center justify-between gap-2 transition-all ${vCount > 0
                          ? "bg-accent/5 border-accent/40 shadow-2xs"
                          : "bg-white border-gray-200 hover:border-gray-300"
                        }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900 text-[11px] truncate">
                          {vLabel}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono font-bold text-accent text-[11px]">
                            {formatCurrency(v.price)}
                          </span>
                          {vTier && (
                            <span className="text-[9px] text-gray-400 font-medium capitalize">
                              {vTier}
                            </span>
                          )}
                          {vFinish && (
                            <span className="text-[9px] text-gray-400 font-medium capitalize">
                              • {vFinish}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onAddVariant(prod, v)}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${vCount > 0
                            ? "bg-accent text-white hover:bg-accent-hover shadow-2xs"
                            : "bg-gray-100 hover:bg-gray-200 text-gray-800"
                          }`}
                        title={`Add ${vLabel} to ${getRoomDisplayName(currentRoom, allRooms)}`}
                      >
                        <Plus size={10} strokeWidth={2.5} />
                        <span>{vCount > 0 ? `Add (${vCount} in room)` : "Add"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pricing & Stepper Control Bar */}
      <div className="mt-3.5 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] text-gray-400 font-normal">
            {exactVariant
              ? "Unit Price"
              : eligibleVariants.length > 1
                ? "Starting at"
                : "Unit Price"}
          </p>
          <p className="text-sm font-extrabold font-mono text-gray-950">
            {formatCurrency(exactVariant ? exactVariant.price : minPrice)}
          </p>
        </div>

        {/* Quantity Stepper: [-] [count] [+] */}
        <div
          className={`flex items-center border rounded-lg overflow-hidden transition-all ${inRoomCount > 0
              ? "border-gray-950 bg-gray-950 text-white shadow-xs"
              : "border-gray-200 bg-gray-50/60 text-gray-700 shadow-none"
            }`}
        >
          <button
            type="button"
            disabled={inRoomCount === 0 || isAdding}
            onClick={() => onRemoveProductInstance(catItem)}
            className={`w-7 h-7 flex items-center justify-center transition active:scale-90 disabled:opacity-20 disabled:cursor-not-allowed ${inRoomCount > 0
                ? "hover:bg-white/20 text-white"
                : "hover:bg-gray-100 text-gray-600"
              }`}
            title="Remove one unit from the latest entry"
          >
            <Minus size={12} />
          </button>

          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={effectiveDraft}
            maxLength={6}
            disabled={isAdding || isLocked}
            aria-label={`Quantity for the next ${prod.name} entry`}
            aria-invalid={cardError ? true : undefined}
            onChange={(event) => {
              const next = event.target.value;
              onDraftChange(cardKey, next);
              onClearQtyError(cardKey);
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddTypedQuantity(catItem);
              }
            }}
            className={`w-10 bg-transparent text-center text-xs font-mono outline-none focus:ring-1 focus:ring-accent/60 disabled:opacity-60 ${inRoomCount > 0 ? "text-white font-bold" : "text-gray-700 font-semibold"
              }`}
          />

          <button
            type="button"
            disabled={isAdding}
            onClick={() => onAddProduct(catItem)}
            className={`w-7 h-7 flex items-center justify-center transition active:scale-90 ${inRoomCount > 0
                ? "hover:bg-white/20 text-white"
                : "hover:bg-gray-100 text-gray-700"
              }`}
            title={
              exactVariant
                ? `Add ${getVariantName(exactVariant)} to room`
                : eligibleVariants.length > 1
                  ? "Select from matching variants"
                  : "Add device to room"
            }
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Direct quantity entry: type the quantity above, then Add */}
      <div className="mt-2">
        <button
          type="button"
          disabled={isAdding || isLocked}
          onClick={() => onAddTypedQuantity(catItem)}
          aria-busy={isAdding}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          title="Add a new entry with the quantity typed above"
        >
          {isAdding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} strokeWidth={2.5} />}
          <span>{isAdding ? "Adding…" : "Add"}</span>
        </button>
        {cardError ? (
          <p role="alert" className="mt-1 text-[10px] font-medium leading-snug text-red-600">
            {cardError}
          </p>
        ) : addHint ? (
          <p className="mt-1 text-[10px] leading-snug text-gray-500">{addHint}</p>
        ) : null}
      </div>
    </div>
  );
});
