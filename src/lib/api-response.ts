import { NextResponse } from "next/server";

/**
 * The single message returned whenever a request has no valid session.
 *
 * Lives in this leaf module (no database/NextAuth imports) so both the route
 * guards in `src/lib/api-auth.ts` and the request gate in `src/proxy.ts` can
 * share it without pulling the auth dependency graph into the proxy.
 */
export const UNAUTHENTICATED_MESSAGE = "Authentication required";

/**
 * Standardised API response + error envelope for the Whyte backend.
 *
 * Success (CREATE / UPDATE / DELETE):
 *   { success: true, data: <payload> }
 *
 * Error:
 *   {
 *     success: false,
 *     error: { code, message, field?, details?, dependencies? }
 *   }
 *
 * Success responses on GET routes are intentionally NOT wrapped: existing
 * consumers read the raw payload, so the envelope is applied to mutations only
 * (see `src/lib/apiClient.ts`, which understands both shapes). GET *errors* are
 * always wrapped by `handleApiError`.
 */

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "REQUIRED_FIELD"
  | "INVALID_FIELD"
  | "INVALID_ID"
  | "DUPLICATE_RECORD"
  | "DEPENDENCY_EXISTS"
  | "MINIMUM_VARIANT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "FILE_REQUIRED"
  | "FILE_TOO_LARGE"
  | "INVALID_FILE_TYPE"
  | "TOO_MANY_FILES"
  | "RATE_LIMITED"
  /** @deprecated Legacy alias for FILE_TOO_LARGE. Prefer FILE_TOO_LARGE. */
  | "PAYLOAD_TOO_LARGE"
  /** @deprecated Legacy alias for INVALID_FILE_TYPE. Prefer INVALID_FILE_TYPE. */
  | "UNSUPPORTED_MEDIA_TYPE"
  | "DATABASE_ERROR"
  | "INTERNAL_SERVER_ERROR";

/**
 * Machine readable description of the records that still reference a resource
 * the client tried to delete, so the UI can explain the conflict without
 * scraping the human message.
 */
export interface ApiDependencyInfo {
  /** Collection-style name, e.g. "quotationItems". */
  type: string;
  /** Human readable label, e.g. "quotation items". */
  label?: string;
  /** Number of records still referencing the resource. */
  count: number;
  /** Up to 20 sample IDs. */
  sampleIds?: Array<string | number>;
}

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
  dependencies?: ApiDependencyInfo[];
}

export interface ApiErrorBody {
  success: false;
  error: ApiErrorPayload;
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  REQUIRED_FIELD: 400,
  INVALID_FIELD: 400,
  INVALID_ID: 400,
  DUPLICATE_RECORD: 409,
  DEPENDENCY_EXISTS: 409,
  MINIMUM_VARIANT: 409,
  CONFLICT: 409,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  FILE_REQUIRED: 400,
  TOO_MANY_FILES: 400,
  RATE_LIMITED: 429,
  FILE_TOO_LARGE: 413,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_FILE_TYPE: 415,
  UNSUPPORTED_MEDIA_TYPE: 415,
  DATABASE_ERROR: 500,
  INTERNAL_SERVER_ERROR: 500,
};

/** Thrown by route handlers / services to produce a controlled API error. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly field?: string;
  readonly details?: Record<string, unknown>;
  readonly dependencies?: ApiDependencyInfo[];

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: {
      status?: number;
      field?: string;
      details?: Record<string, unknown>;
      dependencies?: ApiDependencyInfo[];
    }
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options?.status ?? STATUS_BY_CODE[code] ?? 500;
    this.field = options?.field;
    this.details = options?.details;
    this.dependencies = options?.dependencies;
  }
}

/** Builds the `{ success: false, error }` body without throwing. */
export function apiErrorBody(
  code: ApiErrorCode,
  message: string,
  options?: {
    field?: string;
    details?: Record<string, unknown>;
    dependencies?: ApiDependencyInfo[];
  }
): ApiErrorBody {
  const error: ApiErrorPayload = { code, message };
  if (options?.field) error.field = options.field;
  if (options?.details && Object.keys(options.details).length > 0) error.details = options.details;
  if (options?.dependencies && options.dependencies.length > 0) {
    error.dependencies = options.dependencies;
  }
  return { success: false, error };
}

/** `{ success: true, data }` envelope for mutating endpoints. */
export function apiSuccess<T>(
  data: T,
  options?: { status?: number; meta?: Record<string, unknown> }
): NextResponse<ApiSuccessBody<T> & { meta?: Record<string, unknown> }> {
  const status = options?.status ?? 200;
  const body: ApiSuccessBody<T> & { meta?: Record<string, unknown> } = { success: true, data };
  if (options?.meta) body.meta = options.meta;
  return NextResponse.json(body, { status });
}

