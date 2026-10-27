/**
 * API request timing log.
 *
 * Appends one JSON line per `/api/*` request to `logs/api-timing.log` (project root) with the time of the call, the
 * method, the path, the names of the query parameters (never their values), the status code and the response time in
 * milliseconds, measured from the moment the Node HTTP server receives the request until the response is finished.
 * Request bodies, headers, cookies and query values are never written.
 *
 *   {"time":"2026-10-28T09:12:03.411Z","method":"GET","path":"/api/quotations","query":["page","pageSize"],"status":200,"ms":184.7}
 *
 * - On by default for `next dev`; off for production builds and on Vercel (read-only file system).
 *   Set API_TIMING_LOG=1 to force it on (for example `next start` locally) or API_TIMING_LOG=0 to turn it off.
 * - API_TIMING_LOG_FILE=<path> changes the file. When the file passes 5 MB it is renamed to `<file>.old`
 *   (replacing the previous `.old`) the next time the server starts.
 *
 * Next calls `register()` once per server instance, before it serves requests (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 */

import type { IncomingMessage, Server, ServerResponse } from "node:http";

const MAX_BYTES = 5 * 1024 * 1024;

function isEnabled(): boolean {
  const flag = process.env.API_TIMING_LOG;
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV === "development" && !process.env.VERCEL;
}

export async function register(): Promise<void> {
  // The Node-only code stays INSIDE this positive runtime check: Next compiles this file for the Edge runtime as well
  // and removes the block there, whereas an early `return` for other runtimes would leave the `node:` imports in the
  // Edge bundle and break the build.
  if (process.env.NEXT_RUNTIME === "nodejs" && isEnabled()) {
    const globalState = globalThis as typeof globalThis & { __apiTimingLogInstalled?: boolean };
    if (globalState.__apiTimingLogInstalled) return;
    globalState.__apiTimingLogInstalled = true;

    const http = await import("node:http");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const file = path.resolve(process.env.API_TIMING_LOG_FILE ?? path.join(process.cwd(), "logs", "api-timing.log"));
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const existing = await fs.stat(file).catch(() => null);
      if (existing && existing.size > MAX_BYTES) await fs.rename(file, `${file}.old`);
    } catch (error) {
      console.warn("[api-timing] could not prepare the log file; timing log disabled:", error);
      return;
    }

    // Lines are queued and written in order; a failed write never affects the request being served.
    let pending: Promise<void> = Promise.resolve();
    const append = (line: string) => {
      pending = pending.then(() => fs.appendFile(file, `${line}
`)).catch(() => undefined);
    };

    const originalEmit = http.Server.prototype.emit;
    http.Server.prototype.emit = function patchedEmit(this: Server, event: string | symbol, ...args: unknown[]) {
      if (event === "request") {
        const req = args[0] as IncomingMessage;
        const res = args[1] as ServerResponse;
        const target = req.url ?? "";
        if (target.startsWith("/api/") || target === "/api") {
          const startedAt = performance.now();
          const time = new Date().toISOString();
          let written = false;
          const finish = () => {
            if (written) return;
            written = true;
            const [pathname, queryString = ""] = target.split("?");
            const query = queryString
              .split("&")
              .map((pair) => pair.split("=")[0])
              .filter(Boolean);
            append(
              JSON.stringify({
                time,
                method: req.method ?? "GET",
                path: pathname,
                query,
                // A request closed before the response finished (client went away) is logged with status 0.
                status: res.writableFinished ? res.statusCode : 0,
                ms: Math.round((performance.now() - startedAt) * 10) / 10,
              })
            );
          };
          res.once("finish", finish);
          res.once("close", finish);
        }
      }
      return (originalEmit as (this: unknown, event: string | symbol, ...rest: unknown[]) => boolean).call(this, event, ...args);
    } as typeof http.Server.prototype.emit;

    console.log(`[api-timing] logging /api requests to ${file}`);
  }
}
