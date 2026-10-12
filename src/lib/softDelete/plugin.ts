import type { Aggregate, AnyBulkWriteOperation, Document, Model, PipelineStage, Query, Schema } from "mongoose";
import {
  DELETION_REASON_MAX_LENGTH,
  SOFT_DELETE_FIELDS,
  SoftDeleteViolationError,
  isSoftDeleteField,
} from "./fields";
import {
  HARD_DELETE_OPTION,
  SCOPE_OPTION,
  SOFT_DELETE_SCOPES,
  WRITE_OPTION,
  type SoftDeleteScope,
} from "./internal";

/**
 * Soft-delete schema plugin.
 *
 * It is one layer of protection, not the only one. What it covers, and what it
 * cannot cover, is listed explicitly so nobody has to assume:
 *
 *   find / findOne / findById / exists / countDocuments / distinct
 *   / cursor() / populate (target model)        → scoped filter added (default: active only)
 *   updateOne / updateMany / findOneAndUpdate
 *   / replaceOne / findOneAndReplace            → scoped filter + soft-delete fields write-protected
 *   deleteOne / deleteMany / findOneAndDelete
 *   / document deleteOne()                      → scoped filter; blocked with `blockHardDelete`
 *   aggregate                                   → leading $match added; $lookup / $unionWith /
 *                                                 $graphLookup into a soft-deletable collection
 *                                                 must filter isDeleted itself or the call throws
 *   bulkWrite                                   → per-operation filter + write protection + hard-delete block
 *   insertMany / create / save                  → new records cannot be born deleted; save()
 *                                                 cannot change soft-delete fields
 *   estimatedDocumentCount                      → throws (collection metadata cannot be filtered)
 *
 * NOT covered (audited separately, guarded by tests/soft-delete-core): the native
 * driver (`Model.collection.*`), and queries run with `{ middleware: false }`.
 *
 * A caller-supplied `isDeleted` condition is combined with `$and`, never
 * merged, so `find({ isDeleted: true })` in the default scope returns nothing:
 * deleted records are reachable only through the explicit scope helpers.
 */

export interface SoftDeletePluginOptions {
  /**
   * Reject permanent deletes unless the soft-delete service authorises them
   * (Trash purge, rollback of a never-visible record). Enabled per model once
   * its delete entry points have been converted to soft delete.
   */
  blockHardDelete?: boolean;
}

const softDeleteSchemas = new WeakSet<Schema>();

export function isSoftDeleteSchema(schema: Schema | null | undefined): boolean {
  return schema != null && softDeleteSchemas.has(schema);
}

const QUERY_OPS: Array<
  "find" | "findOne" | "countDocuments" | "distinct" | "updateOne" | "updateMany" | "findOneAndUpdate" | "replaceOne" | "findOneAndReplace" | "deleteOne" | "deleteMany" | "findOneAndDelete"
> = [
  "find",
  "findOne",
  "countDocuments",
  "distinct",
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
];

const UPDATE_OPS: ReadonlySet<string> = new Set(["updateOne", "updateMany", "findOneAndUpdate"]);
const REPLACE_OPS: ReadonlySet<string> = new Set(["replaceOne", "findOneAndReplace"]);
const DELETE_OPS: ReadonlySet<string> = new Set(["deleteOne", "deleteMany", "findOneAndDelete"]);

/** Stages that must stay first in a pipeline; the scope $match goes right after them. */
const FIRST_STAGE_ONLY: ReadonlySet<string> = new Set([
  "$geoNear",
  "$search",
  "$searchMeta",
  "$vectorSearch",
  "$rankFusion",
  "$scoreFusion",
]);

/** Source stages that do not read this collection's documents at all. */
const NON_DOCUMENT_SOURCES: ReadonlySet<string> = new Set([
  "$collStats",
  "$indexStats",
  "$planCacheStats",
  "$currentOp",
  "$listSessions",
  "$listLocalSessions",
  "$listSearchIndexes",
  "$listSampledQueries",
  "$querySettings",
  "$documents",
  "$changeStream",
]);

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScope(value: unknown): value is SoftDeleteScope {
  return typeof value === "string" && (SOFT_DELETE_SCOPES as readonly string[]).includes(value);
}

