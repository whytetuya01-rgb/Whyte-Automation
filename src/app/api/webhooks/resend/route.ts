import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { QuotationDelivery } from "@/models";
import { runUnscoped, runWithTenantContext } from "@/lib/tenant/context";
import { applyProviderEvent, providerEventKind, verifyWebhookSignature } from "@/lib/quotationDelivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * POST /api/webhooks/resend — delivery / open / bounce notifications from the email provider.
 *
 * Public (the provider has no session), so it trusts nothing but a valid signature made with
 * RESEND_WEBHOOK_SECRET. The notification can only touch the one delivery whose provider message id it names: that
 * delivery is found with a logged unscoped lookup, and the update then runs inside that delivery's own company
 * context. Unknown messages and event types are acknowledged and ignored, so the provider does not keep retrying.
 */
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: { code: "NOT_CONFIGURED", message: "Webhook is not configured." } }, { status: 503 });
  }

  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large." } }, { status: 413 });
  }
  const eventId = req.headers.get("svix-id");
  const valid = verifyWebhookSignature(secret, { id: eventId, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, body);
  if (!valid || !eventId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid signature." } }, { status: 401 });
  }

  let payload: { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } } | null = null;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON." } }, { status: 400 });
  }
  const kind = providerEventKind(payload?.type);
  const messageId = typeof payload?.data?.email_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(payload.data.email_id) ? payload.data.email_id : null;
  if (!kind || !messageId) return NextResponse.json({ success: true, data: { ignored: true } });
  const parsedAt = typeof payload?.created_at === "string" ? Date.parse(payload.created_at) : NaN;
  const at = Number.isFinite(parsedAt) ? new Date(parsedAt) : new Date();

  try {
    await connectMongoDB();
    // The query must execute inside the unscoped block (a Mongoose query only runs when awaited).
    const owner = await runUnscoped("provider-webhook", async () =>
      await QuotationDelivery.findOne({ providerMessageId: messageId }).select("_id companyId").lean()
    );
    if (!owner) return NextResponse.json({ success: true, data: { ignored: true } });

    const applied = await runWithTenantContext({ companyId: owner.companyId, userId: 0, role: "system", actingAsCompany: false }, async () => {
      const delivery = await QuotationDelivery.findById(owner._id);
      if (!delivery || delivery.providerMessageId !== messageId) return false;
      if (!applyProviderEvent(delivery, eventId, kind, at)) return false;
      await delivery.save();
      return true;
    });
    return NextResponse.json({ success: true, data: { applied } });
  } catch (error) {
    console.error("[webhook:resend] Could not apply notification:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: { code: "INTERNAL_SERVER_ERROR", message: "Could not process the notification." } }, { status: 500 });
  }
}
