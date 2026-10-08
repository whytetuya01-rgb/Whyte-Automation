import { QuotationRoom, QuotationItem } from "@/models";

/**
 * Whether a quotation has at least one configured product (any item in any
 * of its rooms). Used server-side to block forward status transitions — a
 * Draft cannot be marked Sent, and a Sent quotation cannot be Approved,
 * until something has actually been quoted.
 *
 * Mirrors the client-side gate (`hasAnyItems` in ProposalBuilder) that
 * already stops the builder UI from reaching Review/Proposal without a
 * product; this is the same rule enforced at the API layer so it cannot be
 * bypassed by a direct API call, nor by deleting every item from an
 * already-"sent" quotation before it is approved.
 */
export async function quotationHasProducts(quotationId: string): Promise<boolean> {
  const rooms = await QuotationRoom.find({ quotationId }).select("_id").lean();
  if (rooms.length === 0) return false;
  const roomIds = rooms.map((r) => r._id);
  const item = await QuotationItem.exists({ quotationRoomId: { $in: roomIds } });
  return Boolean(item);
}