/** Reads an internal option and removes it so it is never forwarded to the driver. */
function takeOption(options: PlainObject | null | undefined, key: string): unknown {
  if (!options || !(key in options)) return undefined;
  const value = options[key];
  delete options[key];
  return value;
}

function takeScope(options: PlainObject | null | undefined): SoftDeleteScope {
  const raw = takeOption(options, SCOPE_OPTION);
  if (raw === undefined) return "active";
  if (isScope(raw)) return raw;
  throw new SoftDeleteViolationError(`Unknown soft-delete scope "${String(raw)}".`);
}

function scopeCondition(scope: SoftDeleteScope): PlainObject | null {
  if (scope === "include") return null;
  return scope === "only" ? { isDeleted: true } : { isDeleted: { $ne: true } };
}

function withScope(filter: PlainObject | undefined, scope: SoftDeleteScope): PlainObject {
  const condition = scopeCondition(scope);
  if (!condition) return filter ?? {};
  return filter && Object.keys(filter).length > 0 ? { $and: [filter, condition] } : condition;
}

/** A value that leaves a record live: soft-delete defaults are only ever null/false. */
function isLiveValue(value: unknown): boolean {
  return value === undefined || value === null || value === false;
}

/** Every field path an update document or pipeline would write. "*" = whole document. */
function updatedPaths(update: unknown): string[] {
  if (update == null) return [];
  const paths: string[] = [];

  if (Array.isArray(update)) {
    for (const stage of update) {
      if (!isPlainObject(stage)) continue;
      for (const [operator, spec] of Object.entries(stage)) {
        if (operator === "$replaceRoot" || operator === "$replaceWith") return ["*"];
        if (operator === "$unset") {
          paths.push(...(Array.isArray(spec) ? spec : [spec]).map(String));
        } else if (isPlainObject(spec)) {
          paths.push(...Object.keys(spec));
        }
      }
    }
    return paths;
  }

  if (!isPlainObject(update)) return paths;
  for (const [key, value] of Object.entries(update)) {
    if (!key.startsWith("$")) {
      paths.push(key); // implicit $set
      continue;
    }
    if (!isPlainObject(value)) continue;
    for (const [path, fieldValue] of Object.entries(value)) {
      // Upsert defaults for a brand-new record are live values; anything else is a write.
      if (key === "$setOnInsert" && isSoftDeleteField(path) && isLiveValue(fieldValue)) continue;
      paths.push(path);
    }
    if (key === "$rename") {
      paths.push(...Object.values(value).filter((target): target is string => typeof target === "string"));
    }
  }
  return paths;
}

function assertUpdateLeavesSoftDeleteFieldsAlone(update: unknown, context: string): void {
  const touched = updatedPaths(update).filter((path) => path === "*" || isSoftDeleteField(path));
  if (touched.length > 0) {
    throw new SoftDeleteViolationError(
      `${context} cannot write ${touched.join(", ")}. Soft-delete fields change only through the soft-delete service.`
    );
  }
}

function readField(record: unknown, field: string): unknown {
  if (record && typeof (record as Document).get === "function") return (record as Document).get(field);
  return isPlainObject(record) ? record[field] : undefined;
}

function assertRecordIsLive(record: unknown, context: string): void {
  const deletedFields = SOFT_DELETE_FIELDS.filter((field) => !isLiveValue(readField(record, field)));
  if (deletedFields.length > 0) {
    throw new SoftDeleteViolationError(
      `${context} cannot set ${deletedFields.join(", ")}. Records are deleted only through the soft-delete service.`
    );
  }
}

function modelNameOf(doc: Document): string {
  return (doc.constructor as { modelName?: string }).modelName ?? "record";
}

function hardDeleteBlocked(modelName: string, context: string): SoftDeleteViolationError {
  return new SoftDeleteViolationError(
    `${context} would permanently delete ${modelName} records. Use the soft-delete service instead.`
  );
}

