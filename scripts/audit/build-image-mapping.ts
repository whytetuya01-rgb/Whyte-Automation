/**
 * PHASE 1 — AUDIT ONLY. Makes zero writes to Mongo or Cloudinary.
 *
 * Parses the 72 "Tactus Edge" ("Edge Color Touch ...") products and the 62
 * "Color-Edge-*" image filenames into a normalized feature signature each
 * (module size, switch count + amp/way qualifiers, fan count, socket count +
 * amp qualifiers, dimmer count, curtain/dual-curtain/doorbell/scene flags),
 * then matches on EXACT signature equality only. No fuzzy/"looks similar"
 * matching. Outputs scripts/audit/image-mapping-proposal.json plus a console
 * summary split into SAFE MATCH / REVIEW / NO MATCH.
 *
 *   node scripts/run-script.js scripts/audit/build-image-mapping.ts
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectMongoDB } from "../../src/lib/mongodb";
import { Product } from "../../src/models";

const ZIP_DIR = path.resolve(
  process.env.USERPROFILE || "",
  "AppData/Local/Temp/claude/c--Project-whyte-quotation/59afa953-0f65-436a-aeee-33eb791a3494/scratchpad/product-image-zip"
);

interface Signature {
  switchCount: number | null;
  switchDetail: string | null; // e.g. "1-16a", "2-16a", "1-2way", "all-6a", "4-16a"
  fanCount: number | null;
  socketCount: number | null;
  socketDetail: string | null; // e.g. "6a", "16a", "1-16a"
  dimmerCount: number | null;
  curtain: "single" | "dual" | null;
  doorbell: boolean;
  sceneCount: number | null;
  other: string | null; // anything unrecognized that should force a REVIEW
}

function normDetail(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return raw
    .toLowerCase()
    .replace(/switch/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^-|-$/g, "")
    .trim() || null;
}

/**
 * Strips a redundant leading count-prefix equal to the feature's own total
 * count — e.g. socketCount=2 with detail "2-16a" means "both sockets are
 * 16A", which some source filenames write as just "16a". Normalizing both
 * conventions to the same bare amp value lets them compare equal. This is
 * verified against what's actually in the ZIP (see build-image-mapping
 * notes), not a guess: the ZIP set for several products consistently omits
 * the count prefix exactly when it equals the total feature count.
 */
function stripRedundantCount(detail: string | null, totalCount: number | null): string | null {
  if (!detail || totalCount === null) return detail;
  const m = detail.match(/^(\d+)-(.+)$/);
  if (m && Number(m[1]) === totalCount) return m[2];
  return detail;
}

function extractSignature(rawName: string): Signature {
  const s = " " + rawName.toLowerCase().replace(/[-]/g, " ") + " ";

  const switchMatch = s.match(/(\d+)\s*switch(?:\s*\(([^)]*)\))?/);
  const fanMatch = s.match(/(\d+)\s*fan(?:\s*regulator)?/);
  const socketMatch = s.match(/(\d+)\s*socket(?:\s*\(([^)]*)\))?/);
  const dimmerMatch = s.match(/(\d+)\s*dimmer/);
  const sceneMatch = s.match(/(\d+)\s*s?\s*scene\s*control(?:ler)?/);
  const dualCurtain = /dual\s*curtain/.test(s);
  const curtain = !dualCurtain && /curtain/.test(s);
  const doorbell = /door\s*bell/.test(s);
  const accessoryOnly = /\b(amp\.?|usb|charger)\b/.test(s) && !switchMatch;

  // "(All 6A Switch)" / "(All-6A)" can appear anywhere in the string (DB
  // names often put it at the very end, after the socket clause; ZIP
  // filenames put it immediately after the switch count) — detect it
  // position-independently and fold it into switchDetail either way.
  const allSwitchAmpMatch = s.match(/all\s*(\d+\s*a)\s*(?:switch)?/);
  const switchCount = switchMatch ? Number(switchMatch[1]) : null;
  let switchDetail = normDetail(switchMatch?.[2]);
  if (!switchDetail && allSwitchAmpMatch) {
    switchDetail = normDetail(`all-${allSwitchAmpMatch[1]}`);
  }

  const socketCount = socketMatch ? Number(socketMatch[1]) : null;
  const socketDetail = normDetail(socketMatch?.[2]);

  return {
    switchCount,
    switchDetail: stripRedundantCount(switchDetail, switchCount),
    fanCount: fanMatch ? Number(fanMatch[1]) : null,
    socketCount,
    socketDetail: stripRedundantCount(socketDetail, socketCount),
    dimmerCount: dimmerMatch ? Number(dimmerMatch[1]) : null,
    curtain: dualCurtain ? "dual" : curtain ? "single" : null,
    doorbell,
    sceneCount: sceneMatch ? Number(sceneMatch[1]) : null,
    other: accessoryOnly ? "accessory-only" : null,
  };
}

function signatureKey(moduleSize: string, sig: Signature): string {
  return JSON.stringify([
    moduleSize,
    sig.switchCount,
    sig.switchDetail,
    sig.fanCount,
    sig.socketCount,
    sig.socketDetail,
    sig.dimmerCount,
    sig.curtain,
    sig.doorbell,
    sig.sceneCount,
  ]);
}

