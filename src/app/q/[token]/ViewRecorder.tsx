"use client";

import { useEffect } from "react";

/** Tokens already reported by this page load (effects can run twice in development). */
const reported = new Set<string>();

/**
 * Tells the server the client opened the quotation. Runs in the browser only, so link-preview fetchers (WhatsApp,
 * email scanners) that load the page without running scripts are not counted. Sent once per page load.
 */
export default function ViewRecorder({ token }: { token: string }) {
  useEffect(() => {
    if (reported.has(token)) return;
    reported.add(token);
    fetch("/api/public/quotation-links/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      keepalive: true,
    }).catch(() => undefined);
  }, [token]);
  return null;
}
