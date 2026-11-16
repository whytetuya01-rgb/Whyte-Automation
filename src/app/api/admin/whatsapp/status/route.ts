import { withPermission } from "@/lib/api-auth";
import { apiSuccess, handleApiError } from "@/lib/api-response";
import { getWhatsAppBridgeStatus } from "@/lib/whatsappService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await withPermission("quotations:read_all", async () => {
      const status = await getWhatsAppBridgeStatus();
      return apiSuccess(status);
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/admin/whatsapp/status" });
  }
}

