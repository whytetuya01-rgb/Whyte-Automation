import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, QuotationDelivery } from "@/models";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/api-response";
import { findLinkTarget, inLinkCompany, isPreviewBot, recordLinkView } from "@/lib/quotationLinks";
import { recordCrmActivity } from "@/lib/crmService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/quotation-links/view { token } — the view page reports that the client opened the quotation.
 * Sent by the page's script (link-preview fetchers do not run it) and ignored for known preview/bot user agents.
 * Marks the delivery "Viewed" (first time) and counts views; answers the same for invalid links.
 */
export async function POST(req: Request) {
  const ok = (recorded: boolean) => NextResponse.json({ success: true, data: { recorded } }, { headers: { "Cache-Control": "no-store" } });
  try {
    const { limited } = checkRateLimit(`quotation-link-view:${clientIpFromRequest(req)}`, { max: 60, windowMs: 10 * 60 * 1000 });
    if (limited) return NextResponse.json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    if (isPreviewBot(req.headers.get("user-agent"))) return ok(false);
    const body = (await readJsonBody(req).catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    await connectMongoDB();
    const target = await findLinkTarget(token);
    if (!target || target.state !== "active") return ok(false);
    await inLinkCompany(target, async () => {
      const delivery = await QuotationDelivery.findById(target.deliveryId);
      if (!delivery) return;
      recordLinkView(delivery);
      await delivery.save();

      // Quotation-Integrated CRM Automation: record view in CRM timeline if quotation has a lead or customer
      try {
        const quotation = await Quotation.findById(delivery.quotationId).select("leadId customerId quotationNumber").lean();
        if (quotation && (quotation.leadId || quotation.customerId)) {
          await recordCrmActivity({
            companyId: target.companyId,
            leadId: quotation.leadId,
            customerId: quotation.customerId,
            quotationId: quotation._id,
            type: "quotation_viewed",
            title: "Quotation Viewed by Client",
            description: `Client opened quotation ${quotation.quotationNumber} (View #${delivery.viewCount}).`,
            performedBy: delivery.createdBy,
          });
        }
      } catch (crmErr) {
        console.warn("[quotation-link] Failed to record CRM view activity:", crmErr);
      }
    });
    return ok(true);
  } catch (error) {
    console.error("[quotation-link] Could not record a view:", error instanceof Error ? error.message : "unknown error");
    return ok(false);
  }
}
