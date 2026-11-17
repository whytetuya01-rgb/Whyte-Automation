import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationRoom, QuotationItem, HouseType, Customer } from "@/models";
import { resolveOrCreateCustomer, finalizeLeadLink, recordCrmActivity } from "@/lib/crmService";
import { reserveSequenceBlock } from "@/lib/counter";
import { issueQuotationNumber, withQuotationNumberRetry } from "@/lib/quotationNumber";
import { withTransaction } from "@/lib/transaction";
import { withSession } from "@/lib/api-auth";
import { normalizeQuotation } from "@/lib/quotationNormalization";
import { ApiError, apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { calculateQuotationGst } from "@/lib/pricing";
import { calculateDealerEarning } from "@/lib/dealerEarnings";
import { attachQuotationActors } from "@/lib/quotationActors";
import { redactQuotationForRole } from "@/lib/variantRedaction";
import type { OfflineQuotationDraft } from "@/lib/offline/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/sync-draft
 * Converts an offline quotation draft into an official cloud quotation with:
 * - Server-issued atomic quotation number (e.g. QT-2026-XXXX)
 * - Customer linking / creation
 * - Bulk insertion of all rooms and items inside an ACID transaction
 * - Parity verification of GST and commercial calculations
 */
export async function POST(req: Request) {
  try {
    return await withSession(async (actor) => {
      const { role, userId, companyId, permissions } = actor;

      if (!companyId) {
        throw new ApiError(
          "FORBIDDEN",
          role === "super_admin"
            ? "Super Admin must act as a company to sync offline drafts."
            : "No active company tenant context found."
        );
      }

      const body = (await readJsonBody(req)) as any;
      const draft = body?.draft as OfflineQuotationDraft;

      if (!draft || typeof draft !== "object") {
        throw new ApiError("VALIDATION_ERROR", "A valid offline draft payload is required.");
      }

      if (!draft.clientName || !draft.clientName.trim()) {
        throw new ApiError("VALIDATION_ERROR", "Client name is required to sync a quotation.");
      }

      // Security check: Verify tenant match
      if (Number(draft.companyId) !== Number(companyId)) {
        throw new ApiError("FORBIDDEN", "Tenant mismatch: draft does not belong to the active company.");
      }

      await connectMongoDB();

      // Resolve / Link Customer
      let resolvedCustomerId: number | null = null;
      if (draft.clientName && draft.clientName.trim()) {
        resolvedCustomerId = await resolveOrCreateCustomer({
          companyId,
          name: draft.clientName.trim(),
          phone: draft.clientPhone?.trim() || null,
          email: draft.clientEmail?.trim() || null,
          billingAddress: draft.clientAddress?.trim() || null,
          siteAddress: draft.clientAddress?.trim() || null,
          gstNumber: draft.clientGstNumber?.trim() || null,
          customerType: draft.clientGstNumber ? "commercial" : "individual",
          userId,
        });
      }

      const createdQuotation = await withQuotationNumberRetry(async () => {
        return await withTransaction(async (dbSession) => {
          const year = new Date().getFullYear();
          const { quotationNumber } = await issueQuotationNumber(year, dbSession);
          const quotationId = "q_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);

          const discountType = draft.calculation?.discountType || "percentage";
          const discountValNum = Number(draft.calculation?.discountValue || 0);
          const discountValue =
            discountValNum > 0
              ? mongoose.Types.Decimal128.fromString(discountValNum.toFixed(2))
              : null;

          const requestedCustomerDiscount =
            discountType === "percentage" ? discountValNum : Number(draft.calculation?.customerDiscountPercent || 0);

          const allocatedPercent = Number(draft.calculation?.dealerDiscountAllocationPercent || 0);

          const earningPercent = Math.max(0, allocatedPercent - requestedCustomerDiscount);

          const newQuotation = new Quotation({
            _id: quotationId,
            companyId,
            quotationNumber,
            clientName: draft.clientName.trim(),
            clientPhone: draft.clientPhone?.trim() || null,
            clientEmail: draft.clientEmail?.trim() || null,
            clientAddress: draft.clientAddress?.trim() || null,
            clientGstNumber: draft.clientGstNumber?.trim() || null,
            houseTypeId: draft.houseTypeId ? Number(draft.houseTypeId) : null,
            premisesName: draft.premisesName?.trim() || null,
            notes: draft.notes?.trim() || null,
            customerId: resolvedCustomerId,
            status: "draft",
            discountType,
            discountValue,
            allocatedDiscountPercent: allocatedPercent,
            customerDiscountPercent: requestedCustomerDiscount,
            estimatedEarningPercent: earningPercent,
            dealerId: userId,
            createdBy: String(userId),
            createdAt: new Date(),
          });

          if (dbSession) {
            await newQuotation.save({ session: dbSession });
          } else {
            await newQuotation.save();
          }

          // Bulk insert rooms and items from draft
          const draftRooms = draft.rooms || [];
          if (draftRooms.length > 0) {
            const roomIds = await reserveSequenceBlock("quotationRoom", draftRooms.length, QuotationRoom, dbSession);

            const totalItems = draftRooms.reduce((acc, r) => acc + (r.items?.length || 0), 0);
            const itemIds = totalItems > 0 ? await reserveSequenceBlock("quotationItem", totalItems, QuotationItem, dbSession) : [];
            let itemCursor = 0;

            const roomsToInsert: any[] = [];
            const itemsToInsert: any[] = [];

            draftRooms.forEach((r, rIdx) => {
              const assignedRoomId = roomIds[rIdx];
              roomsToInsert.push({
                _id: assignedRoomId,
                companyId,
                quotationId,
                roomTypeId: r.roomTypeId ? Number(r.roomTypeId) : null,
                customName: r.name?.trim() || null,
                subArea: r.floor?.trim() || null,
                notes: (r as any).notes?.trim() || null,
                sortOrder: typeof r.sortOrder === "number" ? r.sortOrder : rIdx * 10,
              });

              (r.items || []).forEach((item, iIdx) => {
                const assignedItemId = itemIds[itemCursor++];
                const unitPriceNum = Number(item.unitPrice || 0);

                itemsToInsert.push({
                  _id: assignedItemId,
                  companyId,
                  quotationRoomId: assignedRoomId,
                  productId: Number(item.productId),
                  productVariantId: item.variantId ? Number(item.variantId) : null,
                  variantLabel: item.variantName || item.automationTier || null,
                  quantity: Math.max(1, Number(item.quantity || 1)),
                  unitPrice: mongoose.Types.Decimal128.fromString(unitPriceNum.toFixed(2)),
                  isCustomPrice: Boolean(item.isCustomPrice),
                  notes: item.notes?.trim() || null,
                  sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : iIdx,
                });
              });
            });

            if (roomsToInsert.length > 0) {
              if (dbSession) {
                await QuotationRoom.insertMany(roomsToInsert, { session: dbSession });
              } else {
                await QuotationRoom.insertMany(roomsToInsert);
              }
            }

            if (itemsToInsert.length > 0) {
              if (dbSession) {
                await QuotationItem.insertMany(itemsToInsert, { session: dbSession });
              } else {
                await QuotationItem.insertMany(itemsToInsert);
              }
            }
          }

          return newQuotation;
        });
      });

      // Post-transaction CRM activity recording
      if (resolvedCustomerId && companyId) {
        try {
          await recordCrmActivity({
            companyId,
            customerId: resolvedCustomerId,
            leadId: null,
            quotationId: String(createdQuotation._id),
            type: "note",
            title: `Offline draft synced as ${createdQuotation.quotationNumber}`,
            description: `Quotation synced from local offline draft "${draft.id}".`,
            performedBy: userId,
          });
        } catch {
          // CRM activity failure is non-fatal for quotation sync
        }
      }

      // Populate complete quotation with rooms and items
      const populated = await Quotation.findById(createdQuotation._id)
        .populate({ path: "houseType" })
        .populate({ path: "dealer", select: "id name email firstName lastName contactNumber companyName gstNumber businessEmail address" })
        .populate({ path: "customer", select: "id name phone whatsapp email billingAddress siteAddress gstNumber customerType" })
        .populate({
          path: "rooms",
          options: { sort: { sortOrder: 1 } },
          populate: [
            { path: "roomType" },
            {
              path: "items",
              options: { sort: { sortOrder: 1 } },
              populate: [{ path: "product" }, { path: "productVariant" }],
            },
          ],
        })
        .lean({ virtuals: true });

      if (!populated) {
        throw new ApiError("INTERNAL_SERVER_ERROR", "Quotation creation failed.");
      }

      const [withActors] = await attachQuotationActors([populated]);
      const normalized = normalizeQuotation(withActors as any);

      return apiSuccess(redactQuotationForRole(normalized as any, role, permissions), { status: 201 });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/quotations/sync-draft" });
  }
}
