/**
 * Development & Audit Performance Tracing Utility
 *
 * Provides high-resolution timing measurements for API request lifecycles:
 * - Route initialization & middleware transit
 * - NextAuth session resolution
 * - Tenant context & session guard lookups
 * - MongoDB connection acquisition
 * - Database query durations
 * - Business logic transformations & serialization
 */

export interface PerfStage {
  name: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

declare global {
  var __whyteProcessStartedAt: number | undefined;
  var __whyteWarmRoutes: Set<string> | undefined;
}

if (!global.__whyteProcessStartedAt) {
  global.__whyteProcessStartedAt = performance.now();
}

if (!global.__whyteWarmRoutes) {
  global.__whyteWarmRoutes = new Set();
}

export class RequestTracer {
  public readonly id: string;
  public readonly method: string;
  public readonly path: string;
  public readonly startTime: number;
  public readonly isColdRoute: boolean;
  private lastTime: number;
  private stages: PerfStage[] = [];
  private completed = false;

  constructor(method: string, path: string, arrivalTimeMs?: number) {
    this.method = method.toUpperCase();
    this.path = path;
    this.id = `req_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-4)}`;

    const routeKey = `${this.method} ${this.path}`;
    this.isColdRoute = !global.__whyteWarmRoutes!.has(routeKey);
    global.__whyteWarmRoutes!.add(routeKey);

    const now = performance.now();
    this.startTime = now;
    this.lastTime = now;

    // If middleware recorded arrival time, measure transit/compilation gap
    if (arrivalTimeMs && arrivalTimeMs > 0 && arrivalTimeMs <= now) {
      const transitGap = Number((now - arrivalTimeMs).toFixed(2));
      this.stages.push({
        name: "Route Initialization & Middleware Transit",
        durationMs: transitGap,
        metadata: { arrivalGap: true },
      });
    } else {
      this.stages.push({
        name: "Route Initialization",
        durationMs: 0,
        metadata: { note: "measured from handler entry" },
      });
    }
  }

  /**
   * Mark a discrete stage duration since the last checkpoint
   */
  public mark(stageName: string, metadata?: Record<string, unknown>): number {
    const now = performance.now();
    const durationMs = Number((now - this.lastTime).toFixed(2));
    this.stages.push({ name: stageName, durationMs, metadata });
    this.lastTime = now;
    return durationMs;
  }

  /**
   * Measure an async operation explicitly
   */
  public async measure<T>(stageName: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const durationMs = Number((performance.now() - start).toFixed(2));
      this.stages.push({ name: stageName, durationMs, metadata });
      this.lastTime = performance.now();
    }
  }

  /**
   * Finalize and output structured [PERF] timing report
   */
  public end(additionalMetadata?: Record<string, unknown>): {
    id: string;
    totalMs: number;
    stages: PerfStage[];
  } {
    if (this.completed) {
      return { id: this.id, totalMs: 0, stages: this.stages };
    }
    this.completed = true;

    const totalMs = Number((performance.now() - this.startTime).toFixed(2));

    // Format output exactly as specified in the audit prompt
    const lines: string[] = [
      `\n[PERF] ${this.method} ${this.path}`,
      `Request ID: ${this.id} (${this.isColdRoute ? "COLD" : "WARM"})`,
    ];

    for (const stage of this.stages) {
      const padName = (stage.name + ":").padEnd(36, " ");
      const extra = stage.metadata ? ` (${JSON.stringify(stage.metadata)})` : "";
      lines.push(`${padName} ${stage.durationMs.toFixed(1).padStart(7, " ")} ms${extra}`);
    }

    lines.push(`-----------------------------------------------------`);
    lines.push(`Total:                               ${totalMs.toFixed(1).padStart(7, " ")} ms\n`);

    console.log(lines.join("\n"));

    return { id: this.id, totalMs, stages: this.stages };
  }
}

/**
 * Creates or extracts a request tracer from incoming Next.js Request
 */
export function createRequestTracer(req: Request | null, method: string, path: string): RequestTracer {
  let arrivalTimeMs: number | undefined;
  if (req && req.headers) {
    const startHeader = req.headers.get("x-request-start");
    if (startHeader) {
      const parsed = parseFloat(startHeader);
      if (!isNaN(parsed) && parsed > 0) {
        arrivalTimeMs = parsed;
      }
    }
  }
  return new RequestTracer(method, path, arrivalTimeMs);
}
