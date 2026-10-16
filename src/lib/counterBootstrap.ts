import type { mongo } from "mongoose";
import {
  AdminUser,
  Category,
  Company,
  HouseType,
  HouseTypeRoomTemplate,
  Product,
  ProductVariant,
  ProductVariantHistory,
  QuotationItem,
  QuotationRoom,
  RoomType,
} from "@/models";
import { DEFAULT_COMPANY_SLUG } from "@/lib/tenant/constants";

/**
 * Counter bootstrap: inspects what the data already contains and works out,
 * for every counter, the lowest value that is safe — never lower than any id
 * or quotation number already in use, and never lower than what a counter
 * already holds. Planning is strictly read-only; `applyCounterBootstrap` is
 * the only function that writes, and it can only move a counter FORWARD
 * (`$max`), so re-running it, or running it concurrently with live traffic, is
 * a no-op once the counters are caught up. It never resets anything.
 *
 * Works on a plain MongoDB `Db` handle rather than the Mongoose models on
 * purpose: the tenant-scope and soft-delete plugins would narrow every read to
 * one company and hide deleted rows, and a floor computed from a subset of
 * the data is exactly how an id collision happens.
 */

type Db = mongo.Db;

/**
 * Row-id counters: one per collection, shared by all companies (see
 * `src/lib/counter.ts`). Collection names come from the models themselves so
 * they cannot drift from what Mongoose actually uses.
 */
export const ROW_ID_SEQUENCES: ReadonlyArray<{ counter: string; collection: string }> = [
  { counter: "adminUser", collection: AdminUser.collection.name },
  { counter: "category", collection: Category.collection.name },
  { counter: "company", collection: Company.collection.name },
  { counter: "houseType", collection: HouseType.collection.name },
  { counter: "houseTypeRoomTemplate", collection: HouseTypeRoomTemplate.collection.name },
  { counter: "product", collection: Product.collection.name },
  { counter: "productVariant", collection: ProductVariant.collection.name },
  { counter: "productVariantHistory", collection: ProductVariantHistory.collection.name },
  { counter: "quotationItem", collection: QuotationItem.collection.name },
  { counter: "quotationRoom", collection: QuotationRoom.collection.name },
  { counter: "roomType", collection: RoomType.collection.name },
];

export type CounterAction = "create" | "advance" | "keep" | "skip";

export interface CounterPlanEntry {
  counter: string;
  scope: "row-id" | "company-quotation-number";
  /** Where the floor came from, for the report. */
  source: string;
  dataMax: number;
  currentSeq: number | null;
  target: number;
  action: CounterAction;
}

export interface CounterConflict {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** A bounded sample of offending record ids. */
  records?: Array<string | number>;
}

export interface CounterPlan {
  entries: CounterPlanEntry[];
  conflicts: CounterConflict[];
}

const SAMPLE_LIMIT = 20;
const QUOTATION_NUMBER = /^QT-(\d{4})-(\d+)$/;

function isValidSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function decide(dataMax: number, currentSeq: number | null): { target: number; action: CounterAction } {
  if (currentSeq === null) {
    return dataMax > 0 ? { target: dataMax, action: "create" } : { target: 0, action: "skip" };
  }
  if (currentSeq < dataMax) return { target: dataMax, action: "advance" };
  return { target: currentSeq, action: "keep" };
}

