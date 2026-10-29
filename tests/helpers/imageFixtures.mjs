/**
 * Small image fixtures for upload tests. `png()` is a real, decodable PNG (so a browser can render it); `jpeg()`
 * and `webp()` have valid headers with the requested pixel size, which is all the server reads.
 */
import { deflateSync, crc32 } from "node:zlib";

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour RGBA PNG of the given size. */
export function png(width = 64, height = 64, [r, g, b, a] = [216, 91, 131, 255]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b, a]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** JPEG header (SOI + SOF0) declaring the given size; not a decodable picture. */
export function jpeg(width = 64, height = 64) {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(17, 0); // segment length
  sof[2] = 8; // precision
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 3; // components
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0]), sof, Buffer.from([0xff, 0xd9]), Buffer.alloc(40, 9)]);
}

/** WebP (VP8X) header declaring the given size; not a decodable picture. */
export function webp(width = 64, height = 64) {
  const dims = Buffer.alloc(10);
  dims.writeUIntLE(width - 1, 4, 3);
  dims.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([Buffer.from("WEBP"), Buffer.from("VP8X"), Buffer.from([10, 0, 0, 0]), dims, Buffer.alloc(40, 1)]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, body]);
}
