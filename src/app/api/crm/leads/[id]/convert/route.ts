import { connectMongoDB } from "@/lib/mongodb";
import { CrmActivity, Lead, Quotation, QuotationRoom, HouseType, HouseTypeRoomTemplate } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { convertLeadSchema } from "@/lib/validation/crm";
import { reserveSequenceBlock } from "@/lib/counter";
import { issueQuotationNumber, withQuotationNumberRetry } from "@/lib/quotationNumber";
import { withTransaction } from "@/lib/transaction";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { calculateDealerEarning } from "@/lib/dealerEarnings";
import { requireActiveDealer, requireActiveSalesExecutive } from "@/lib/quotationOwnership";
import { dealerSnapshot, recordQuotationEvents } from "@/lib/quotationAudit";
import { crmVisibilityFilter, isDuplicateKey, recordCrmActivity, resolveOrCreateCustomer } from "@/lib/crmService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** The timeline entry that marks a conversion as fully finished. It is written last. */
const CONVERTED_TITLE = "Converted to Quotation";

/**
 * POST /api/crm/leads/[id]/convert — Convert a Lead into a Customer and Quotation.
 *
 * - The quotation is built like one created from the quotation screen: the lead's dealer and salesperson are validated
 *   against the company, the dealer's allocated discount and earning are frozen on it, and the creation is audited.
 * - Exactly one quotation per lead, however many clicks or requests arrive. The lead is first claimed with one atomic
 *   update that stores the quotation's id on it. That id is fixed from then on: any later request (a double click, or a
 *   retry after a crash) uses the SAME id, and the database accepts one quotation per id, so a second quotation can
 *   never exist. No timer decides whether a conversion "is still running".
 * - Recoverable: if the quotation exists but the rest did not finish (lead status, customer link, timeline), repeating
 *   the request finishes it. If the quotation was never saved, repeating the request creates it.
 * - A lead that was converted earlier is left as it is (a lost or won lead is not revived by clicking Convert again).
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    return await withSession(async ({ role, userId, permissions, companyId }) => {
      if (!hasPermission(role, permissions, "quotations:create") || !hasPermission(role, permissions, "leads:manage")) {
        throw new ApiError("FORBIDDEN", "You do not have permission to convert leads into quotations.");
      }
      if (!companyId) throw new ApiError("FORBIDDEN", "Company context required.");

      const { id } = await context.params;
      await connectMongoDB();

      const visibility = crmVisibilityFilter({ role, userId });
      const lead = await Lead.findOne({ _id: id, companyId, ...visibility });
      if (!lead) {
        throw new ApiError("NOT_FOUND", "Lead not found or access denied.");
      }

      /**
       * Finishes whatever a previous attempt left undone, and nothing it already did. Safe to run any number of times:
       * the customer is linked only if missing, and the lead's status and the timeline entry are written only while the
       * "Converted to Quotation" entry is absent.
       */
      const reconcile = async (quotation: { _id: string; quotationNumber: string; customerId?: number | null }): Promise<number | null> => {
        let customerId = lead.customerId ?? quotation.customerId ?? null;
        if (!customerId) {
          customerId = await resolveOrCreateCustomer({
            companyId,
            name: lead.customerName,
            phone: lead.phone,
            whatsapp: lead.whatsapp,
            email: lead.email,
            siteAddress: lead.siteAddress || lead.location,
            assignedSalesId: lead.assignedSalesId,
            dealerId: lead.dealerId,
            userId,
          });
        }
        const finished = await CrmActivity.exists({ companyId, leadId: lead._id, quotationId: quotation._id, title: CONVERTED_TITLE });
        if (!finished) {
          // A lead that is already Quoted, in Negotiation or Won keeps its stage; any other lead becomes Quoted and
          // an earlier lost date / reason no longer applies.
          const keepStage = ["quoted", "negotiation", "won"].includes(lead.status);
          await Lead.updateOne(
            { _id: lead._id, companyId },
            { $set: { customerId, updatedAt: new Date(), ...(keepStage ? {} : { status: "quoted", lostAt: null, lostReason: null, wonAt: null }) } }
          );
          await recordCrmActivity({
            companyId,
            leadId: lead._id,
            customerId,
            quotationId: quotation._id,
            type: "status_change",
            title: CONVERTED_TITLE,
            description: `Lead converted to quotation ${quotation.quotationNumber}.`,
            performedBy: userId,
          });
        } else if (!lead.customerId) {
          await Lead.updateOne({ _id: lead._id, companyId }, { $set: { customerId } });
        }
        if (!quotation.customerId) {
          await Quotation.updateOne({ _id: quotation._id }, { $set: { customerId } });
        }
        return customerId;
      };

      const existingResult = async (quotationId: string) => {
        const existing = await Quotation.findById(quotationId).select("_id quotationNumber customerId").lean();
        if (!existing) return null;
        const customerId = await reconcile({ _id: existing._id, quotationNumber: existing.quotationNumber, customerId: existing.customerId });
        return apiSuccess({ quotationId: existing._id, quotationNumber: existing.quotationNumber, customerId, leadId: lead._id, alreadyConverted: true });
      };

      if (lead.convertedQuotationId) {
        const done = await existingResult(lead.convertedQuotationId);
        if (done) return done;
      }

      let input: {
        houseTypeId?: number | null;
        defaultTier?: string | null;
        defaultFinish?: string | null;
        notes?: string | null;
      } = { houseTypeId: null, defaultTier: null, defaultFinish: null, notes: null };
      try {
        const body = await readJsonBody(req);
        if (body && typeof body === "object") {
          input = convertLeadSchema.parse(body);
        }
      } catch {
        // use defaults if empty body
      }

      // Everything that can be refused is checked BEFORE the lead is claimed, so a refusal never leaves a claim behind.
      if (input.houseTypeId) {
        const houseType = await HouseType.findById(input.houseTypeId).select("_id").lean();
        if (!houseType) throw new ApiError("NOT_FOUND", "House type not found.", { field: "houseTypeId" });
      }
      const dealer = lead.dealerId ? await requireActiveDealer(lead.dealerId, companyId) : null;
      if (lead.assignedSalesId) await requireActiveSalesExecutive(lead.assignedSalesId, companyId);
      const allocatedPercent = Number(dealer?.discountAllocationPercent || 0);
      const { earningPercent } = calculateDealerEarning({ subtotal: 0, allocatedPercent, customerPercent: 0 });

      const createdOn = new Date();
      const year = createdOn.getFullYear();

      // Claim the lead. The winner's quotation id is stored on the lead; everyone else (and every retry) uses that id.
      let quotationId = "q_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
      const claimed = await Lead.findOneAndUpdate(
        { _id: lead._id, companyId, convertedQuotationId: null },
        { $set: { convertedQuotationId: quotationId, updatedAt: createdOn } },
        { returnDocument: "after" }
      );
      if (!claimed) {
        const current = await Lead.findOne({ _id: lead._id, companyId }).select("convertedQuotationId").lean();
        if (!current?.convertedQuotationId) {
          throw new ApiError("CONFLICT", "This lead was changed by someone else. Please reload and try again.");
        }
        quotationId = current.convertedQuotationId;
        const done = await existingResult(quotationId);
        if (done) return done;
      }

      // Here the quotation with this id does not exist (yet): this request creates it, or resumes a conversion whose
      // quotation was never saved. If another request is creating it at the same moment, only one save can succeed.
      let customerId = lead.customerId;
      if (!customerId) {
        customerId = await resolveOrCreateCustomer({
          companyId,
          name: lead.customerName,
          phone: lead.phone,
          whatsapp: lead.whatsapp,
          email: lead.email,
          siteAddress: lead.siteAddress || lead.location,
          assignedSalesId: lead.assignedSalesId,
          dealerId: lead.dealerId,
          userId,
        });
      }

      let quotationNumber: string;
      try {
        quotationNumber = await withQuotationNumberRetry(() => withTransaction(async (dbSession) => {
          const { quotationNumber: number } = await issueQuotationNumber(year, dbSession);

          const projectNotes = [
            lead.projectType ? `Project: ${lead.projectType}` : null,
            lead.notes ? lead.notes : null,
            input.notes ? input.notes : null,
          ]
            .filter(Boolean)
            .join("\n");

          const assigned = Boolean(dealer || lead.assignedSalesId);
          const newQuotation = new Quotation({
            _id: quotationId,
            companyId,
            quotationNumber: number,
            customerId,
            leadId: lead._id,
            clientName: lead.customerName,
            clientPhone: lead.phone || null,
            clientEmail: lead.email || null,
            clientAddress: lead.siteAddress || lead.location || null,
            houseTypeId: input.houseTypeId ?? null,
            status: "draft",
            notes: projectNotes || null,
            discountType: "none",
            discountValue: null,
            allocatedDiscountPercent: allocatedPercent,
            customerDiscountPercent: 0,
            estimatedEarningPercent: earningPercent,
            dealerId: dealer ? dealer._id : null,
            assignedSalesId: lead.assignedSalesId ?? null,
            assignedBy: assigned ? userId : null,
            assignedOn: assigned ? createdOn : null,
            defaultTier: input.defaultTier ?? null,
            defaultFinish: input.defaultFinish ?? null,
            createdBy: String(userId),
            createdAt: createdOn,
            updatedAt: createdOn,
          });

          if (dbSession) {
            await newQuotation.save({ session: dbSession });
          } else {
            await newQuotation.save();
          }

          // Auto-create rooms from the house type template if one was chosen
          if (input.houseTypeId) {
            const template = await HouseTypeRoomTemplate.find({ houseTypeId: input.houseTypeId })
              .sort({ sortOrder: 1 })
              .populate({ path: "roomType" })
              .session(dbSession ?? null);

            const validTemplates = template.filter((t) => {
              const roomType = (t as unknown as { roomType?: { name?: string } | null }).roomType;
              return Boolean(roomType) && !isBathroomLikeRoomName(roomType?.name);
            });

            const totalRooms = validTemplates.reduce((sum, t) => sum + (Number(t.defaultCount) || 1), 0);
            if (totalRooms > 0) {
              const roomIds = await reserveSequenceBlock("quotationRoom", totalRooms, QuotationRoom, dbSession);
              let roomIdCursor = 0;

              const roomDocs = [];
              for (const t of validTemplates) {
                const defaultCount = Number(t.defaultCount) || 1;
                for (let i = 0; i < defaultCount; i++) {
                  const nextRoomId = roomIds[roomIdCursor++];
                  roomDocs.push({
                    _id: nextRoomId,
                    quotationId,
                    roomTypeId: t.roomTypeId,
                    sortOrder: t.sortOrder * 10 + i,
                  });
                }
              }

              if (roomDocs.length > 0) {
                if (dbSession) {
                  await QuotationRoom.insertMany(roomDocs, { session: dbSession });
                } else {
                  await QuotationRoom.insertMany(roomDocs);
                }
              }
            }
          }

          await recordQuotationEvents(
            [
              { quotationId, action: "quotation_created", performedBy: userId, newValue: { quotationNumber: number }, metadata: { viaLead: lead.referenceNumber } },
              ...(assigned && dealer
                ? [{ quotationId, action: "quotation_assigned" as const, performedBy: userId, previousValue: null, newValue: dealerSnapshot(dealer), metadata: { duringCreation: true } }]
                : []),
            ],
            dbSession
          );

          return number;
        }));
      } catch (error) {
        // Another request saved this very quotation first (same id): that one is the conversion; just finish it.
        if (isDuplicateKey(error)) {
          // The other request may still be committing; give it a moment to become visible.
          for (let attempt = 0; attempt < 10; attempt += 1) {
            const done = await existingResult(quotationId);
            if (done) return done;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        // Anything else: the claim stays, so a retry resumes with the same quotation id. Nothing is lost or doubled.
        throw error;
      }

      // Finish the lead (stage, customer, timeline). If this fails, the quotation exists and a retry completes it.
      await reconcile({ _id: quotationId, quotationNumber, customerId });

      return apiSuccess({ quotationId, quotationNumber, customerId, leadId: lead._id });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/leads/[id]/convert" });
  }
}