export async function planCounterBootstrap(
  db: Db,
  options: {
    defaultCompanySlug?: string;
    /**
     * Dry-run only: attribute quotations that have no companyId yet to this
     * company, as the tenant backfill will. Without it such quotations are an
     * error (their numbers cannot be attributed and no company is guessed).
     */
    unassignedCompanyId?: number;
    /** Dry-run only: the default company does not exist yet; this is the id it will get. */
    plannedDefaultCompanyId?: number;
  } = {}
): Promise<CounterPlan> {
  const entries: CounterPlanEntry[] = [];
  const conflicts: CounterConflict[] = [];

  const counterDocs = await db.collection<{ _id: string; seq?: unknown }>("counters").find({}).toArray();
  const counters = new Map<string, number | null>();
  for (const doc of counterDocs) {
    if (isValidSeq(doc.seq)) {
      counters.set(doc._id, doc.seq);
    } else {
      counters.set(doc._id, null);
      conflicts.push({
        severity: "error",
        code: "COUNTER_INVALID",
        message: `Counter '${doc._id}' holds a non-numeric or negative value; it will not be touched until fixed by hand.`,
        records: [doc._id],
      });
    }
  }
  const invalidCounters = new Set(conflicts.filter((c) => c.code === "COUNTER_INVALID").flatMap((c) => c.records ?? []));

  // ── Row-id counters ─────────────────────────────────────────────────────
  for (const { counter, collection } of ROW_ID_SEQUENCES) {
    const col = db.collection(collection);

    const nonNumeric = await col.countDocuments({
      $nor: [{ _id: { $type: "double" } }, { _id: { $type: "int" } }, { _id: { $type: "long" } }, { _id: { $type: "decimal" } }],
    });
    if (nonNumeric > 0) {
      conflicts.push({
        severity: "error",
        code: "ID_NOT_NUMERIC",
        message: `${collection}: ${nonNumeric} document(s) have a non-numeric _id; the numeric sequence '${counter}' cannot be derived.`,
      });
      continue;
    }

    const highest = await col.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray();
    const dataMax = typeof highest[0]?._id === "number" ? (highest[0]._id as number) : 0;
    if (invalidCounters.has(counter)) continue;

    const currentSeq = counters.has(counter) ? (counters.get(counter) as number | null) : null;
    entries.push({ counter, scope: "row-id", source: collection, dataMax, currentSeq, ...decide(dataMax, currentSeq) });
  }

  // ── Per-company quotation numbers ───────────────────────────────────────
  const companies = await db.collection<{ _id: number; slug?: string }>("companies").find({}, { projection: { slug: 1 } }).toArray();
  const companyIds = new Set(companies.map((c) => c._id));
  const defaultSlug = options.defaultCompanySlug ?? DEFAULT_COMPANY_SLUG;
  const defaultCompanyId = companies.find((c) => c.slug === defaultSlug)?._id ?? options.plannedDefaultCompanyId ?? null;
  if (options.plannedDefaultCompanyId !== undefined) companyIds.add(options.plannedDefaultCompanyId);

  const maxByCompanyYear = new Map<string, { companyId: number; year: number; max: number }>();
  const seenNumbers = new Map<string, string>();
  const unassigned: string[] = [];
  const missingCompany: string[] = [];
  const unparsable: string[] = [];
  const duplicates: string[] = [];

  const cursor = db
    .collection<{ _id: string; companyId?: unknown; quotationNumber?: unknown }>("quotations")
    .find({}, { projection: { companyId: 1, quotationNumber: 1 } })
    .sort({ _id: 1 });
  for await (const q of cursor) {
    const match = typeof q.quotationNumber === "string" ? QUOTATION_NUMBER.exec(q.quotationNumber) : null;
    if (!match) {
      unparsable.push(String(q._id));
      continue;
    }
    const owner = typeof q.companyId === "number" ? q.companyId : options.unassignedCompanyId;
    if (typeof owner !== "number") {
      unassigned.push(String(q._id));
      continue;
    }
    if (!companyIds.has(owner)) {
      missingCompany.push(String(q._id));
      continue;
    }
    const dupKey = `${owner}|${q.quotationNumber}`;
    if (seenNumbers.has(dupKey)) duplicates.push(String(q._id));
    seenNumbers.set(dupKey, String(q._id));

    const year = Number(match[1]);
    const key = `${owner}|${year}`;
    const entry = maxByCompanyYear.get(key) ?? { companyId: owner, year, max: 0 };
    entry.max = Math.max(entry.max, Number(match[2]));
    maxByCompanyYear.set(key, entry);
  }

  const sample = (ids: string[]) => ids.slice(0, SAMPLE_LIMIT);
  if (unassigned.length > 0) {
    conflicts.push({
      severity: "error",
      code: "QUOTATION_UNASSIGNED_COMPANY",
      message: `${unassigned.length} quotation(s) have no companyId, so their numbers cannot be attributed to a company. Run the tenant backfill first; no company is guessed.`,
      records: sample(unassigned),
    });
  }
  if (missingCompany.length > 0) {
    conflicts.push({
      severity: "error",
      code: "QUOTATION_COMPANY_MISSING",
      message: `${missingCompany.length} quotation(s) reference a company that does not exist.`,
      records: sample(missingCompany),
    });
  }
  if (duplicates.length > 0) {
    conflicts.push({
      severity: "error",
      code: "QUOTATION_NUMBER_DUPLICATE",
      message: `${duplicates.length} quotation(s) repeat a quotationNumber within the same company.`,
      records: sample(duplicates),
    });
  }
  if (unparsable.length > 0) {
    conflicts.push({
      severity: "warning",
      code: "QUOTATION_NUMBER_UNPARSABLE",
      message: `${unparsable.length} quotation(s) have a number not in QT-<year>-<n> form; they do not influence any counter.`,
      records: sample(unparsable),
    });
  }

  // The pre-multi-company counters (`quotationNumber_<year>`) belong to the
  // default company only — and only if that company can be identified.
  const legacyByYear = new Map<number, number>();
  for (const [name, seq] of counters) {
    const m = /^quotationNumber_(\d{4})$/.exec(name);
    if (m && seq !== null) legacyByYear.set(Number(m[1]), seq);
  }
  if (legacyByYear.size > 0 && defaultCompanyId === null) {
    conflicts.push({
      severity: "error",
      code: "LEGACY_QUOTATION_COUNTER_UNMAPPED",
      message: `Legacy quotation counters exist but no company with slug '${defaultSlug}' was found to own them; they are not migrated and no company is guessed.`,
    });
  }

  const wanted = new Map<string, { companyId: number; year: number; dataMax: number; legacy: number | null }>();
  for (const { companyId, year, max } of maxByCompanyYear.values()) {
    wanted.set(`${companyId}|${year}`, { companyId, year, dataMax: max, legacy: null });
  }
  if (defaultCompanyId !== null) {
    for (const [year, seq] of legacyByYear) {
      const key = `${defaultCompanyId}|${year}`;
      const existing = wanted.get(key) ?? { companyId: defaultCompanyId, year, dataMax: 0, legacy: null };
      existing.legacy = seq;
      wanted.set(key, existing);
    }
  }

  for (const { companyId, year, dataMax, legacy } of wanted.values()) {
    const counter = `quotationNumber_${companyId}_${year}`;
    if (invalidCounters.has(counter)) continue;
    const floor = Math.max(dataMax, legacy ?? 0);
    const currentSeq = counters.has(counter) ? (counters.get(counter) as number | null) : null;
    entries.push({
      counter,
      scope: "company-quotation-number",
      source: legacy !== null ? `quotations + legacy counter quotationNumber_${year}` : "quotations",
      dataMax: floor,
      currentSeq,
      ...decide(floor, currentSeq),
    });
  }

  entries.sort((a, b) => a.counter.localeCompare(b.counter));
  conflicts.sort((a, b) => a.code.localeCompare(b.code));
  return { entries, conflicts };
}

export interface CounterApplyResult {
  written: number;
  skipped: number;
}

/**
 * Writes the plan. Refuses to run while any error-level conflict is open.
 * Uses `$max`, so it can only raise a counter; running it again changes nothing.
 */
export async function applyCounterBootstrap(db: Db, plan: CounterPlan): Promise<CounterApplyResult> {
  const errors = plan.conflicts.filter((c) => c.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `Refusing to write counters while ${errors.length} error-level conflict(s) are open: ${errors.map((e) => e.code).join(", ")}`
    );
  }

  let written = 0;
  let skipped = 0;
  for (const entry of plan.entries) {
    if (entry.action !== "create" && entry.action !== "advance") {
      skipped += 1;
      continue;
    }
    await db
      .collection<{ _id: string; seq: number }>("counters")
      .updateOne({ _id: entry.counter }, { $max: { seq: entry.target } }, { upsert: true });
    written += 1;
  }
  return { written, skipped };
}
