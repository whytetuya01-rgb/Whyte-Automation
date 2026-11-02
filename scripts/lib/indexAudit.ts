/**
 * The controlled index deployment (used by scripts/indexes.ts and its tests).
 *
 * What it does: compares the indexes every model DECLARES with the indexes a database HAS, and can create the missing ones.
 * What it never does: drop an index, rebuild one, or change one. An existing index that differs from its declaration is
 * reported as a conflict and left exactly as it is.
 *
 * Not imported by the app itself: it reads the models folder from disk.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

type Keys = Record<string, number | string>;
type Json = Record<string, unknown>;
type AnyModel = mongoose.Model<Json>;

export interface DeclaredIndex {
  model: string;
  collection: string;
  /** The name MongoDB will give it (the explicit `name`, or the default made from the keys). */
  name: string;
  keys: Keys;
  unique: boolean;
  sparse: boolean;
  partialFilterExpression?: Json;
  expireAfterSeconds?: number;
  collation?: Json;
}

export interface ExistingIndex {
  name: string;
  key: Keys;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Json;
  expireAfterSeconds?: number;
  collation?: Json;
}

export type IndexStatus = "present" | "present_under_another_name" | "missing" | "conflict";

export interface IndexFinding {
  declared: DeclaredIndex;
  status: IndexStatus;
  /** For "present_under_another_name" and "conflict": the index it was matched with. */
  existing?: ExistingIndex;
  /** For a missing unique index on a collection that has documents: how many groups of documents share a key (null = not checked). */
  duplicateGroups?: number | null;
}

export interface ModelAudit {
  model: string;
  collection: string;
  collectionExists: boolean;
  documents: number | null;
  findings: IndexFinding[];
  /** Indexes the database has that no model declares (always kept). */
  extra: ExistingIndex[];
}

/** Files in src/models that are not models. */
const NOT_MODELS = new Set(["index.ts", "helpers.ts"]);

const MODELS_DIR = path.resolve(__dirname, "..", "..", "src", "models");

/** Loads every model of the app (each file in src/models, plus the counter model) and returns them. */
export async function loadAllModels(): Promise<AnyModel[]> {
  for (const file of fs.readdirSync(MODELS_DIR).sort()) {
    if (!file.endsWith(".ts") || NOT_MODELS.has(file)) continue;
    await import(path.join(MODELS_DIR, file));
  }
  await import(path.resolve(__dirname, "..", "..", "src", "lib", "counter.ts"));
  return mongoose
    .modelNames()
    .sort()
    .map((name) => mongoose.model(name) as unknown as AnyModel);
}

const defaultIndexName = (keys: Keys) => Object.entries(keys).map(([field, direction]) => `${field}_${direction}`).join("_");

const isEmpty = (value: unknown) => value === undefined || value === null || (typeof value === "object" && Object.keys(value as Json).length === 0);

