/**
 * Company logo customization: settings validation, header-based image dimension checks, and static guards that keep
 * the feature server-authoritative and tenant-safe. The API behaviour (registration, Company Settings, tenant
 * isolation) is in tests/company-logo-customization.test.mjs; the live preview is in
 * tests/company-logo-customization.browser.mjs.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/company-logo-customization.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { ApiError } from "../src/lib/api-response";
import { assertLogoDimensions, readImageDimensions } from "../src/lib/imageDimensions";
import { DEFAULT_LOGO_SETTINGS, LOGO_UPLOAD_SPECS, logoDimensionProblem, logoFileSizeProblem, logoSpecSummary, normalizeLogoSettings, parseLogoSettings, sameLogoSettings } from "../src/lib/logoSettings";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

function pngOf(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(1))), chunk("IEND", Buffer.alloc(0))]);
}
function jpegOf(width: number, height: number): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(17, 0);
  sof[2] = 8;
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0]), sof, Buffer.alloc(20)]);
}
function webpOf(kind: "VP8X" | "VP8L" | "VP8 ", width: number, height: number): Buffer {
  const head = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from(kind), Buffer.alloc(4)]);
  const body = Buffer.alloc(40);
  if (kind === "VP8X") {
    body.writeUIntLE(width - 1, 4, 3);
    body.writeUIntLE(height - 1, 7, 3);
  } else if (kind === "VP8L") {
    body[0] = 0x2f;
    body.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  } else {
    body[3] = 0x9d;
    body[4] = 0x01;
    body[5] = 0x2a;
    body.writeUInt16LE(width, 6);
    body.writeUInt16LE(height, 8);
  }
  return Buffer.concat([head, body]);
}

function rejects(fn: () => unknown, field: string, label: string) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ApiError, `${label}: ApiError`);
    assert.equal((error as ApiError).field, field, `${label}: field`);
    return;
  }
  assert.fail(`${label}: expected a rejection`);
}

function main() {
  // ── settings ──
  const ok = parseLogoSettings({ logoFit: "cover", logoBackground: "transparent", logoPadding: "0", logoRadius: 16 });
  assert.deepEqual(ok, { ok: true, value: { fit: "cover", background: "transparent", padding: 0, radius: 16 } });
  assert.deepEqual(parseLogoSettings({}), { ok: true, value: DEFAULT_LOGO_SETTINGS });
  assert.deepEqual(parseLogoSettings({ logoPadding: "12" }, { fit: "cover", background: "white", padding: 1, radius: 1 }), { ok: true, value: { fit: "cover", background: "white", padding: 12, radius: 1 } });
  pass("valid settings parse; missing keys keep the base values");

  const invalid: Array<[Record<string, unknown>, string]> = [
    [{ logoFit: "stretch" }, "logoFit"],
    [{ logoFit: 3 }, "logoFit"],
    [{ logoBackground: "red" }, "logoBackground"],
    [{ logoPadding: "13" }, "logoPadding"],
    [{ logoPadding: "-1" }, "logoPadding"],
    [{ logoPadding: "1.5" }, "logoPadding"],
    [{ logoPadding: "abc" }, "logoPadding"],
    [{ logoPadding: "" }, "logoPadding"],
    [{ logoRadius: "17" }, "logoRadius"],
    [{ logoRadius: "1e1" }, "logoRadius"],
    [{ logoRadius: null }, "logoRadius"],
  ];
  for (const [input, field] of invalid) {
    const result = parseLogoSettings(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.ok === false && result.field, field, JSON.stringify(input));
  }
  pass("out-of-range, non-integer, malformed and wrongly typed settings are rejected, never clamped");

  assert.deepEqual(normalizeLogoSettings(undefined), DEFAULT_LOGO_SETTINGS);
  assert.deepEqual(normalizeLogoSettings({ fit: "cover", background: "weird", padding: 99, radius: 3 }), DEFAULT_LOGO_SETTINGS, "a corrupt stored value falls back to the defaults");
  assert.deepEqual(normalizeLogoSettings({ fit: "cover", background: "transparent", padding: 4, radius: 2 }), { fit: "cover", background: "transparent", padding: 4, radius: 2 });
  assert.ok(sameLogoSettings(DEFAULT_LOGO_SETTINGS, { ...DEFAULT_LOGO_SETTINGS }) && !sameLogoSettings(DEFAULT_LOGO_SETTINGS, { ...DEFAULT_LOGO_SETTINGS, radius: 7 }));
  pass("stored settings are normalised safely (legacy companies get the defaults)");

  // ── dimensions ──
  assert.deepEqual(readImageDimensions(pngOf(300, 90), "image/png"), { width: 300, height: 90 });
  assert.deepEqual(readImageDimensions(jpegOf(640, 480), "image/jpeg"), { width: 640, height: 480 });
  assert.deepEqual(readImageDimensions(webpOf("VP8X", 400, 120), "image/webp"), { width: 400, height: 120 });
  assert.deepEqual(readImageDimensions(webpOf("VP8L", 250, 80), "image/webp"), { width: 250, height: 80 });
  assert.deepEqual(readImageDimensions(webpOf("VP8 ", 128, 64), "image/webp"), { width: 128, height: 64 });
  assert.equal(readImageDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png"), null, "truncated header");
  assert.equal(readImageDimensions(Buffer.alloc(4), "image/gif"), null, "unsupported type");
  pass("pixel dimensions are read from PNG, JPEG and WebP (VP8X / VP8L / VP8) headers");

  // Main logo: 64×32 to 4096×4096, between 1:2 (tall) and 8:1 (wide).
  assertLogoDimensions(pngOf(64, 32), "image/png", "logo");
  assertLogoDimensions(pngOf(600, 200), "image/png", "logo");
  assertLogoDimensions(pngOf(4096, 4096), "image/png", "logo");
  assertLogoDimensions(pngOf(256, 32), "image/png", "logo");
  assertLogoDimensions(pngOf(100, 200), "image/png", "logo");
  rejects(() => assertLogoDimensions(pngOf(63, 40), "image/png", "logo"), "logo", "too narrow");
  rejects(() => assertLogoDimensions(pngOf(100, 31), "image/png", "logo"), "logo", "too short");
  rejects(() => assertLogoDimensions(pngOf(4097, 1000), "image/png", "logo"), "logo", "too wide");
  rejects(() => assertLogoDimensions(pngOf(900, 100), "image/png", "logo"), "logo", "wider than 8:1");
  rejects(() => assertLogoDimensions(pngOf(100, 201), "image/png", "logo"), "logo", "taller than 1:2");
  rejects(() => assertLogoDimensions(pngOf(0, 0), "image/png", "logo"), "logo", "zero size");
  rejects(() => assertLogoDimensions(Buffer.alloc(30), "image/png", "logo"), "logo", "unreadable header");
  // Compact logo: square-ish (4:5 to 5:4), 64 to 1024 px.
  assertLogoDimensions(pngOf(64, 64), "image/png", "compactLogo");
  assertLogoDimensions(pngOf(256, 256), "image/png", "compactLogo");
  assertLogoDimensions(pngOf(1024, 820), "image/png", "compactLogo");
  rejects(() => assertLogoDimensions(pngOf(63, 63), "image/png", "compactLogo"), "compactLogo", "compact too small");
  rejects(() => assertLogoDimensions(pngOf(1025, 1025), "image/png", "compactLogo"), "compactLogo", "compact too large");
  rejects(() => assertLogoDimensions(pngOf(600, 200), "image/png", "compactLogo"), "compactLogo", "a wordmark is not a compact logo");
  rejects(() => assertLogoDimensions(pngOf(4097, 100), "image/png", "compactLogo"), "compactLogo", "too wide");
  // Separate file-size limits, with messages that name the upload.
  assert.equal(LOGO_UPLOAD_SPECS.logo.maxBytes, 2 * 1024 * 1024);
  assert.equal(LOGO_UPLOAD_SPECS.compactLogo.maxBytes, 1024 * 1024);
  assert.equal(logoFileSizeProblem("logo", 2 * 1024 * 1024), null);
  assert.match(logoFileSizeProblem("compactLogo", 1024 * 1024 + 1) ?? "", /compact logo must be 1MB or smaller/);
  assert.match(logoFileSizeProblem("logo", 0) ?? "", /empty/);
  assert.match(logoDimensionProblem("compactLogo", { width: 600, height: 200 }) ?? "", /square/);
  assert.match(logoSpecSummary("logo"), /2MB.*64×32 to 4096×4096.*600 × 200/);
  assert.match(logoSpecSummary("compactLogo"), /1MB.*64×64 to 1024×1024.*256 × 256/);
  pass("the main logo and the compact logo each have their own size, pixel and aspect-ratio rules; unreadable images are rejected");

  // ── static guards ──
  const logoRoute = read("src", "app", "api", "company", "logo", "route.ts");
  assert.ok(/withPermission\("company:edit"/.test(logoRoute) && /actor\.companyId/.test(logoRoute), "the logo API uses the session actor's company");
  assert.ok(!/formData\.get\("companyId"\)|searchParams|params\.companyId/.test(logoRoute), "the logo API never reads a company id from the request");
  assert.ok(logoRoute.indexOf("deleteOwnBrandingAsset(existing.logoPublicId") > logoRoute.indexOf("Company.findByIdAndUpdate"), "old files are deleted only after the update");
  const assets = read("src", "lib", "companyLogoAssets.ts");
  assert.ok(/isOwnBrandingAsset\(publicId, companyId\)/.test(assets), "assets are deleted only from the company's own branding folder");
  const registerRoute = read("src", "app", "api", "company", "register", "route.ts");
  assert.ok(/readValidatedLogo/.test(registerRoute) && !/new URL\(|fetch\(/.test(registerRoute), "registration accepts validated uploads only, never a remote URL");
  assert.ok(/delete data\.logoUrl/.test(read("src", "app", "api", "company", "route.ts")), "the profile PATCH still cannot set a logo URL");
  const model = read("src", "models", "Company.ts");
  assert.ok(/compactLogoUrl/.test(model) && /logoSettings/.test(model) && /LOGO_PADDING_RANGE/.test(model), "settings are bounded in the model");
  const customizer = read("src", "components", "company", "LogoCustomizer.tsx");
  assert.ok(/<AnimatedLogo collapsed=\{false\}/.test(customizer) && /<AnimatedLogo collapsed \/>/.test(customizer) && /<WhyteLoader/.test(customizer), "the preview renders the real sidebar logo and loader");
  assert.ok(!/fetch\(|localStorage|sessionStorage/.test(customizer), "the customizer persists nothing itself");
  pass("static guards: session-derived company, delete-after-save, own-folder deletes, upload-only, bounded model, real preview components");
}

try {
  main();
  console.log(`\n${count} passed`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