function softDeleteCollectionNames(model: Model<unknown>): Set<string> {
  const names = new Set<string>();
  for (const candidate of Object.values(model.db.models)) {
    if (softDeleteSchemas.has(candidate.schema)) names.add(candidate.collection.collectionName);
  }
  return names;
}

function mentionsIsDeleted(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes('"isDeleted"');
}

/** Walks a pipeline, including $lookup/$unionWith sub-pipelines and $facet branches. */
function* walkStages(pipeline: unknown[]): Generator<PlainObject> {
  for (const stage of pipeline) {
    if (!isPlainObject(stage)) continue;
    yield stage;
    for (const [operator, spec] of Object.entries(stage)) {
      if ((operator === "$lookup" || operator === "$unionWith") && isPlainObject(spec) && Array.isArray(spec.pipeline)) {
        yield* walkStages(spec.pipeline);
      }
      if (operator === "$facet" && isPlainObject(spec)) {
        for (const branch of Object.values(spec)) if (Array.isArray(branch)) yield* walkStages(branch);
      }
    }
  }
}

/**
 * The leading $match only scopes the collection the aggregate runs on. A join
 * into another soft-deletable collection is invisible to that $match, so it
 * must say what it wants explicitly.
 */
function assertJoinsAreScoped(model: Model<unknown>, pipeline: unknown[]): void {
  const guarded = softDeleteCollectionNames(model);
  for (const stage of walkStages(pipeline)) {
    for (const [operator, spec] of Object.entries(stage)) {
      let target: unknown;
      let scopedBy: unknown;
      if (operator === "$lookup" && isPlainObject(spec)) {
        target = spec.from;
        scopedBy = spec.pipeline;
      } else if (operator === "$unionWith") {
        target = typeof spec === "string" ? spec : isPlainObject(spec) ? spec.coll : undefined;
        scopedBy = isPlainObject(spec) ? spec.pipeline : undefined;
      } else if (operator === "$graphLookup" && isPlainObject(spec)) {
        target = spec.from;
        scopedBy = spec.restrictSearchWithMatch;
      } else {
        continue;
      }
      if (typeof target === "string" && guarded.has(target) && !mentionsIsDeleted(scopedBy)) {
        throw new SoftDeleteViolationError(
          `${operator} into "${target}" from ${model.modelName}.aggregate() must filter isDeleted explicitly ` +
            `(e.g. { $match: { isDeleted: { $ne: true } } }); the soft-delete plugin cannot scope joined collections.`
        );
      }
    }
  }
}

function insertScopeMatch(pipeline: PipelineStage[], condition: PlainObject): void {
  const first = pipeline[0] ? Object.keys(pipeline[0])[0] : undefined;
  if (first && NON_DOCUMENT_SOURCES.has(first)) return;
  const match: PipelineStage = { $match: condition };
  pipeline.splice(first && FIRST_STAGE_ONLY.has(first) ? 1 : 0, 0, match);
}