/** Every index a model declares (field-level `index`/`unique` flags and schema-level `index()` calls alike). */
export function declaredIndexes(model: AnyModel): DeclaredIndex[] {
  const collection = model.collection.collectionName;
  return model.schema.indexes().map(([keys, options]) => {
    const spec = options as Json & { name?: string; unique?: boolean; sparse?: boolean; partialFilterExpression?: Json; expireAfterSeconds?: number; collation?: Json };
    return {
      model: model.modelName,
      collection,
      name: spec.name ?? defaultIndexName(keys as Keys),
      keys: keys as Keys,
      unique: Boolean(spec.unique),
      sparse: Boolean(spec.sparse),
      partialFilterExpression: isEmpty(spec.partialFilterExpression) ? undefined : spec.partialFilterExpression,
      expireAfterSeconds: spec.expireAfterSeconds,
      collation: isEmpty(spec.collation) ? undefined : spec.collation,
    };
  });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameKeys = (a: Keys, b: Keys) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

/** Does an existing index have the same definition as a declared one? (Same keys in the same order and the same options.) */
export function sameDefinition(declared: DeclaredIndex, existing: ExistingIndex): boolean {
  return (
    sameKeys(declared.keys, existing.key) &&
    declared.unique === Boolean(existing.unique) &&
    declared.sparse === Boolean(existing.sparse) &&
    sameJson(declared.partialFilterExpression, isEmpty(existing.partialFilterExpression) ? undefined : existing.partialFilterExpression) &&
    declared.expireAfterSeconds === existing.expireAfterSeconds
  );
}

/** Compares what a model declares with what its collection has. Pure; no database access. */
export function compareIndexes(declared: DeclaredIndex[], existing: ExistingIndex[]): { findings: IndexFinding[]; extra: ExistingIndex[] } {
  const matched = new Set<string>();
  const findings: IndexFinding[] = declared.map((wanted) => {
    const sameName = existing.find((index) => index.name === wanted.name);
    if (sameName) {
      matched.add(sameName.name);
      return sameDefinition(wanted, sameName) ? { declared: wanted, status: "present" as const } : { declared: wanted, status: "conflict" as const, existing: sameName };
    }
    const sameShape = existing.find((index) => sameDefinition(wanted, index));
    if (sameShape) {
      matched.add(sameShape.name);
      return { declared: wanted, status: "present_under_another_name" as const, existing: sameShape };
    }
    // The same keys with different options, under another name, would also be refused by MongoDB: a conflict, not a gap.
    const sameKeyDifferentOptions = existing.find((index) => sameKeys(wanted.keys, index.key));
    if (sameKeyDifferentOptions) {
      matched.add(sameKeyDifferentOptions.name);
      return { declared: wanted, status: "conflict" as const, existing: sameKeyDifferentOptions };
    }
    return { declared: wanted, status: "missing" as const };
  });
  const extra = existing.filter((index) => index.name !== "_id_" && !matched.has(index.name));
  return { findings, extra };
}

/** MongoDB's "collection does not exist" error. */
const isMissingCollection = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === 26;

async function listExisting(model: AnyModel): Promise<{ exists: boolean; indexes: ExistingIndex[] }> {
  try {
    const indexes = (await model.collection.indexes()) as unknown as ExistingIndex[];
    return { exists: true, indexes };
  } catch (error) {
    if (isMissingCollection(error)) return { exists: false, indexes: [] };
    throw error;
  }
}

/**
 * How many groups of documents already share the key a UNIQUE index would enforce. Any group makes the build fail, so a
 * missing unique index with duplicates must not be created until they are resolved. Read-only; counts only, never values.
 */
export async function countDuplicateGroups(model: AnyModel, index: DeclaredIndex): Promise<number> {
  const fields = Object.keys(index.keys);
  const match: Json = { ...(index.partialFilterExpression ?? {}) };
  if (index.sparse) for (const field of fields) match[field] = { ...(match[field] as Json | undefined), $exists: true };
  const id: Json = {};
  fields.forEach((field, position) => {
    id[`k${position}`] = `$${field}`;
  });
  const result = await model.collection
    .aggregate([{ $match: match }, { $group: { _id: id, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "groups" }], { allowDiskUse: true, maxTimeMS: 120_000 })
    .toArray();
  return Number((result[0] as { groups?: number } | undefined)?.groups ?? 0);
}

/** Reads one model's declared and existing indexes (read-only). */
export async function auditModel(model: AnyModel, options: { checkUnique?: boolean } = {}): Promise<ModelAudit> {
  const { exists, indexes } = await listExisting(model);
  const { findings, extra } = compareIndexes(declaredIndexes(model), indexes);
  let documents: number | null = null;
  if (exists) documents = await model.collection.estimatedDocumentCount();
  if (options.checkUnique && exists && (documents ?? 0) > 0) {
    for (const finding of findings) {
      if (finding.status === "missing" && finding.declared.unique) finding.duplicateGroups = await countDuplicateGroups(model, finding.declared);
    }
  }
  return { model: model.modelName, collection: model.collection.collectionName, collectionExists: exists, documents, findings, extra };
}

export interface ApplyResult {
  model: string;
  created: string[];
  /** Missing but not created, with why (duplicates, a conflict). */
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Creates the MISSING declared indexes of a model. Never drops or rebuilds anything. A unique index whose key already has
 * duplicates is skipped (it would fail); a conflict is reported by `auditModel` and is not touched here.
 */
export async function createMissingIndexes(model: AnyModel): Promise<ApplyResult> {
  const audit = await auditModel(model, { checkUnique: true });
  const result: ApplyResult = { model: model.modelName, created: [], skipped: [] };
  for (const finding of audit.findings) {
    if (finding.status === "conflict") {
      result.skipped.push({ name: finding.declared.name, reason: `an index with this name or these keys exists with a different definition (${finding.existing?.name}); left untouched` });
      continue;
    }
    if (finding.status !== "missing") continue;
    if (finding.declared.unique && (finding.duplicateGroups ?? 0) > 0) {
      result.skipped.push({ name: finding.declared.name, reason: `${finding.duplicateGroups} group(s) of documents share this key; resolve the duplicates first` });
      continue;
    }
    const declared = finding.declared;
    await model.collection.createIndex(declared.keys as never, {
      name: declared.name,
      ...(declared.unique ? { unique: true } : {}),
      ...(declared.sparse ? { sparse: true } : {}),
      ...(declared.partialFilterExpression ? { partialFilterExpression: declared.partialFilterExpression } : {}),
      ...(declared.expireAfterSeconds !== undefined ? { expireAfterSeconds: declared.expireAfterSeconds } : {}),
      ...(declared.collation ? { collation: declared.collation } : {}),
    } as never);
    result.created.push(declared.name);
  }
  return result;
}

export interface Summary {
  models: number;
  declared: number;
  present: number;
  missing: number;
  conflicts: number;
  extra: number;
  uniqueMissing: number;
  uniqueWithDuplicates: number;
}

export function summarize(audits: ModelAudit[]): Summary {
  const summary: Summary = { models: audits.length, declared: 0, present: 0, missing: 0, conflicts: 0, extra: 0, uniqueMissing: 0, uniqueWithDuplicates: 0 };
  for (const audit of audits) {
    summary.extra += audit.extra.length;
    for (const finding of audit.findings) {
      summary.declared += 1;
      if (finding.status === "present" || finding.status === "present_under_another_name") summary.present += 1;
      if (finding.status === "missing") {
        summary.missing += 1;
        if (finding.declared.unique) summary.uniqueMissing += 1;
        if ((finding.duplicateGroups ?? 0) > 0) summary.uniqueWithDuplicates += 1;
      }
      if (finding.status === "conflict") summary.conflicts += 1;
    }
  }
  return summary;
}
