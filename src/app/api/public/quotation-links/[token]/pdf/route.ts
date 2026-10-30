import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { QuotationDelivery, QuotationDeliveryFile } from "@/models";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { findLinkTarget, inLinkCompany } from "@/lib/quotationLinks";
import { sha256Hex } from "@/lib/quotationDelivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

const notAvailable = (status: number, message: string) =>
  NextResponse.json({ success: false, error: { code: status === 410 ? "GONE" : "NOT_FOUND", message } }, { status, headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" } });

/**
 * GET /api/public/quotation-links/<token>/pdf — the exact PDF that was sent, for whoever holds the link (no sign-in).
 * Only an active link (not expired, not revoked) works; `?download=1` downloads instead of showing it inline.
 * Opening the PDF does not count as a view by itself; the view page records views (see /api/public/quotation-links/view).
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const { limited } = checkRateLimit(`quotation-link-pdf:${clientIpFromRequest(req)}`, { max: 120, windowMs: 10 * 60 * 1000 });
    if (limited) return NextResponse.json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    const { token } = await context.params;
    await connectMongoDB();
    const target = await findLinkTarget(token);
    if (!target) return notAvailable(404, "This quotation link is not valid.");
    if (target.state !== "active") return notAvailable(410, "This quotation link is no longer available.");

    const result = await inLinkCompany(target, async () => {
      const [delivery, file] = await Promise.all([
        QuotationDelivery.findById(target.deliveryId).select("attachmentName attachmentSha256").lean(),
        QuotationDeliveryFile.findById(target.deliveryId),
      ]);
      return delivery && file ? { name: delivery.attachmentName, sha: delivery.attachmentSha256, data: file.data } : null;
    });
    if (!result || sha256Hex(result.data) !== result.sha) return notAvailable(410, "This quotation is no longer available.");

    const download = new URL(req.url).searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(result.data), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(result.data.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${result.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[quotation-link] Could not serve the PDF:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "Could not load the quotation." } }, { status: 500 });
  }
}
