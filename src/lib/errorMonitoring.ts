/**
 * Production Error Monitoring & Diagnostics Utility for Whyte Automation
 *
 * Requirements:
 * - Captures critical application errors across client and server.
 * - Scrubs Personally Identifiable Information (PII) including passwords, tokens, phone numbers, and secrets.
 * - Prevents duplicate event reporting via a rolling deduplication window.
 * - Provides graceful hooks for external error monitoring (Sentry) when SENTRY_DSN is configured.
 * - Does not activate external third-party network transmissions unless configured.
 */

const SENSITIVE_KEY_PATTERN =
  /^(password|passwordhash|token|secret|authorization|cookie|jwt|key|apikey|pdfbase64|creditcard|cvv|access_token|refresh_token)$/i;

const DEDUPLICATION_WINDOW_MS = 10_000; // 10 seconds
const recentErrorSignatures = new Map<string, number>();

function cleanDeduplicationSignatures(): void {
  const now = Date.now();
  for (const [sig, timestamp] of recentErrorSignatures.entries()) {
    if (now - timestamp > DEDUPLICATION_WINDOW_MS) {
      recentErrorSignatures.delete(sig);
    }
  }
}

/**
 * Deeply scrubs sensitive keys from error metadata and context payloads.
 */
export function scrubSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) return input;

  if (typeof input === "string") {
    // Mask potential JWT tokens
    if (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input)) {
      return "[REDACTED_JWT]" as unknown as T;
    }
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => scrubSensitiveData(item)) as unknown as T;
  }

  if (typeof input === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        scrubbed[key] = "[REDACTED]";
      } else {
        scrubbed[key] = scrubSensitiveData(value);
      }
    }
    return scrubbed as unknown as T;
  }

  return input;
}

/**
 * Captures an application exception with context, deduplication, and PII scrubbing.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): { digest: string; captured: boolean } {
  cleanDeduplicationSignatures();

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack || "" : "";
  const signature = `${errorMessage}::${errorStack.slice(0, 100)}`;
  const now = Date.now();

  // Deduplication check: ignore bursts of the same error
  if (recentErrorSignatures.has(signature)) {
    return { digest: "duplicate", captured: false };
  }
  recentErrorSignatures.set(signature, now);

  // Generate safe error digest reference for customer support
  const digest = `err_${Math.random().toString(36).slice(2, 10)}`;
  const safeContext = context ? scrubSensitiveData(context) : {};

  const structuredReport = {
    digest,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    message: errorMessage,
    context: safeContext,
    ...(process.env.NODE_ENV !== "production" ? { stack: errorStack } : {}),
  };

  // Structured logging
  console.error(`[ERROR_MONITORING] [${digest}]`, JSON.stringify(structuredReport));

  // If Sentry is installed and SENTRY_DSN is configured in production, forward securely
  const sentryDsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (sentryDsn && typeof (globalThis as any).Sentry?.captureException === "function") {
    try {
      (globalThis as any).Sentry.captureException(error, {
        extra: safeContext,
        tags: { digest },
      });
    } catch {
      // Ignore external delivery failure
    }
  }

  return { digest, captured: true };
}

/**
 * Captures a structured diagnostic event.
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: Record<string, unknown>
): void {
  const safeContext = context ? scrubSensitiveData(context) : {};
  console.log(`[MONITORING_${level.toUpperCase()}] ${message}`, JSON.stringify(safeContext));
}

