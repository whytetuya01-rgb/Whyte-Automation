import { notify } from "@/lib/notify";

/**
 * Client-side API wrapper.
 *
 * Guarantees for every call made through here:
 *  - the backend `{ success, data }` / `{ success, error }` envelope is unwrapped
 *  - legacy GET shapes (plain objects) keep working untouched
 *  - errors always carry a human readable message — never "undefined",
 *    "null", "NaN" or "[object Object]"
 */

export interface ApiClientErrorShape {
  status: number;
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export class ApiClientError extends Error implements ApiClientErrorShape {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  readonly details?: Record<string, unknown>;

  constructor(shape: ApiClientErrorShape) {
    super(shape.message);
    this.name = "ApiClientError";
    this.status = shape.status;
    this.code = shape.code;
    this.field = shape.field;
    this.details = shape.details;
  }
}

const USELESS_MESSAGES = new Set(["", "undefined", "null", "NaN", "[object Object]"]);

/** Coerces anything into a safe, displayable message string. */
export function safeMessage(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return USELESS_MESSAGES.has(trimmed) ? fallback : trimmed;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : fallback;
  }
  if (Array.isArray(value) && value.length > 0) {
    return safeMessage(value[0], fallback);
  }
  return fallback;
}

function readErrorFromBody(body: unknown, status: number): ApiClientErrorShape {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    const error = record.error;

    if (typeof error === "string") {
      return { status, code: "REQUEST_FAILED", message: safeMessage(error, "Request failed.") };
    }

    if (typeof error === "object" && error !== null) {
      const errorRecord = error as Record<string, unknown>;
      return {
        status,
        code: safeMessage(errorRecord.code, "REQUEST_FAILED"),
        message: safeMessage(errorRecord.message, "Request failed."),
        field: typeof errorRecord.field === "string" ? errorRecord.field : undefined,
        details:
          typeof errorRecord.details === "object" && errorRecord.details !== null
            ? (errorRecord.details as Record<string, unknown>)
            : undefined,
      };
    }

    if (record.message !== undefined) {
      return {
        status,
        code: "REQUEST_FAILED",
        message: safeMessage(record.message, "Request failed."),
      };
    }
  }

  return {
    status,
    code: status === 0 ? "NETWORK_ERROR" : "REQUEST_FAILED",
    message:
      status === 0
        ? "Could not reach the server. Please check your connection and try again."
        : `Request failed with status ${status}.`,
  };
}

export interface ApiFetchOptions extends RequestInit {
  /** Human readable fallback used when the response carries no usable message. */
  fallbackMessage?: string;
}

export async function apiFetch<T = unknown>(
  input: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { fallbackMessage = "Request failed.", ...init } = options;

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiClientError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Could not reach the server. Please check your connection and try again.",
    });
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    throw new ApiClientError({
      ...readErrorFromBody(body, response.status),
      message: safeMessage(
        (body as { error?: { message?: string } } | null)?.error?.message,
        fallbackMessage
      ),
    });
  }

  // A 200 that still reports failure (e.g. a non-standard handler) is an error.
  if (typeof body === "object" && body !== null && (body as { success?: unknown }).success === false) {
    throw new ApiClientError({
      ...readErrorFromBody(body, response.status),
      message: safeMessage(
        (body as { error?: { message?: string } }).error?.message,
        fallbackMessage
      ),
    });
  }

  // Unwrap the standard success envelope; keep legacy GET shapes as-is.
  if (typeof body === "object" && body !== null && "data" in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }

  return body as T;
}

export const apiJson = {
  get: <T = unknown>(url: string, options?: ApiFetchOptions) =>
    apiFetch<T>(url, { ...options, method: "GET" }),
  post: <T = unknown>(url: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(url, {
      ...options,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T = unknown>(url: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(url, {
      ...options,
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T = unknown>(url: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(url, {
      ...options,
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T = unknown>(url: string, options?: ApiFetchOptions) =>
    apiFetch<T>(url, { ...options, method: "DELETE" }),
};

/** Extracts a displayable message from any thrown value. */
export function toErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof ApiClientError) return safeMessage(error.message, fallback);
  if (error instanceof Error) return safeMessage(error.message, fallback);
  return safeMessage(error, fallback);
}

/**
 * Single entry point for showing an API failure to the user. Replace every
 * `notify.error("Action failed", (err as Error).message)` pattern with this.
 */
export function notifyApiError(error: unknown, title = "Action failed", fallback?: string): void {
  notify.error(title, toErrorMessage(error, fallback));
}
