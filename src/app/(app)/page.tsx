import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, HouseType, AdminUser } from "@/models";
import { dealerVisibilityFilter } from "@/lib/quotationAccess";
import QuotationsListing, { QuotationRowData } from "@/components/quotations/QuotationsListing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  let quotations: QuotationRowData[] = [];
  let houseTypes: any[] = [];
  let dealerEarnings = 0;
  let userRole: string | undefined;

  try {
    const session = await getServerSession(authOptions);
    userRole = (session?.user as { role?: string })?.role;
    const userId = Number((session?.user as any)?.id);

    await connectMongoDB();

    // Determine query filter based on verified role
    let filterQuery: Record<string, unknown> = {};

    if (userRole === "dealer") {
      filterQuery = dealerVisibilityFilter(userId);

      // Compute accumulated earnings strictly from approved and delivered quotations
      const earningsResult = await Quotation.aggregate([
        { $match: { dealerId: userId, status: { $in: ["approved", "delivered"] } } },
        {
          $group: {
            _id: null,
            totalEarnings: { $sum: "$estimatedEarningAmount" },
          },
        },
      ]);
      dealerEarnings = earningsResult[0]?.totalEarnings ? Number(earningsResult[0].totalEarnings) : 0;
    }

    const [quoteDocs, htDocs] = await Promise.all([
      Quotation.find(filterQuery)
        .sort({ createdAt: -1 })
        .populate({ path: "houseType", select: "id name" })
        .populate({ path: "dealer", select: "id name email firstName lastName" })
        .populate({
          path: "rooms",
          populate: {
            path: "items",
            select: "quantity unitPrice",
          },
        })
        .lean({ virtuals: true }),
      HouseType.find({ isActive: true }).sort({ sortOrder: 1 }).lean({ virtuals: true }),
    ]);

    quotations = quoteDocs.map((doc: any) => {
      const q = doc;
      const rooms = Array.isArray(q.rooms) ? q.rooms : [];
      const roomsCount = rooms.length;
      const productsCount = rooms.reduce(
        (sum: number, r: any) => sum + (Array.isArray(r.items) ? r.items.reduce((s: number, i: any) => s + (i.quantity || 1), 0) : 0),
        0
      );
      const subtotal = rooms.reduce(
        (sum: number, r: any) => sum + (Array.isArray(r.items) ? r.items.reduce((s: number, i: any) => s + (i.quantity || 1) * Number(i.unitPrice || 0), 0) : 0),
        0
      );
      const toNum = (v: any) => {
        if (v == null) return 0;
        if (typeof v === 'object' && v && typeof v.toString === 'function') return Number(v.toString());
        const n = Number(v);
        return Number.isNaN(n) ? 0 : n;
      };
      let discount = 0;
      if (q.discountType === 'percentage') {
        discount = (subtotal * toNum(q.discountValue)) / 100;
      } else if (q.discountType === 'fixed') {
        discount = toNum(q.discountValue);
      }
      const totalAmount = Math.max(0, subtotal - discount);
      return {
        id: q.id || q._id,
        quotationNumber: q.quotationNumber,
        clientName: q.clientName,
        clientPhone: q.clientPhone ?? null,
        clientEmail: q.clientEmail ?? null,
        clientAddress: q.clientAddress ?? null,
        houseTypeId: q.houseTypeId ?? null,
        houseType: q.houseType ? { id: q.houseType.id || q.houseType._id, name: q.houseType.name } : null,
        status: q.status || 'draft',
        notes: q.notes ?? null,
        discountType: q.discountType ?? null,
        discountValue: toNum(q.discountValue) || null,
        createdAt: q.createdAt ? new Date(q.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: q.updatedAt ? new Date(q.updatedAt).toISOString() : undefined,
        roomsCount,
        productsCount,
        totalAmount,
        dealerId: q.dealerId ?? null,
        dealerName: q.dealer?.name || (q.dealer ? ((q.dealer.firstName||'')+' '+(q.dealer.lastName||'')).trim() : null),
        allocatedDiscountPercent: toNum(q.allocatedDiscountPercent),
        customerDiscountPercent: toNum(q.customerDiscountPercent),
        estimatedEarningPercent: toNum(q.estimatedEarningPercent),
        estimatedEarningAmount: toNum(q.estimatedEarningAmount),
        clonedFromQuotationId: q.clonedFromQuotationId ?? null,
        sentAt: q.sentAt ? new Date(q.sentAt).toISOString() : null,
        approvedAt: q.approvedAt ? new Date(q.approvedAt).toISOString() : null,
        deliveredAt: q.deliveredAt ? new Date(q.deliveredAt).toISOString() : null,
      };
    });

    houseTypes = htDocs.map((ht: any) => {
      const item = typeof ht.toJSON === "function" ? ht.toJSON() : ht;
      return {
        id: item.id || item._id,
        name: item.name,
        description: item.description ?? null,
        isActive: item.isActive,
        sortOrder: item.sortOrder,
      };
    });
  } catch (error) {
    console.error("Database connection failed in HomePage:", error);
  }

  return (
    <div className="max-w-7xl mx-auto py-2">
      <QuotationsListing
        initialQuotations={quotations}
        houseTypes={houseTypes}
        userRole={userRole}
        dealerEarnings={dealerEarnings}
      />
    </div>
  );
}
