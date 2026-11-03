import { after } from "next/server";
import { googleCalendarConfig } from "./config";
import { runWorker } from "./sync";

/**
 * Sends what was just queued to Google right after the response has gone out, so a change shows up in the calendar within
 * seconds instead of waiting for the scheduled worker. The scheduled worker remains the safety net (retries, repairs).
 * Does nothing until Google Calendar is configured, and never affects the request that triggered it.
 */
export function kickCalendarSync(): void {
  if (!googleCalendarConfig().configured) return;
  try {
    after(async () => {
      try {
        await runWorker({ maxItems: 25, budgetMs: 10_000, skipReconcile: true });
      } catch (error) {
        console.error("[google-calendar] immediate sync failed:", error instanceof Error ? error.message : "unknown");
      }
    });
  } catch {
    /* not inside a request (a script or a test): the scheduled worker will pick it up */
  }
}
