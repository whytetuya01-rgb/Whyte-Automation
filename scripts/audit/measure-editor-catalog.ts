import dotenv from "dotenv";
import path from "path";
import zlib from "zlib";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "@/lib/mongodb";
import { Product } from "@/models";
import { normalizeProducts } from "@/lib/quotationNormalization";
import { redactProductsForRole } from "@/lib/variantRedaction";
import { buildEditorCatalog, loadEditorCatalogSources } from "@/lib/editorCatalog";

/**
 * READ-ONLY. Phase 4.1 before/after measurement of the quotation editor's
 * initial catalog (`initialProducts`) on the live database.
 *
 *   BEFORE = what quotation/[id]/page.tsx did: populate(category + variants) ->
 *            normalizeProducts -> redactProductsForRole
 *   AFTER  = getEditorCatalog(): projected parallel reads -> buildEditorCatalog
 *
 * Runs are interleaved (before, after, before, ...) so network drift hits both
 * equally. Payload size is `JSON.stringify(...).length` of the value handed to
 * `ProposalBuilder`, which is what the page serializes into the response.
 */

const RUNS = Number(process.argv[3] ?? 15);
const now = () => Number(process.hrtime.bigint()) / 1e6;
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => {
  const a = sorted(xs);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const p90 = (xs: number[]) => sorted(xs)[Math.floor(xs.length * 0.9)];

async function legacyOnce(role: string) {
  const t0 = now();
  const docs = await Product.find({ isActive: true })
    .sort({ sortOrder: 1, createdAt: -1 })
    .populate({ path: "category" })
    .populate({ path: "variants", match: { isActive: true }, options: { sort: { sortOrder: 1 } } })
    .lean({ virtuals: true, getters: true });
  const t1 = now();
  const result = redactProductsForRole(normalizeProducts(docs), role);
  const t2 = now();
  return { query: t1 - t0, normalize: t2 - t1, result };
}

async function nextOnce() {
  const t0 = now();
  const sources = await loadEditorCatalogSources();
  const t1 = now();
  const result = buildEditorCatalog(sources);
  const t2 = now();
  return { query: t1 - t0, normalize: t2 - t1, result };
}

function describe(label: string, runs: { query: number[]; normalize: number[] }, sample: unknown) {
  const json = JSON.stringify(sample);
  const products = sample as Array<{ variants?: unknown[] }>;
  const variants = products.reduce((n, p) => n + (p.variants?.length ?? 0), 0);
  console.log(
    `${label.padEnd(14)} products=${products.length} variants=${variants} payload=${json.length} B (gzip ${zlib.gzipSync(json).length} B)  ` +
      `query median ${median(runs.query).toFixed(0)} ms (min ${Math.min(...runs.query).toFixed(0)}, p90 ${p90(runs.query).toFixed(0)})  ` +
      `normalize median ${median(runs.normalize).toFixed(1)} ms (min ${Math.min(...runs.normalize).toFixed(1)})`
  );
  return json.length;
}

async function main() {
  await connectMongoDB();
  await legacyOnce("dealer");
  await nextOnce();

  const before = { query: [] as number[], normalize: [] as number[] };
  const after = { query: [] as number[], normalize: [] as number[] };
  let legacyDealer: unknown = null;
  let legacyAdmin: unknown = null;
  let next: unknown = null;
  for (let i = 0; i < RUNS; i++) {
    const l = await legacyOnce("dealer");
    before.query.push(l.query);
    before.normalize.push(l.normalize);
    legacyDealer = l.result;
    const n = await nextOnce();
    after.query.push(n.query);
    after.normalize.push(n.normalize);
    next = n.result;
  }
  legacyAdmin = (await legacyOnce("admin")).result;

  console.log(`runs per side: ${RUNS} (interleaved, after one warm-up each)\n`);
  const b = describe("BEFORE dealer", before, legacyDealer);
  const bAdmin = JSON.stringify(legacyAdmin).length;
  console.log(`BEFORE admin   payload=${bAdmin} B (carries cost + purchaseTaxPercent that no editor screen reads)`);
  const a = describe("AFTER (any)", after, next);
  console.log(`\npayload reduction vs dealer: ${(100 * (1 - a / b)).toFixed(1)}%   vs admin: ${(100 * (1 - a / bAdmin)).toFixed(1)}%`);
  console.log(`query time (median) change: ${(100 * (median(after.query) / median(before.query) - 1)).toFixed(1)}%   (min-to-min: ${(100 * (Math.min(...after.query) / Math.min(...before.query) - 1)).toFixed(1)}%)`);
  console.log(`normalization (median) change: ${(100 * (median(after.normalize) / median(before.normalize) - 1)).toFixed(1)}%`);
  process.exit(0);
}

main().catch((error) => {
  console.error("measure-editor-catalog failed:", error);
  process.exit(1);
});
