import { connectMongoDB } from "@/lib/mongodb";
import { QuotationDelivery } from "@/models";
import { requireActiveCompany, withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * GET /api/deliveries/setup — whether delivery tracking is fully working, without revealing any secret: email sending
 * configured, the provider's status notifications (webhook) configured and actually arriving, and view links pointing
 * at a public address.
 */
export async function GET() {
  try {
    return await withPermission("quotations:read_all", async (actor) => {
      requireActiveCompany(actor);
      const appUrl = process.env.NEXTAUTH_URL?.trim() || null;
      let publicAppUrl = false;
      if (appUrl) {
        try {
          const { hostname, protocol } = new URL(appUrl);
          publicAppUrl = protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(hostname);
        } catch {
          publicAppUrl = false;
        }
      }

      await connectMongoDB();
      const [lastReported, waiting] = await Promise.all([
        QuotationDelivery.findOne({ channel: "email", deliveredAt: { $ne: null } }).sort({ deliveredAt: -1 }).select("deliveredAt").lean(),
        QuotationDelivery.countDocuments({ channel: "email", status: "sent", sentAt: { $lt: new Date(Date.now() - STALE_AFTER_MS) } }),
      ]);

      return apiSuccess({
        email: { configured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) },
        webhook: {
          configured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
          url: appUrl ? new URL("/api/webhooks/resend", appUrl).toString() : null,
          lastReportAt: lastReported?.deliveredAt ? new Date(lastReported.deliveredAt).toISOString() : null,
          /** Emails accepted over an hour ago with no delivery report yet: a sign reports are not arriving. */
          waitingOverAnHour: waiting,
        },
        links: { appUrl, publicAppUrl, canCopyAgain: Boolean(process.env.NEXTAUTH_SECRET) },
      });
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/deliveries/setup" });
  }
}
