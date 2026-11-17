/**
 * WhatsApp Delivery Service for Whyte Quotation
 *
 * Client service that communicates with the WhatsApp Bridge daemon.
 * Supports persistent hosted bridge (HTTPS/HTTP), bearer token authentication,
 * request timeouts, duplicate message deduplication, and automatic fallback
 * to browser-based WhatsApp (`wa.me`) if the bridge is offline.
 */

const getBridgeUrl = (): string => {
  const raw = process.env.WHATSAPP_BRIDGE_URL || "http://127.0.0.1:5005";
  return raw.replace(/\/+$/, "");
};

const getBridgeSecret = (): string | undefined => {
  return process.env.WHATSAPP_BRIDGE_SECRET?.trim() || undefined;
};

export interface WhatsAppBridgeStatus {
  available: boolean;
  connected: boolean;
  status: "INITIALIZING" | "WAITING_QR" | "AUTHENTICATED" | "CONNECTED" | "DISCONNECTED" | "OFFLINE" | "UNAUTHORIZED";
  phoneNumber?: string | null;
  pushname?: string | null;
  qr?: string | null;
  error?: string | null;
}

export interface SendWhatsAppParams {
  to: string;
  message: string;
  pdfBuffer?: Buffer | Uint8Array;
  pdfFilename?: string;
  idempotencyKey?: string;
}

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
  isDuplicate?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Idempotency Deduplication (prevents double-sends on double clicks)
// ─────────────────────────────────────────────────────────────────────────────
interface SentCacheEntry {
  timestamp: number;
  messageId?: string;
}
const recentSends = new Map<string, SentCacheEntry>();
const DEDUPLICATION_WINDOW_MS = 60 * 1000; // 60 seconds

function cleanDeduplicationCache(): void {
  const now = Date.now();
  for (const [key, entry] of recentSends.entries()) {
    if (now - entry.timestamp > DEDUPLICATION_WINDOW_MS) {
      recentSends.delete(key);
    }
  }
}

function computeDeduplicationKey(to: string, message: string, idempotencyKey?: string): string {
  if (idempotencyKey) return `idemp:${idempotencyKey}`;
  const cleanTo = to.replace(/\D/g, "");
  // Simple hash of destination and first 50 chars of message
  return `send:${cleanTo}:${message.slice(0, 50)}`;
}

/**
 * Checks the operational status of the WhatsApp bridge daemon.
 */
export async function getWhatsAppBridgeStatus(): Promise<WhatsAppBridgeStatus> {
  const bridgeUrl = getBridgeUrl();
  const secret = getBridgeSecret();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (secret) {
      headers["Authorization"] = `Bearer ${secret}`;
    }

    const res = await fetch(`${bridgeUrl}/status`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 401) {
      console.warn("[WhatsAppService] Bridge rejected authorization (401). Verify WHATSAPP_BRIDGE_SECRET.");
      return {
        available: true,
        connected: false,
        status: "UNAUTHORIZED",
        error: "Bridge authentication failed. Verify WHATSAPP_BRIDGE_SECRET.",
      };
    }

    if (!res.ok) {
      return { available: false, connected: false, status: "OFFLINE" };
    }

    const data = await res.json();
    return {
      available: true,
      connected: Boolean(data.connected),
      status: data.status || (data.connected ? "CONNECTED" : "DISCONNECTED"),
      phoneNumber: data.phoneNumber || null,
      pushname: data.pushname || null,
      qr: data.qr || null,
    };
  } catch {
    return { available: false, connected: false, status: "OFFLINE" };
  }
}

/**
 * Dispatches a quotation automatically via the connected WhatsApp bridge.
 * Features:
 * - Bearer token authentication
 * - Safe 30s timeout
 * - Double-submission deduplication
 * - Graceful failure reporting
 */
export async function sendViaWhatsAppBridge({
  to,
  message,
  pdfBuffer,
  pdfFilename,
  idempotencyKey,
}: SendWhatsAppParams): Promise<SendWhatsAppResult> {
  cleanDeduplicationCache();
  const dedupKey = computeDeduplicationKey(to, message, idempotencyKey);
  const existing = recentSends.get(dedupKey);

  if (existing && Date.now() - existing.timestamp < DEDUPLICATION_WINDOW_MS) {
    console.log(`[WhatsAppService] Duplicate submission detected for ${dedupKey}. Returning cached success.`);
    return {
      success: true,
      messageId: existing.messageId,
      isDuplicate: true,
    };
  }

  const bridgeUrl = getBridgeUrl();
  const secret = getBridgeSecret();

  try {
    const controller = new AbortController();
    const timeoutDuration = process.env.NODE_ENV === "test" ? 3000 : 30_000;
    const timeout = setTimeout(() => controller.abort(), timeoutDuration);

    const pdfBase64 = pdfBuffer ? Buffer.from(pdfBuffer).toString("base64") : undefined;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (secret) {
      headers["Authorization"] = `Bearer ${secret}`;
    }

    const res = await fetch(`${bridgeUrl}/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to,
        message,
        pdfBase64,
        pdfFilename,
        idempotencyKey,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      console.error("[WhatsAppService] Bridge send unauthorized. Check WHATSAPP_BRIDGE_SECRET.");
      return {
        success: false,
        error: "WhatsApp bridge authentication failed. Check WHATSAPP_BRIDGE_SECRET.",
      };
    }

    if (!res.ok) {
      return {
        success: false,
        error: data.error || `WhatsApp bridge responded with status ${res.status}`,
      };
    }

    // Cache message ID for deduplication
    recentSends.set(dedupKey, {
      timestamp: Date.now(),
      messageId: data.messageId,
    });

    return { success: true, messageId: data.messageId };
  } catch (err) {
    const isTimeout = (err as Error)?.name === "AbortError";
    return {
      success: false,
      error: isTimeout
        ? "WhatsApp bridge request timed out after 30 seconds"
        : err instanceof Error
        ? err.message
        : "WhatsApp bridge is unreachable",
    };
  }
}
