import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationDelivery, DELIVERY_CHANNELS, DELIVERY_STATUSES } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { createPaginatedResponse, parsePaginationParams } from "@/lib/pagination";
import { parseSearchQueryParam, parseStringQueryParam } from "@/lib/validation/common";
import { deliveryDto } from "@/lib/quotationLinks";

export const dynamic = "force-dynamic";

/**
 * GET /api/deliveries — every quotation sent by the company (email and WhatsApp), newest first, with the quotation it
 * belongs to and per-status totals. For people who may see all of the company's quotations.
 *
 * Query params:
 *   page, pageSize  - standard pagination
 *   status          - queued | sent | delivered | read | failed
 *   channel         - email | whatsapp
 *   viewed          - "1": only deliveries whose link the client opened
 *   search          - recipient, quotation number or client name
 */
export async function GET(req: Request) {
  try {
    return await withPermission("quotations:read_all", async (actor) => {
      requireActiveCompany(actor);
      const { searchParams } = new URL(req.url);
      const { skip, take, page, pageSize } = parsePaginationParams(searchParams, { defaultPageSize: 25, maxPageSize: 100 });
      const status = parseStringQueryParam(searchParams, "status", { max: 20, allowed: DELIVERY_STATUSES });
      const channel = parseStringQueryParam(searchParams, "channel", { max: 20, allowed: DELIVERY_CHANNELS });
      const viewedOnly = searchParams.get("viewed") === "1";
      const search = parseSearchQueryParam(searchParams, "search", { max: 100 });

      await connectMongoDB();
      const filter: Record<string, unknown> = {};
      if (status) filter.status = status;
      if (channel) filter.channel = channel;
      if (viewedOnly) filter.viewCount = { $gt: 0 };
      if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        const matching = await Quotation.find({ $or: [{ quotationNumber: regex }, { clientName: regex }] }).select("_id").limit(500).lean();
        filter.$or = [{ recipient: regex }, { quotationId: { $in: matching.map((quotation) => quotation._id) } }];
      }

      const [rows, total, byStatus, viewed] = await Promise.all([
        QuotationDelivery.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(take).lean(),
        QuotationDelivery.countDocuments(filter),
        QuotationDelivery.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        QuotationDelivery.countDocuments({ viewCount: { $gt: 0 } }),
      ]);

      const quotationIds = [...new Set(rows.map((row) => row.quotationId))];
      const quotations = quotationIds.length
        ? await Quotation.find({ _id: { $in: quotationIds } }).select("_id quotationNumber clientName status").lean()
        : [];
      const quotationById = new Map(quotations.map((quotation) => [String(quotation._id), quotation]));

      const counts = Object.fromEntries(DELIVERY_STATUSES.map((value) => [value, 0])) as Record<(typeof DELIVERY_STATUSES)[number], number>;
      for (const entry of byStatus) if (entry._id in counts) counts[entry._id as keyof typeof counts] = entry.count;

      const data = rows.map((row) => {
        const quotation = quotationById.get(String(row.quotationId));
        return {
          ...deliveryDto(row),
          quotation: quotation ? { id: String(quotation._id), quotationNumber: quotation.quotationNumber, clientName: quotation.clientName, status: quotation.status } : null,
        };
      });

      return apiSuccess({
        ...createPaginatedResponse(data, total, { page, pageSize }),
        summary: { total: Object.values(counts).reduce((sum, count) => sum + count, 0), viewed, ...counts },
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/deliveries" });
  }
}
