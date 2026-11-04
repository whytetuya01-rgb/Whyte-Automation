import { createHash } from "node:crypto";
import { compareRevisionSnapshots } from "@/lib/revisionCompare";
import type { ClientSession } from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import {
  AdminUser, Product, Quotation, QuotationDelivery, QuotationDeliveryFile, QuotationItem, QuotationRevision, QuotationRevisionFile, QuotationRoom, RoomType,
  type IQuotationDocument, type IQuotationRevision, type IRevisionPdf, type RevisionSnapshot, type RevisionSnapshotRoom,
} from "@/models";
import type { QuotationRevisionRequest } from "@/models/Quotation";
import { ApiError } from "@/lib/api-response";
import { includeSoftDeleted } from "@/lib/softDelete/scope";
import { deriveQuotationFinancials } from "@/lib/quotationTotals";
import { displayNameOf, recordQuotationEvent } from "@/lib/quotationAudit";
import { withRequiredTransaction } from "@/lib/transaction";
import { DELIVERY_MAX_PDF_BYTES } from "@/models";

/**
 * Quotation revisions (#15). A quotation is DRAFT while it is being written. Sending it issues revision 1: a frozen copy of
 * everything the client saw, plus its PDF. From then on it is locked. To change it, someone creates a revision: the issued one
 * is kept exactly as it was (marked superseded), the quotation goes back to draft as revision N+1 with the SAME quotation number,
 * and issuing it again freezes revision N+1. Approved or delivered quotations need an approver (`quotations:transition`) to allow it.
 *
 * Nothing here changes the quotation number, who the dealer is, or any earlier revision.
 */

/** Statuses a quotation can be revised from. A draft is already being edited. */
export const REVISABLE_STATUSES = ["sent", "rejected", "approved", "delivered"] as const;
export const APPROVAL_REQUIRED_STATUSES = ["approved", "delivered"] as const;

