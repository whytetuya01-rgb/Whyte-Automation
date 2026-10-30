import { connectMongoDB } from "@/lib/mongodb";
import { Lead, Quotation, QuotationRoom, HouseTypeRoomTemplate, Customer } from "@/models";
import { withSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { convertLeadSchema } from "@/lib/validation/crm";
import { getNextQuotationSequence, reserveSequenceBlock } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { isBathroomLikeRoomName } from "@/lib/utils";
import { crmVisibilityFilter, recordCrmActivity, resolveOrCreateCustomer } from "@/lib/crmService";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/crm/leads/[id]/convert — Convert a Lead into a Customer and Quotation.
 *
 * Requirements:
 * - Reuse or create central customer record.
 * - Prefill customer name, phone, email, site address.
 * - Preserve lead-to-quotation link on both documents.
 * - Idempotent: prevent duplicate quotation creation from repeated clicks.
 * - Updates lead status to "quoted".
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

      // Safeguard against duplicate quotation creation from double-clicks or multiple conversions
      if (lead.convertedQuotationId) {
        const existingQ = await Quotation.findById(lead.convertedQuotationId).select("_id quotationNumber").lean();
        if (existingQ) {
          return apiSuccess({
            quotationId: existingQ._id,
            quotationNumber: existingQ.quotationNumber,
            alreadyConverted: true,
          });
        }
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

      // Step 1: Resolve or create Central Customer
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
        lead.customerId = customerId;
      }

      // Step 2: Initialize Quotation inside transaction
      const createdOn = new Date();
      const year = createdOn.getFullYear();

      const createdQuotation = await withTransaction(async (dbSession) => {
        const seq = await getNextQuotationSequence(year, dbSession);
        const quotationNumber = `QT-${year}-${String(seq).padStart(3, "0")}`;
        const quotationId = "q_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);

        const projectNotes = [
          lead.projectType ? `Project: ${lead.projectType}` : null,
          lead.notes ? lead.notes : null,
          input.notes ? input.notes : null,
        ]
          .filter(Boolean)
          .join("\n");

        const newQuotation = new Quotation({
          _id: quotationId,
          companyId,
          quotationNumber,
          customerId,
          leadId: lead._id,
          clientName: lead.customerName,
          clientPhone: lead.phone || null,
          clientEmail: lead.email || null,
          clientAddress: lead.siteAddress || lead.location || null,
          houseTypeId: input.houseTypeId ?? null,
          status: "draft",
          notes: projectNotes || null,
          dealerId: lead.dealerId ?? null,
          assignedSalesId: lead.assignedSalesId ?? null,
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

        // Auto-create rooms from house type template if selected
        if (input.houseTypeId) {
          const template = await HouseTypeRoomTemplate.find({ houseTypeId: input.houseTypeId })
            .sort({ sortOrder: 1 })
            .populate({ path: "roomType" })
            .session(dbSession ?? null);

          const validTemplates = template.filter((t) => {
            const roomType = (t as unknown as { roomType?: { name?: string } | null }).roomType;
            return Boolean(roomType);
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

        return newQuotation;
      });

      // Step 3: Link Quotation to Lead and update lead status to "quoted"
      lead.status = "quoted";
      lead.convertedQuotationId = createdQuotation._id;
      lead.updatedAt = new Date();
      await lead.save();

      // Step 4: Record conversion in CRM activity timeline
      await recordCrmActivity({
        companyId,
        leadId: lead._id,
        customerId,
        quotationId: createdQuotation._id,
        type: "status_change",
        title: "Converted to Quotation",
        description: `Lead converted to quotation ${createdQuotation.quotationNumber}.`,
        performedBy: userId,
      });

      return apiSuccess({
        quotationId: createdQuotation._id,
        quotationNumber: createdQuotation.quotationNumber,
        customerId,
        leadId: lead._id,
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/crm/leads/[id]/convert" });
  }
}