async function main() {
  await connectMongoDB();

  const products = await Product.find({ categoryId: { $exists: true } }).lean();
  // Only the "Tactus Edge" series — matched by code prefix "TCE-", which is
  // this series' own catalog code prefix, independent of category id drift.
  const edgeProducts = products.filter((p: any) => typeof p.code === "string" && p.code.startsWith("TCE-"));

  const zipFiles = fs.readdirSync(ZIP_DIR).filter((f) => f.toLowerCase().endsWith(".png"));

  const byImageKey = new Map<string, { file: string; sig: Signature; moduleSize: string }>();
  for (const file of zipFiles) {
    const m = file.match(/^Color-Edge-(\d+(?:\s*SQ\.?)?M?)\s*-+\s*(.+)\.png$/i) || file.match(/^Color-Edge-(\S+)\s*-+\s*(.+)\.png$/i);
    if (!m) {
      console.warn(`UNPARSEABLE FILENAME (module prefix): ${file}`);
      continue;
    }
    const moduleSize = m[1].toUpperCase();
    const rest = m[2];
    const sig = extractSignature(rest);
    const key = signatureKey(moduleSize, sig);
    if (byImageKey.has(key)) {
      console.warn(`DUPLICATE SIGNATURE among images: "${file}" collides with "${byImageKey.get(key)!.file}"`);
    }
    byImageKey.set(key, { file, sig, moduleSize });
  }

  const safe: any[] = [];
  const review: any[] = [];
  const noMatch: any[] = [];

  for (const p of edgeProducts as any[]) {
    const moduleSize = (p.moduleSize || "").toUpperCase();
    const nameForSig = p.name.replace(/^Edge\s*Color\s*(Touch\s*)?/i, "").replace(/^Edge\s*/i, "");
    const sig = extractSignature(nameForSig);
    const key = signatureKey(moduleSize, sig);
    const match = byImageKey.get(key);

    const hasAnyFeature =
      sig.switchCount !== null || sig.dimmerCount !== null || sig.curtain !== null || sig.doorbell || sig.sceneCount !== null;

    if (sig.other === "accessory-only" || !hasAnyFeature) {
      noMatch.push({
        productId: p._id,
        name: p.name,
        code: p.code,
        moduleSize,
        reason: "Accessory/socket-only product — no equivalent image exists in this ZIP.",
        existingImageUrl: p.imageUrl,
      });
      continue;
    }

    if (match) {
      safe.push({
        productId: p._id,
        name: p.name,
        code: p.code,
        moduleSize,
        existingImageUrl: p.imageUrl,
        existingImagePublicId: p.imagePublicId,
        newImageFile: match.file,
        matchReason: `module=${moduleSize}, switch=${sig.switchCount ?? "-"}${sig.switchDetail ? `(${sig.switchDetail})` : ""}, fan=${sig.fanCount ?? "-"}, socket=${sig.socketCount ?? "-"}${sig.socketDetail ? `(${sig.socketDetail})` : ""}, dimmer=${sig.dimmerCount ?? "-"}, curtain=${sig.curtain ?? "-"}, doorbell=${sig.doorbell}, scene=${sig.sceneCount ?? "-"} — exact signature match`,
        confidence: "HIGH",
      });
    } else {
      review.push({
        productId: p._id,
        name: p.name,
        code: p.code,
        moduleSize,
        existingImageUrl: p.imageUrl,
        parsedSignature: sig,
        reason: "No ZIP image has an identical parsed signature — needs human/visual review before matching.",
      });
    }
  }

  // Any ZIP images that weren't claimed by a SAFE match, for visibility.
  const usedFiles = new Set(safe.map((s) => s.newImageFile));
  const unusedImages = zipFiles.filter((f) => !usedFiles.has(f));

  const report = { generatedAt: new Date().toISOString(), totalEdgeProducts: edgeProducts.length, totalZipImages: zipFiles.length, safe, review, noMatch, unusedImages };

  const outPath = path.resolve(process.cwd(), "scripts/audit/image-mapping-proposal.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Tactus Edge products: ${edgeProducts.length}`);
  console.log(`ZIP images: ${zipFiles.length}`);
  console.log(`SAFE MATCH: ${safe.length}`);
  console.log(`REVIEW REQUIRED: ${review.length}`);
  console.log(`NO MATCH (accessory/no feature): ${noMatch.length}`);
  console.log(`ZIP images not claimed by any safe match: ${unusedImages.length}`);
  console.log(`\nFull report written to: ${outPath}`);

  if (review.length > 0) {
    console.log("\n--- REVIEW REQUIRED ---");
    review.forEach((r) => console.log(`  #${r.productId} ${r.name} (${r.code}) | module=${r.moduleSize}`));
  }
  if (unusedImages.length > 0) {
    console.log("\n--- ZIP IMAGES NOT CLAIMED ---");
    unusedImages.forEach((f) => console.log(`  ${f}`));
  }
  if (noMatch.length > 0) {
    console.log("\n--- NO MATCH ---");
    noMatch.forEach((r) => console.log(`  #${r.productId} ${r.name} (${r.code})`));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Mapping build crashed:", err);
  process.exit(1);
});