export const revisionRecordId = (quotationId: string, revision: number) => `qr_${quotationId}_${revision}`;
export const needsApprovalToRevise = (status: string): boolean => (APPROVAL_REQUIRED_STATUSES as readonly string[]).includes(status);
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const isPdf = (data: Buffer) => data.length > 5 && data.subarray(0, 5).toString("latin1") === "%PDF-";
const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(typeof value === "object" && "$numberDecimal" in (value as object) ? (value as { $numberDecimal: string }).$numberDecimal : String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Only a draft can be edited. Any other status says to create a revision (the quotation's own number and history are kept). */
export function assertQuotationEditable(quotation: { status: string; revision?: number | null }): void {
  if (quotation.status === "draft") return;
  throw new ApiError(
    "FORBIDDEN",
    `This quotation has been issued (revision ${quotation.revision ?? 1}, ${quotation.status}) and is locked. Create a new revision to change it.`,
    { details: { reason: "QUOTATION_LOCKED", status: quotation.status, revision: quotation.revision ?? 1 } }
  );
}

// ── snapshots ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function buildSnapshot(quotation: Pick<IQuotationDocument, "_id" | "quotationNumber" | "clientName" | "clientGstNumber" | "clientPhone" | "clientEmail" | "clientAddress" | "houseTypeId" | "premisesName" | "notes" | "terms" | "validUntil" | "discountType" | "discountValue" | "customerDiscountPercent" | "allocatedDiscountPercent" | "dealerId">, session?: ClientSession): Promise<RevisionSnapshot> {
  const s = session ?? null;
  const rooms = await QuotationRoom.find({ quotationId: quotation._id }).sort({ sortOrder: 1, _id: 1 }).session(s).lean<Array<{ _id: number; roomTypeId: number | null; customName: string | null; subArea: string | null; notes: string | null }>>();
  const roomIds = rooms.map((room) => room._id);
  const items = roomIds.length === 0 ? [] : await QuotationItem.find({ quotationRoomId: { $in: roomIds } }).sort({ sortOrder: 1, _id: 1 }).session(s).lean<Array<{ _id: number; quotationRoomId: number; productId: number; productVariantId: number | null; variantLabel: string | null; quantity: number; unitPrice: unknown; priceWithoutTax?: unknown; taxPercent?: unknown; taxAmount?: unknown; notes: string | null; discountType?: "percentage" | "fixed" | null; discountValue?: number | null; preDiscountUnitPrice?: unknown }>>();
  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = productIds.length === 0 ? [] : await includeSoftDeleted(Product.find({ _id: { $in: productIds } }).select("name code").session(s), "historical-reference").lean<Array<{ _id: number; name: string; code?: string | null }>>();
  const typeIds = [...new Set(rooms.map((room) => room.roomTypeId).filter((id): id is number => id !== null))];
  const roomTypes = typeIds.length === 0 ? [] : await includeSoftDeleted(RoomType.find({ _id: { $in: typeIds } }).select("name").session(s), "historical-reference").lean<Array<{ _id: number; name: string }>>();
  const productById = new Map(products.map((product) => [product._id, product]));
  const typeName = new Map(roomTypes.map((type) => [type._id, type.name]));

  const optionalNumber = (value: unknown) => (value === null || value === undefined ? null : toNumber(value));
  const snapshotRooms: RevisionSnapshotRoom[] = rooms.map((room) => ({
    roomId: room._id,
    name: room.customName || (room.roomTypeId !== null ? typeName.get(room.roomTypeId) : undefined) || "Room",
    subArea: room.subArea ?? null,
    notes: room.notes ?? null,
    items: items.filter((item) => item.quotationRoomId === room._id).map((item) => ({
      itemId: item._id,
      productId: item.productId,
      productName: productById.get(item.productId)?.name ?? "Product",
      productCode: productById.get(item.productId)?.code ?? null,
      variantId: item.productVariantId ?? null,
      variantLabel: item.variantLabel ?? null,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      priceWithoutTax: optionalNumber(item.priceWithoutTax),
      taxPercent: optionalNumber(item.taxPercent),
      taxAmount: optionalNumber(item.taxAmount),
      notes: item.notes ?? null,
      discountType: item.discountType ?? null,
      discountValue: item.discountType ? optionalNumber(item.discountValue) : null,
      preDiscountUnitPrice: item.discountType ? optionalNumber(item.preDiscountUnitPrice) : null,
    })),
  }));

  const subtotal = items.reduce((sum, item) => sum + (item.quantity || 1) * toNumber(item.unitPrice), 0);
  const financials = deriveQuotationFinancials({
    subtotal,
    discountType: quotation.discountType,
    discountValue: quotation.discountValue,
    customerDiscountPercent: quotation.customerDiscountPercent,
    allocatedDiscountPercent: quotation.allocatedDiscountPercent,
  });
  return {
    quotation: {
      quotationNumber: quotation.quotationNumber,
      clientName: quotation.clientName,
      clientGstNumber: quotation.clientGstNumber ?? null,
      clientPhone: quotation.clientPhone ?? null,
      clientEmail: quotation.clientEmail ?? null,
      clientAddress: quotation.clientAddress ?? null,
      houseTypeId: quotation.houseTypeId ?? null,
      premisesName: quotation.premisesName ?? null,
      notes: quotation.notes ?? null,
      terms: quotation.terms ?? null,
      validUntil: quotation.validUntil ? new Date(quotation.validUntil).toISOString() : null,
      discountType: quotation.discountType ?? null,
      discountValue: toNumber(quotation.discountValue),
      customerDiscountPercent: Number(quotation.customerDiscountPercent ?? 0),
      allocatedDiscountPercent: Number(quotation.allocatedDiscountPercent ?? 0),
      dealerId: quotation.dealerId ?? null,
    },
    rooms: snapshotRooms,
    totals: { subtotal: financials.subtotal, discountAmount: financials.discountAmount, netSubtotal: financials.netSubtotal, totalGstAmount: financials.totalGstAmount, grandTotal: financials.grandTotal },
  };
}

async function nameOf(userId: number | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await AdminUser.findById(userId).select("name firstName lastName email").lean<{ name?: string; firstName?: string; lastName?: string; email?: string }>();
  return user ? displayNameOf(user) : null;
}

/** For an older sent quotation: the PDF of its most recent delivery (already stored, kept forever) becomes its revision-1 PDF. */
async function latestDeliveryPdf(quotationId: string, session: ClientSession | null): Promise<IRevisionPdf | null> {
  const delivery = await QuotationDelivery.findOne({ quotationId }).sort({ createdAt: -1 }).session(session).lean<{ _id: string }>();
  if (!delivery) return null;
  const file = await QuotationDeliveryFile.findById(delivery._id).select("sha256 size").session(session).lean<{ sha256: string; size: number }>();
  return file ? { source: "delivery", fileId: String(delivery._id), sha256: file.sha256, size: file.size, attachedAt: new Date() } : null;
}

// ── issuing ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Freezes the quotation as it is now as its current revision. Safe to call twice: the first record wins. Called when a quotation is
 * first sent, and lazily for older sent quotations that predate revisions (their record is marked `reconstructed`).
 */
export async function issueRevision(quotation: IQuotationDocument, options: { userId: number | null; reconstructed?: boolean; session?: ClientSession }): Promise<IQuotationRevision> {
  const s = options.session ?? null;
  const revision = quotation.revision ?? 1;
  const id = revisionRecordId(quotation._id, revision);
  const existing = await QuotationRevision.findOne({ _id: id }).session(s).lean<IQuotationRevision>();
  if (existing) return existing;
  const issuedAt = options.reconstructed ? quotation.sentAt ?? new Date() : new Date();
  const record = {
    _id: id,
    companyId: quotation.companyId,
    quotationId: quotation._id,
    revision,
    quotationNumber: quotation.quotationNumber,
    issuedAt,
    issuedBy: options.reconstructed ? quotation.sentBy ?? null : options.userId,
    issuedByName: await nameOf(options.reconstructed ? quotation.sentBy ?? null : options.userId),
    reason: revision > 1 ? quotation.revisionReason ?? null : null,
    basedOnRevision: revision > 1 ? revision - 1 : null,
    reconstructed: options.reconstructed === true,
    snapshot: await buildSnapshot(quotation, options.session),
    pdf: options.reconstructed ? await latestDeliveryPdf(quotation._id, s) : null,
    createdAt: new Date(),
  };
  try {
    await QuotationRevision.create([record], s ? { session: s } : {});
  } catch (error) {
    // A concurrent request issued it first: theirs is the record.
    if ((error as { code?: number }).code === 11000) return (await QuotationRevision.findOne({ _id: id }).session(s).lean<IQuotationRevision>()) as IQuotationRevision;
    throw error;
  }
  return record as unknown as IQuotationRevision;
}

/** Makes sure an issued (not draft) quotation has a record for its current revision, rebuilding one for older quotations. */
export async function ensureIssuedRecord(quotation: IQuotationDocument, session?: ClientSession): Promise<IQuotationRevision | null> {
  if (quotation.status === "draft") return null;
  return issueRevision(quotation, { userId: null, reconstructed: true, session });
}

// ── creating a revision (with the approval rules) ────────────────────────────────────────────────────────────────

export interface Actor {
  userId: number;
  /** Holds `quotations:transition`: may approve revisions of approved / delivered quotations. */
  canApprove: boolean;
}

async function supersedeAndReopen(quotation: IQuotationDocument, input: { actorId: number; reason: string; session?: ClientSession }): Promise<{ revision: number }> {
  const s = input.session ?? null;
  const previous = quotation.revision ?? 1;
  const current = await ensureIssuedRecord(quotation, input.session);
  const at = new Date();
  if (current) {
    await QuotationRevision.updateOne(
      { _id: current._id, supersededAt: null },
      { $set: { supersededAt: at, supersededBy: input.actorId, supersededByRevision: previous + 1, statusWhenSuperseded: quotation.status, approvedAt: quotation.approvedAt ?? null, approvedBy: quotation.approvedBy ?? null } },
      s ? { session: s } : {}
    );
  }
  const fromStatus = quotation.status;
  quotation.status = "draft";
  quotation.revision = previous + 1;
  quotation.revisionReason = input.reason;
  quotation.sentAt = null;
  quotation.sentBy = null;
  quotation.approvedAt = null;
  quotation.approvedBy = null;
  quotation.rejectedAt = null;
  quotation.rejectedBy = null;
  quotation.deliveredAt = null;
  quotation.deliveredBy = null;
  await quotation.save(s ? { session: s } : {});
  await recordQuotationEvent({
    quotationId: quotation._id,
    action: "revision_created",
    performedBy: input.actorId,
    previousValue: { revision: previous, status: fromStatus },
    newValue: { revision: previous + 1, status: "draft" },
    metadata: { reason: input.reason },
  }, input.session);
  return { revision: previous + 1 };
}

export type ReviseOutcome = { kind: "revised"; revision: number } | { kind: "requested"; request: QuotationRevisionRequest };

/**
 * Starts a revision. A sent or rejected quotation is revised straight away by whoever may edit it. An approved or delivered one
 * is revised straight away only by an approver; anyone else files a request for an approver to decide.
 */
export async function reviseQuotation(quotationId: string, input: { actor: Actor; reason: string }): Promise<ReviseOutcome> {
  await connectMongoDB();
  return withRequiredTransaction(async (session) => {
    const quotation = await Quotation.findById(quotationId).session(session ?? null);
    if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
    if (quotation.status === "draft") throw new ApiError("CONFLICT", "This quotation is still a draft: edit it directly.");
    if (!(REVISABLE_STATUSES as readonly string[]).includes(quotation.status)) throw new ApiError("CONFLICT", `A ${quotation.status} quotation cannot be revised.`);

    if (needsApprovalToRevise(quotation.status) && !input.actor.canApprove) {
      if (quotation.revisionRequest?.status === "pending") throw new ApiError("CONFLICT", "A revision of this quotation has already been requested and is waiting for approval.");
      const request: QuotationRevisionRequest = { status: "pending", requestedBy: input.actor.userId, requestedByName: await nameOf(input.actor.userId), requestedAt: new Date(), reason: input.reason, decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: null };
      quotation.revisionRequest = request;
      await quotation.save(session ? { session } : {});
      await recordQuotationEvent({ quotationId: quotation._id, action: "revision_requested", performedBy: input.actor.userId, previousValue: { revision: quotation.revision }, newValue: { revision: quotation.revision, request: "pending" }, metadata: { reason: input.reason } }, session);
      return { kind: "requested", request };
    }
    const { revision } = await supersedeAndReopen(quotation, { actorId: input.actor.userId, reason: input.reason, session });
    return { kind: "revised", revision };
  });
}

/** An approver decides a pending request: approving it creates the revision; rejecting it leaves the quotation as it is. */
export async function decideRevisionRequest(quotationId: string, input: { actor: Actor; decision: "approve" | "reject"; note: string | null }): Promise<{ kind: "revised"; revision: number } | { kind: "rejected" }> {
  await connectMongoDB();
  if (!input.actor.canApprove) throw new ApiError("FORBIDDEN", "Only an approver can decide a revision request.");
  return withRequiredTransaction(async (session) => {
    const quotation = await Quotation.findById(quotationId).session(session ?? null);
    if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
    const request = quotation.revisionRequest;
    if (!request || request.status !== "pending") throw new ApiError("CONFLICT", "There is no revision request waiting for a decision.");
    const decidedByName = await nameOf(input.actor.userId);
    const decided: QuotationRevisionRequest = { ...request, status: input.decision === "approve" ? "approved" : "rejected", decidedBy: input.actor.userId, decidedByName, decidedAt: new Date(), decisionNote: input.note };
    await recordQuotationEvent({ quotationId: quotation._id, action: "revision_request_decided", performedBy: input.actor.userId, previousValue: { request: "pending" }, newValue: { request: decided.status }, metadata: { note: input.note, requestedBy: request.requestedBy } }, session);
    if (input.decision === "reject") {
      quotation.revisionRequest = decided;
      await quotation.save(session ? { session } : {});
      return { kind: "rejected" as const };
    }
    const { revision } = await supersedeAndReopen(quotation, { actorId: request.requestedBy, reason: request.reason, session });
    quotation.revisionRequest = decided;
    await quotation.save(session ? { session } : {});
    return { kind: "revised" as const, revision };
  });
}

// ── PDFs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stores the PDF of the quotation's CURRENT issued revision. Write-once: the same bytes again are accepted (nothing changes), a
 * different PDF for a revision that already has one is refused.
 */
/** Refuses, before anything is changed, a file that cannot be kept as a revision's PDF. */
export function assertStorablePdf(buffer: Buffer): void {
  if (buffer.length === 0 || buffer.length > DELIVERY_MAX_PDF_BYTES) throw new ApiError("FILE_TOO_LARGE", `The PDF must be between 1 byte and ${DELIVERY_MAX_PDF_BYTES / (1024 * 1024)} MB.`, { field: "pdf" });
  if (!isPdf(buffer)) throw new ApiError("INVALID_FILE_TYPE", "The file must be a PDF.", { field: "pdf" });
}

export async function attachRevisionPdf(quotationId: string, buffer: Buffer, session?: ClientSession): Promise<{ revision: number; sha256: string; stored: boolean }> {
  await connectMongoDB();
  assertStorablePdf(buffer);
  const quotation = await Quotation.findById(quotationId).session(session ?? null);
  if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
  if (quotation.status === "draft") throw new ApiError("CONFLICT", "This quotation has not been issued yet: send or download it first.");
  const record = await ensureIssuedRecord(quotation, session);
  if (!record) throw new ApiError("CONFLICT", "This quotation has not been issued yet.");
  const digest = sha256(buffer);
  if (record.pdf) {
    if (record.pdf.sha256 === digest) return { revision: record.revision, sha256: digest, stored: false };
    throw new ApiError("CONFLICT", `Revision ${record.revision} already has its PDF. An issued PDF is never replaced: create a new revision instead.`, { details: { reason: "PDF_ALREADY_STORED" } });
  }
  await QuotationRevisionFile.create([{ _id: record._id, companyId: record.companyId, mime: "application/pdf", size: buffer.length, sha256: digest, data: buffer }], { session }).catch((error: { code?: number }) => {
    if (error?.code !== 11000) throw error;
  });
  await QuotationRevision.updateOne({ _id: record._id, pdf: null }, { $set: { pdf: { source: "revision_file", fileId: record._id, sha256: digest, size: buffer.length, attachedAt: new Date() } } }, { session });
  return { revision: record.revision, sha256: digest, stored: true };
}

/** A sent delivery already stores its PDF; if the current revision has none, that PDF becomes the revision's (no copy is made). */
export async function adoptDeliveryPdf(quotationId: string, delivery: { _id: string }): Promise<void> {
  await connectMongoDB();
  const quotation = await Quotation.findById(quotationId);
  if (!quotation || quotation.status === "draft") return;
  const record = await ensureIssuedRecord(quotation);
  if (!record || record.pdf) return;
  const sent = await QuotationDelivery.findOne({ _id: delivery._id, quotationId }).select("revision").lean<{ revision?: number | null }>();
  // Only a send OF this revision may become its PDF (a delivery from before revisions were recorded counts as revision 1).
  if (!sent || (sent.revision && sent.revision > 0 ? sent.revision : 1) !== record.revision) return;
  const file = await QuotationDeliveryFile.findById(delivery._id).select("sha256 size").lean<{ sha256: string; size: number }>();
  if (!file) return;
  await QuotationRevision.updateOne({ _id: record._id, pdf: null }, { $set: { pdf: { source: "delivery", fileId: String(delivery._id), sha256: file.sha256, size: file.size, attachedAt: new Date() } } });
}

/**
 * The current issued revision has no PDF, but the quotation was successfully sent (email or WhatsApp) AS this revision: that
 * sent PDF, stored with the delivery, becomes the revision's PDF. It is the very document the client received, so nothing is
 * regenerated. Returns what happened; `null` when there was no such send.
 */
export async function recoverCurrentRevisionPdf(quotationId: string): Promise<{ revision: number; stored: boolean } | null> {
  await connectMongoDB();
  const quotation = await Quotation.findById(quotationId);
  if (!quotation || quotation.status === "draft") return null;
  const record = await ensureIssuedRecord(quotation);
  if (!record) return null;
  if (record.pdf) return { revision: record.revision, stored: false };
  const revisionMatch = record.revision === 1 ? { $or: [{ revision: 1 }, { revision: { $exists: false } }, { revision: null }] } : { revision: record.revision };
  const sends = await QuotationDelivery.find({ quotationId, status: { $in: ["sent", "delivered", "read"] }, ...revisionMatch }).sort({ createdAt: -1 }).select("_id").limit(5).lean<Array<{ _id: string }>>();
  for (const send of sends) {
    await adoptDeliveryPdf(quotationId, { _id: String(send._id) });
    const after = await QuotationRevision.findById(record._id).select("pdf").lean<{ pdf: IRevisionPdf | null }>();
    if (after?.pdf) return { revision: record.revision, stored: true };
  }
  return null;
}

export async function loadRevisionPdf(quotationId: string, revision: number): Promise<{ data: Buffer; filename: string; sha256: string } | null> {
  await connectMongoDB();
  const record = await QuotationRevision.findOne({ quotationId, revision }).lean<IQuotationRevision>();
  if (!record?.pdf) return null;
  // Read as a document (not lean): the bytes then arrive as a real Buffer, not a BSON Binary wrapper.
  const file = record.pdf.source === "delivery" ? await QuotationDeliveryFile.findById(record.pdf.fileId) : await QuotationRevisionFile.findById(record.pdf.fileId);
  if (!file?.data) return null;
  return { data: Buffer.from(file.data), filename: `${record.quotationNumber}-rev${record.revision}.pdf`, sha256: record.pdf.sha256 };
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RevisionSummary {
  revision: number;
  quotationNumber: string;
  issuedAt: string;
  issuedByName: string | null;
  reason: string | null;
  reconstructed: boolean;
  hasPdf: boolean;
  grandTotal: number;
  itemCount: number;
  superseded: { at: string; byRevision: number | null; statusWas: string | null } | null;
  approvedAt: string | null;
  current: boolean;
}

export async function listRevisions(quotationId: string): Promise<{ currentRevision: number; status: string; draftReason: string | null; request: QuotationRevisionRequest | null; revisions: RevisionSummary[] }> {
  await connectMongoDB();
  const quotation = await Quotation.findById(quotationId);
  if (!quotation) throw new ApiError("NOT_FOUND", "Quotation not found.");
  if (quotation.status !== "draft") {
    await ensureIssuedRecord(quotation);
    // A revision sent by email / WhatsApp keeps the PDF that was sent, even if storing it was missed at the time.
    await recoverCurrentRevisionPdf(quotationId).catch(() => null);
  }
  const records = await QuotationRevision.find({ quotationId }).sort({ revision: -1 }).lean<IQuotationRevision[]>();
  return {
    currentRevision: quotation.revision ?? 1,
    status: quotation.status,
    draftReason: quotation.status === "draft" && (quotation.revision ?? 1) > 1 ? quotation.revisionReason ?? null : null,
    request: quotation.revisionRequest ?? null,
    revisions: records.map((record) => ({
      revision: record.revision,
      quotationNumber: record.quotationNumber,
      issuedAt: new Date(record.issuedAt).toISOString(),
      issuedByName: record.issuedByName ?? null,
      reason: record.reason ?? null,
      reconstructed: record.reconstructed === true,
      hasPdf: Boolean(record.pdf),
      grandTotal: record.snapshot.totals.grandTotal,
      itemCount: record.snapshot.rooms.reduce((sum, room) => sum + room.items.length, 0),
      superseded: record.supersededAt ? { at: new Date(record.supersededAt).toISOString(), byRevision: record.supersededByRevision ?? null, statusWas: record.statusWhenSuperseded ?? null } : null,
      approvedAt: record.approvedAt ? new Date(record.approvedAt).toISOString() : null,
      current: record.revision === (quotation.revision ?? 1) && quotation.status !== "draft",
    })),
  };
}

/** Two issued revisions of a quotation side by side: who issued each, when, and what changed (from their frozen snapshots only). */
export async function compareRevisions(quotationId: string, fromRevision: number, toRevision: number) {
  await connectMongoDB();
  const records = await QuotationRevision.find({ quotationId, revision: { $in: [fromRevision, toRevision] } }).lean<IQuotationRevision[]>();
  const from = records.find((record) => record.revision === fromRevision);
  const to = records.find((record) => record.revision === toRevision);
  if (!from || !to) throw new ApiError("NOT_FOUND", `Revision ${!from ? fromRevision : toRevision} of this quotation has not been issued.`);
  const side = (record: IQuotationRevision) => ({
    revision: record.revision,
    quotationNumber: record.quotationNumber,
    issuedAt: new Date(record.issuedAt).toISOString(),
    issuedByName: record.issuedByName ?? null,
    reason: record.reason ?? null,
    reconstructed: record.reconstructed === true,
    hasPdf: Boolean(record.pdf),
    grandTotal: record.snapshot.totals.grandTotal,
  });
  return { from: side(from), to: side(to), comparison: compareRevisionSnapshots(from.snapshot, to.snapshot) };
}

export async function getRevision(quotationId: string, revision: number): Promise<IQuotationRevision> {
  await connectMongoDB();
  const record = await QuotationRevision.findOne({ quotationId, revision }).lean<IQuotationRevision>();
  if (!record) throw new ApiError("NOT_FOUND", "That revision was not found.");
  return record;
}
