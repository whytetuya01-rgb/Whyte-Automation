import { ApiError } from "@/lib/api-response";
import { logoDimensionProblem, type LogoUploadKind } from "@/lib/logoSettings";

/**
 * Pixel dimensions read from an image's own header (PNG, JPEG, WebP), without decoding it. Used to enforce logo size
 * limits on the server: the client can claim anything, the bytes decide. Returns `null` when the header is
 * truncated or not parseable.
 */
export function readImageDimensions(buffer: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png") return readPng(buffer);
    if (mime === "image/jpeg") return readJpeg(buffer);
    if (mime === "image/webp") return readWebp(buffer);
  } catch {
    return null;
  }
  return null;
}

function readPng(buffer: Buffer) {
  // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
  if (buffer.length < 24 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpeg(buffer: Buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start-of-frame markers carry the size (all SOFn except DHT 0xC4, JPG 0xC8, DAC 0xCC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

function readWebp(buffer: Buffer) {
  if (buffer.length < 30) return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (chunk === "VP8 ") {
    // frame tag(3) start code 9d 01 2a(3) width(2, 14 bits) height(2, 14 bits)
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Throws a field-level `ApiError` unless the image meets that upload's pixel size and aspect-ratio rules. */
export function assertLogoDimensions(buffer: Buffer, mime: string, kind: LogoUploadKind): { width: number; height: number } {
  const size = readImageDimensions(buffer, mime);
  if (!size || size.width <= 0 || size.height <= 0) {
    throw new ApiError("VALIDATION_ERROR", "The image could not be read. Please upload a different file.", { field: kind });
  }
  const problem = logoDimensionProblem(kind, size);
  if (problem) throw new ApiError("VALIDATION_ERROR", problem, { field: kind, details: size });
  return size;
}
