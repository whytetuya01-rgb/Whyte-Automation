import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

/**
 * Server-side Cloudinary client used by `/api/upload`.
 *
 * The API secret never leaves this module: nothing here is imported from a
 * Client Component, and the credentials are read only from non-public
 * environment variables.
 *
 * Credentials are resolved on EVERY call instead of once at module scope:
 *  - a module-scope `throw` happens while the route module is being evaluated,
 *    i.e. outside the handler's try/catch, so it would surface as an opaque
 *    framework 500 instead of a controlled API error;
 *  - reading late means editing `.env` in development takes effect without a
 *    restart, and only the runtime that actually serves the request needs the
 *    variable to be present.
 *
 * There are deliberately NO fallback/default values. Signing a request with a
 * placeholder key produces a confusing upstream 401 ("Unknown API key
 * placeholder_key"), so an unconfigured uploader must fail loudly and name
 * exactly which variables are unusable.
 */

const CLOUD_NAME_VAR = "CLOUDINARY_CLOUD_NAME";
const API_KEY_VAR = "CLOUDINARY_API_KEY";
const API_SECRET_VAR = "CLOUDINARY_API_SECRET";

const REQUIRED_VARS = [CLOUD_NAME_VAR, API_KEY_VAR, API_SECRET_VAR] as const;

/**
 * Values that are clearly not real credentials — the documentation stubs that
 * ship in the template `.env`. Treating them as "missing" keeps a
 * half-configured deployment from ever reaching Cloudinary, so the operator
 * gets an actionable configuration error instead of an upstream 401.
 */
const PLACEHOLDER_VALUE = /placeholder|replace[-_ ]?me|your[-_]|change[-_]?me|dummy|xxx/i;

interface CloudinaryCredentials {
  cloud_name: string;
  api_key: string;
  api_secret: string;
}

/** Raised when the uploader cannot be configured from the environment. */
export class CloudinaryConfigError extends Error {
  /** Environment variables that are absent, blank or still placeholders. */
  readonly missing: string[];

  constructor(missing: string[]) {
    super("Cloudinary environment variables are not configured.");
    this.name = "CloudinaryConfigError";
    this.missing = missing;
  }
}

/**
 * Raised when Cloudinary is reachable but refused the credentials.
 *
 * The upstream message is intentionally discarded: Cloudinary echoes the
 * submitted API key back ("Unknown API key <key>"), which must never be
 * forwarded to the browser. The actionable detail goes to the server log.
 */
export class CloudinaryAuthError extends Error {
  /** The HTTP status Cloudinary returned, when it supplied one. */
  readonly httpCode: number | undefined;

  constructor(httpCode?: number) {
    super("Cloudinary authentication failed.");
    this.name = "CloudinaryAuthError";
    this.httpCode = httpCode;
  }
}

/**
 * Names the Cloudinary variables that are absent, blank or still placeholders.
 *
 * Exported so a route can fail fast with a clear, actionable message before
 * spending a request on an upload that cannot succeed.
 */
export function getMissingCloudinaryEnvVars(): string[] {
  return REQUIRED_VARS.filter((name) => {
    const value = process.env[name]?.trim();
    return !value || PLACEHOLDER_VALUE.test(value);
  });
}

/** Resolves the credentials, or throws listing everything that is unusable. */
function readCredentials(): CloudinaryCredentials {
  const missing = getMissingCloudinaryEnvVars();
  if (missing.length > 0) {
    throw new CloudinaryConfigError(missing);
  }

  return {
    cloud_name: process.env[CLOUD_NAME_VAR]!.trim(),
    api_key: process.env[API_KEY_VAR]!.trim(),
    api_secret: process.env[API_SECRET_VAR]!.trim(),
  };
}

/** Configures the SDK for this request and returns the client. */
function configure(): { credentials: CloudinaryCredentials; client: typeof cloudinary } {
  const credentials = readCredentials();
  cloudinary.config({
    cloud_name: credentials.cloud_name,
    api_key: credentials.api_key,
    api_secret: credentials.api_secret,
  });
  return { credentials, client: cloudinary };
}

function readHttpStatus(error: unknown): number | undefined {
  const candidates = [
    (error as { http_code?: unknown } | null)?.http_code,
    (error as { error?: { http_code?: unknown } } | null)?.error?.http_code,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number") return candidate;
  }
  return undefined;
}

/** Removes the live key/secret from any text bound for a response or a log. */
function redact(message: string, credentials: CloudinaryCredentials): string {
  let output = message;
  for (const secret of [credentials.api_key, credentials.api_secret]) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output;
}

/**
 * Maps an SDK failure onto an error that is safe to surface.
 *
 * Authentication failures become `CloudinaryAuthError` (fixed message, no
 * upstream text). Anything else keeps its message so operators can still see
 * why Cloudinary refused, minus the credentials themselves.
 */
function toSafeError(error: unknown, credentials: CloudinaryCredentials): Error {
  const status = readHttpStatus(error);
  if (status === 401 || status === 403) {
    return new CloudinaryAuthError(status);
  }

  if (error instanceof Error) {
    return new Error(redact(error.message, credentials));
  }
  return new Error("Cloudinary request failed.");
}

interface UploadedImage {
  url: string;
  publicId: string;
}

export async function uploadImage(
  fileBuffer: Buffer,
  folder = "whyte/products"
): Promise<UploadedImage> {
  const { credentials, client } = configure();

  return new Promise<UploadedImage>((resolve, reject) => {
    const uploadStream = client.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result) => {
        if (error || !result) {
          reject(toSafeError(error, credentials));
          return;
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    Readable.from(fileBuffer).pipe(uploadStream);
  });
}

export async function deleteImage(publicId: string) {
  const { credentials, client } = configure();

  try {
    return await client.uploader.destroy(publicId, { resource_type: "image" });
  } catch (error) {
    throw toSafeError(error, credentials);
  }
}