/**
 * Phase 4 — soft-deleted catalog references inside a quotation.
 *
 * Pure, dependency-free predicates (no Mongoose, no server-only imports) so
 * they can be imported from both server code (`quotationNormalization.ts`,
 * `quotationTotals.ts`'s aggregation and Node-side reducer) AND client
 * components (`StepReview.tsx`, `StepProductConfig.tsx`,
 * `StepProposalPreview.tsx`) without pulling `@/models` into a browser
 * bundle — that is the one and only reason this lives in its own file
 * instead of inside `quotationTotals.ts`.
 *
 * `isProtectedQuotationStatus` names the two statuses this project already
 * treats as the historical lock (`PATCH`/`DELETE` already reject any edit to
 * them — see `quotations/[id]/route.ts`): their totals are never recomputed
 * from current catalog availability, only from the item/room rows exactly as
 * they were stored.
 *
 * For every other status, an item or room whose catalog reference has since
 * been soft-deleted is excluded from the subtotal (and therefore every
 * dependent GST/discount/earning figure) — but never removed from the
 * quotation itself. `isItemUnavailable`/`isRoomUnavailable` are the single
 * predicate every execution context (Node reducers, the Mongo aggregation,
 * and these same client components) calls, so none of them can drift apart
 * from the others.
 *
 * A reference whose populated target is simply MISSING (not `isDeleted:
 * true`, just absent) is NOT treated as unavailable here — that is either a
 * custom room with no `roomTypeId`, or legacy data pre-dating soft delete,
 * neither of which this feature should newly start excluding.
 */
export function isProtectedQuotationStatus(status: string | null | undefined): boolean {
  return status === "approved" || status === "delivered";
}

interface MaybeDeleted {
  isDeleted?: boolean | null;
}

export function isProductUnavailable(product: MaybeDeleted | null | undefined): boolean {
  return product?.isDeleted === true;
}

export function isVariantUnavailable(
  productVariantId: unknown,
  productVariant: MaybeDeleted | null | undefined
): boolean {
  return productVariantId != null && productVariant?.isDeleted === true;
}

export function isRoomTypeUnavailable(
  roomTypeId: unknown,
  roomType: MaybeDeleted | null | undefined
): boolean {
  return roomTypeId != null && roomType?.isDeleted === true;
}

export interface UnavailabilityCheckItem {
  product?: MaybeDeleted | null;
  productVariantId?: unknown;
  productVariant?: MaybeDeleted | null;
}

export interface UnavailabilityCheckRoom {
  roomTypeId?: unknown;
  roomType?: MaybeDeleted | null;
}

/** True when the room's own room type has been soft-deleted (a custom room with no roomTypeId is never unavailable this way). */
export function isRoomUnavailable(room: UnavailabilityCheckRoom | null | undefined): boolean {
  if (!room) return false;
  return isRoomTypeUnavailable(room.roomTypeId, room.roomType);
}

/** True when the item's own product/variant is soft-deleted, OR its room's room type is. */
export function isItemUnavailable(
  item: UnavailabilityCheckItem | null | undefined,
  room?: UnavailabilityCheckRoom | null
): boolean {
  if (!item) return false;
  return (
    isProductUnavailable(item.product) ||
    isVariantUnavailable(item.productVariantId, item.productVariant) ||
    isRoomUnavailable(room)
  );
}

/** A short, specific reason to show next to the warning — product, variant or room type. */
export function unavailabilityReason(
  item: UnavailabilityCheckItem | null | undefined,
  room?: UnavailabilityCheckRoom | null
): "product" | "variant" | "roomType" | null {
  if (isRoomUnavailable(room)) return "roomType";
  if (isProductUnavailable(item?.product)) return "product";
  if (isVariantUnavailable(item?.productVariantId, item?.productVariant)) return "variant";
  return null;
}

/**
 * Filters a room's items down to the ones that count toward its totals.
 * Approved/Delivered quotations (`isLocked`) keep every item unconditionally
 * — their totals are historical, never recomputed from current availability.
 *
 * Takes the already-computed `isUnavailable` flags (every normalized room/
 * item carries them — see `normalizeQuotationRoom`/`normalizeQuotationItem`
 * in `quotationNormalization.ts`) rather than re-deriving them from a
 * populated `product`/`productVariant`/`roomType` shape, so it stays usable
 * on the lightweight client-side types that never carry those nested
 * objects' full shape.
 */
export function eligibleItemsOfRoom<TItem extends { isUnavailable?: boolean }>(
  room: { isUnavailable?: boolean },
  items: TItem[] | null | undefined,
  isLocked: boolean
): TItem[] {
  if (!Array.isArray(items)) return [];
  if (isLocked) return items;
  if (room.isUnavailable) return [];
  return items.filter((item) => !item.isUnavailable);
}