export function softDeletePlugin(schema: Schema, options: SoftDeletePluginOptions = {}): void {
  const blockHardDelete = options.blockHardDelete === true;

  schema.add({
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Number, ref: "AdminUser", default: null, select: false },
    deletionReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: DELETION_REASON_MAX_LENGTH,
      select: false,
    },
    deletionGroupId: { type: String, default: null, select: false },
    deletedViaCascade: { type: Boolean, default: false, select: false },
  });

  // Both indexes contain ONLY soft-deleted records, so they cost nothing for
  // live data: one serves the Trash listing, the other group restore/purge.
  schema.index(
    { deletedAt: -1 },
    { name: "softDelete_trash", partialFilterExpression: { isDeleted: true } }
  );
  schema.index(
    { deletionGroupId: 1 },
    { name: "softDelete_group", partialFilterExpression: { isDeleted: true } }
  );

  schema.pre(QUERY_OPS, { document: false, query: true }, function (this: Query<unknown, unknown>) {
    const queryOptions = this.getOptions();
    const scope = takeScope(queryOptions);
    const authorisedWrite = takeOption(queryOptions, WRITE_OPTION) === true;
    const authorisedHardDelete = takeOption(queryOptions, HARD_DELETE_OPTION) !== undefined;
    const op = String((this as unknown as { op: string }).op);
    const modelName = this.model.modelName;

    if (DELETE_OPS.has(op) && blockHardDelete && !authorisedHardDelete) {
      throw hardDeleteBlocked(modelName, `${modelName}.${op}()`);
    }
    if (UPDATE_OPS.has(op) && !authorisedWrite) {
      assertUpdateLeavesSoftDeleteFieldsAlone(this.getUpdate(), `${modelName}.${op}()`);
    }
    if (REPLACE_OPS.has(op) && !authorisedWrite) {
      assertRecordIsLive(this.getUpdate(), `${modelName}.${op}()`);
    }

    const condition = scopeCondition(scope);
    if (condition) this.and([condition]);
  });

  schema.pre("estimatedDocumentCount", function (this: Query<unknown, unknown>) {
    if (takeScope(this.getOptions()) !== "include") {
      throw new SoftDeleteViolationError(
        `${this.model.modelName}.estimatedDocumentCount() reads collection metadata and cannot exclude ` +
          `soft-deleted records. Use countDocuments().`
      );
    }
  });

  schema.pre("aggregate", function (this: Aggregate<unknown>) {
    const scope = takeScope(this.options);
    const condition = scopeCondition(scope);
    if (!condition) return;
    const pipeline = this.pipeline();
    assertJoinsAreScoped(this.model(), pipeline);
    insertScopeMatch(pipeline, condition);
  });

  schema.pre("save", function (this: Document) {
    if (this.isNew) {
      assertRecordIsLive(this, `Creating a ${modelNameOf(this)} record`);
      return;
    }
    const touched = SOFT_DELETE_FIELDS.filter((field) => this.isModified(field));
    if (touched.length > 0) {
      throw new SoftDeleteViolationError(
        `save() cannot change ${touched.join(", ")}. Soft-delete fields change only through the soft-delete service.`
      );
    }
  });

  schema.pre("insertMany", function (this: Model<unknown>, docs: unknown) {
    for (const doc of Array.isArray(docs) ? docs : [docs]) {
      assertRecordIsLive(doc, `${this.modelName}.insertMany()`);
    }
  });

  schema.pre("deleteOne", { document: true, query: false }, function (this: Document) {
    if (blockHardDelete) throw hardDeleteBlocked(modelNameOf(this), "document.deleteOne()");
  });

  schema.pre("bulkWrite", function (this: Model<unknown>, ops: Array<AnyBulkWriteOperation<any>>) {
    const context = `${this.modelName}.bulkWrite()`;
    for (const op of ops) {
      if ("insertOne" in op) {
        assertRecordIsLive(op.insertOne.document, context);
      } else if ("updateOne" in op) {
        assertUpdateLeavesSoftDeleteFieldsAlone(op.updateOne.update, context);
        op.updateOne.filter = withScope(op.updateOne.filter, "active");
      } else if ("updateMany" in op) {
        assertUpdateLeavesSoftDeleteFieldsAlone(op.updateMany.update, context);
        op.updateMany.filter = withScope(op.updateMany.filter, "active");
      } else if ("replaceOne" in op) {
        assertRecordIsLive(op.replaceOne.replacement, context);
        op.replaceOne.filter = withScope(op.replaceOne.filter, "active");
      } else if ("deleteOne" in op) {
        if (blockHardDelete) throw hardDeleteBlocked(this.modelName, context);
        op.deleteOne.filter = withScope(op.deleteOne.filter, "active");
      } else if ("deleteMany" in op) {
        if (blockHardDelete) throw hardDeleteBlocked(this.modelName, context);
        op.deleteMany.filter = withScope(op.deleteMany.filter, "active");
      }
    }
  });

  softDeleteSchemas.add(schema);
}