/** Converts an ApiError into a response. */
export function apiErrorResponse(error: ApiError): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    apiErrorBody(error.code, error.message, {
      field: error.field,
      details: error.details,
      dependencies: error.dependencies,
    }),
    { status: error.status }
  );
}

function isZodError(error: unknown): error is { issues: Array<{ path?: unknown[]; message?: string; code?: string }> } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "ZodError" &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

function fieldFromZodPath(path: unknown[] | undefined): string | undefined {
  if (!path || path.length === 0) return undefined;
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Central error mapper. Converts ApiError / ZodError / Mongoose errors into the
 * standard envelope. Raw database messages, stack traces and internal paths are
 * NEVER forwarded to the client — only a generic, human readable message is.
 */
export function handleApiError(
  error: unknown,
  context: { logPrefix?: string } = {}
): NextResponse<ApiErrorBody> {
  const logPrefix = context.logPrefix ?? "API error";

  if (error instanceof ApiError) {
    return apiErrorResponse(error);
  }

  if (isZodError(error)) {
    const first = error.issues[0];
    const field = fieldFromZodPath(first?.path);
    const message = first?.message
      ? first.message
      : "The submitted data is invalid.";
    console.warn(`${logPrefix} validation error:`, error.issues);
    return apiErrorResponse(
      new ApiError("VALIDATION_ERROR", message, {
        field,
        details: {
          issues: error.issues.slice(0, 20).map((issue) => ({
            field: fieldFromZodPath(issue.path),
            message: issue.message,
          })),
        },
      })
    );
  }

  if (isDuplicateKeyError(error)) {
    console.warn(`${logPrefix} duplicate key error:`, (error as Error).message);
    return apiErrorResponse(
      new ApiError("DUPLICATE_RECORD", "A record with the same unique value already exists.")
    );
  }

  const name = (error as { name?: string })?.name;

  if (name === "ValidationError") {
    const mongooseErrors = (error as { errors?: Record<string, { message?: string }> }).errors;
    console.warn(`${logPrefix} mongoose validation error:`, mongooseErrors ?? error);
    const firstField = mongooseErrors ? Object.keys(mongooseErrors)[0] : undefined;
    const firstMessage = firstField ? mongooseErrors?.[firstField]?.message : undefined;
    return apiErrorResponse(
      new ApiError(
        "VALIDATION_ERROR",
        firstMessage ?? "The submitted data is invalid.",
        firstField ? { field: firstField } : undefined
      )
    );
  }

  if (name === "CastError") {
    console.warn(`${logPrefix} mongoose cast error:`, (error as Error).message);
    return apiErrorResponse(
      new ApiError("INVALID_ID", "The supplied identifier is not valid.", {
        field: (error as { path?: string }).path,
      })
    );
  }

  console.error(`${logPrefix} unhandled error:`, error);
  return apiErrorResponse(
    new ApiError(
      "INTERNAL_SERVER_ERROR",
      "Something went wrong on our end. Please try again."
    )
  );
}

/**
 * Reads and parses a JSON request body.
 * Throws a controlled VALIDATION_ERROR when the payload is not valid JSON.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Invalid JSON request body.");
  }
}

/** Ensures the parsed body is a plain object (not an array / primitive / null). */
export function asObjectBody(body: unknown, message = "Invalid request body."): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("VALIDATION_ERROR", message);
  }
  return body as Record<string, unknown>;
}

/** Parses a route-parameter style numeric ID. Rejects NaN, empty and non-numeric values. */
export function parseNumericId(raw: unknown, field = "id"): number {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new ApiError("INVALID_ID", `Invalid ${field}.`, { field });
    }
    return raw;
  }

  if (typeof raw !== "string") {
    throw new ApiError("INVALID_ID", `Invalid ${field}.`, { field });
  }

  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) {
    throw new ApiError("INVALID_ID", `Invalid ${field}.`, { field });
  }

  return Number(trimmed);
}

/**
 * Existence guard for a loaded document. Every read-modify-write and delete flow
 * must call this so a missing record is a clean 404 instead of a silent no-op
 * that reports success.
 */
export function assertFound<T>(
  document: T | null | undefined,
  message: string,
  options?: { field?: string }
): T {
  if (document === null || document === undefined) {
    throw new ApiError("NOT_FOUND", message, options?.field ? { field: options.field } : undefined);
  }
  return document;
}