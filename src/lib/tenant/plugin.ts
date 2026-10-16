import type { Aggregate, AnyBulkWriteOperation, Document, Model, PipelineStage, Query, Schema } from "mongoose";
import { TENANT_WRITE_OPTION } from "./internal";
import { getTenantContext, TenantScopeViolationError } from "./context";

/**
 * Tenant-scope schema plugin. Modeled directly on `src/lib/softDelete/plugin.ts`
 * (same hook list, same "the filter and the hard-stop checks live in one
 * place, every op goes through it" shape) — but scoping by `companyId`
 * instead of `isDeleted`, and sourced from the `AsyncLocalStorage` context in
 * `./context.ts` instead of per-query options.
 *
 * What it covers, same inventory discipline as the soft-delete plugin:
 *
 *   find / findOne / findById / exists / countDocuments / distinct
 *   / cursor() / populate (target model)        → `{ companyId }` filter added
 *   updateOne / updateMany / findOneAndUpdate
 *   / replaceOne / findOneAndReplace            → scoped filter + `companyId` write-protected
 *   deleteOne / deleteMany / findOneAndDelete    → scoped filter (soft-delete, not this plugin,
 *                                                   decides whether the op is itself a hard delete)
 *   aggregate                                    → leading $match added; $lookup / $unionWith /
 *                                                   $graphLookup into a tenant-scoped collection
 *                                                   must filter companyId itself or the call throws
 *   bulkWrite                                    → per-operation filter + write protection
 *   insertMany / save                            → companyId stamped from context if missing;
 *                                                   throws if a document's companyId disagrees
 *                                                   with context; save() cannot change companyId
 *   estimatedDocumentCount                       → always throws (ignores filters entirely)
 *
 * NOT covered (same as soft-delete, audited the same way): the native driver
 * (`Model.collection.*`), and queries run with `{ middleware: false }`.
 *
 * Composes with the soft-delete plugin automatically: both hooks call
 * `this.and([condition])` on the query rather than replacing its filter, so a
 * model carrying both plugins gets both conditions ANDed together regardless
 * of registration order — confirmed by this module's own tests, which run a
 * model with both plugins applied.
 *
 * Context states and what each means (see `./context.ts` for the full
 * rationale): no context at all → throw (a request/script that never
 * established one, which is always a bug, never "see everything"); context
 * with `companyId: null` and no `bypass` → scope to a condition that matches
 * no real document (a Super Admin who hasn't "acted as" a company sees
 * nothing from tenant models, not everything); context with `bypass` set (via
 * `runUnscoped()`) → no company filter at all, logged; context with a real
 * `companyId` → filter by it, always.
 */

const tenantSchemas = new WeakSet<Schema>();

export function isTenantSchema(schema: Schema | null | undefined): boolean {
  return schema != null && tenantSchemas.has(schema);
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

/** An impossible filter: no real document ever has `companyId: -1`. Fail-closed, never fail-open. */
const NOTHING_CONDITION: PlainObject = { companyId: -1 };

function scopeCondition(ctx: ReturnType<typeof getTenantContext>): PlainObject | null {
  if (!ctx) {
    throw new TenantScopeViolationError(
      "A tenant-scoped model was used with no tenant context established. " +
      "Every request must call requireSession()/requirePermission() (API routes) or withTenant() " +
      "(server-rendered page loaders) before touching a tenant-owned model. " +
      "If this is deliberately outside a request (a script, a migration), wrap it in runUnscoped(reason, fn)."
    );
  }
  if (ctx.bypass) return null;
  if (ctx.companyId === null) return NOTHING_CONDITION;
  return { companyId: ctx.companyId };
}

function takeWriteAuthorisation(options: PlainObject | null | undefined): boolean {
  if (!options || !(TENANT_WRITE_OPTION in options)) return false;
  const value = options[TENANT_WRITE_OPTION];
  delete options[TENANT_WRITE_OPTION];
  return value === true;
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
      // `$setOnInsert: { companyId }` is exactly how an upsert is correctly
      // stamped with its company (see saveRolePermissions in roleService.ts)
      // — it only ever takes effect on a brand-new document, never rewrites
      // an existing one's companyId, so it's not a mutation to guard against.
      if (key === "$setOnInsert" && path === "companyId") continue;
      paths.push(path);
    }
    if (key === "$rename") {
      paths.push(...Object.values(value).filter((target): target is string => typeof target === "string"));
    }
  }
  return paths;
}

function assertUpdateLeavesCompanyIdAlone(update: unknown, context: string, authorised: boolean): void {
  if (authorised) return;
  const touched = updatedPaths(update);
  if (touched.includes("*") || touched.includes("companyId")) {
    throw new TenantScopeViolationError(
      `${context} cannot write companyId. It is set once at creation and is otherwise immutable.`
    );
  }
}

function readField(record: unknown, field: string): unknown {
  if (record && typeof (record as Document).get === "function") return (record as Document).get(field);
  return isPlainObject(record) ? record[field] : undefined;
}

/**
 * Stamps `companyId` onto a brand-new document/plain-object from the current
 * context when it's missing, or throws if the document already carries a
 * *different* `companyId` than the context — the one way a request for
 * Company A could otherwise accidentally (or maliciously) create a record
 * stamped as belonging to Company B.
 *
 * `exempt` is true only for the one documented exception (a platform
 * `super_admin` `AdminUser`, via `isExempt` on `tenantScopePlugin`'s
 * options): such a record genuinely has no company, by design, not by
 * omission — returns `null` without requiring or checking anything.
 */
function resolveCompanyIdForCreate(record: unknown, context: string, exempt: boolean): number | null {
  if (exempt) {
    const existing = readField(record, "companyId");
    return typeof existing === "number" ? existing : null;
  }
  const ctx = getTenantContext();
  if (!ctx) {
    throw new TenantScopeViolationError(
      `${context}: no tenant context established. See the message on any read-path violation for how to fix this.`
    );
  }
  if (ctx.bypass) {
    // Migration/platform-admin paths must supply companyId explicitly on every document;
    // there is no ambient companyId to fall back to once scoping is bypassed.
    const existing = readField(record, "companyId");
    if (typeof existing !== "number") {
      throw new TenantScopeViolationError(
        `${context}: running unscoped (reason: ${ctx.bypass}) still requires an explicit companyId on every document.`
      );
    }
    return existing;
  }
  if (ctx.companyId === null) {
    throw new TenantScopeViolationError(
      `${context}: the current session has no active company (Super Admin without "act as company") and cannot create tenant-owned records.`
    );
  }

  const existing = readField(record, "companyId");
  if (existing !== undefined && existing !== null && existing !== ctx.companyId) {
    throw new TenantScopeViolationError(
      `${context}: document companyId (${String(existing)}) does not match the current tenant context (${ctx.companyId}).`
    );
  }
  return ctx.companyId;
}

function modelNameOf(doc: Document): string {
  return (doc.constructor as { modelName?: string }).modelName ?? "record";
}

function tenantCollectionNames(model: Model<unknown>): Set<string> {
  const names = new Set<string>();
  for (const candidate of Object.values(model.db.models)) {
    if (tenantSchemas.has(candidate.schema)) names.add(candidate.collection.collectionName);
  }
  return names;
}

/**
 * Looser than a literal `"companyId"` key match on purpose: a self-scoped
 * sub-pipeline just as often references the field inside `$expr` (as
 * `"$companyId"`, a field reference, not an object key), which a strict
 * `'"companyId"'` substring check would miss entirely.
 */
function mentionsCompanyId(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes("companyId");
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

/** Same shape as soft-delete's `assertJoinsAreScoped` — a join into another tenant collection must say what it wants. */
function assertJoinsAreScoped(model: Model<unknown>, pipeline: unknown[]): void {
  const guarded = tenantCollectionNames(model);
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
      if (typeof target === "string" && guarded.has(target) && !mentionsCompanyId(scopedBy)) {
        throw new TenantScopeViolationError(
          `${operator} into "${target}" from ${model.modelName}.aggregate() must filter companyId explicitly ` +
          `(e.g. { $match: { companyId: <id> } }); the tenant-scope plugin cannot scope joined collections.`
        );
      }
    }
  }
}

function insertScopeMatch(pipeline: PipelineStage[], condition: PlainObject | null): void {
  if (!condition) return;
  const first = pipeline[0] ? Object.keys(pipeline[0])[0] : undefined;
  if (first && NON_DOCUMENT_SOURCES.has(first)) return;
  const match: PipelineStage = { $match: condition };
  pipeline.splice(first && FIRST_STAGE_ONLY.has(first) ? 1 : 0, 0, match);
}

export interface TenantPluginOptions {
  /**
   * A document matching this predicate has no company, by design — the one
   * documented exception is a platform `super_admin` `AdminUser`. Such a
   * document is created/read with `companyId: null` and is never required to
   * carry one; it simply never matches any company-scoped query either,
   * which is exactly the desired behavior (a platform account should never
   * show up in a company's own user list).
   */
  isExempt?: (doc: unknown) => boolean;
}

export function tenantScopePlugin(schema: Schema, options: TenantPluginOptions = {}): void {
  const isExempt = options.isExempt ?? (() => false);

  schema.add({
    companyId: {
      type: Number,
      ref: "Company",
      default: null,
      index: true,
      required: function (this: unknown) {
        return !isExempt(this);
      },
    },
  });

  schema.pre(QUERY_OPS, { document: false, query: true }, function (this: Query<unknown, unknown>) {
    const queryOptions = this.getOptions();
    const authorisedWrite = takeWriteAuthorisation(queryOptions);
    const op = String((this as unknown as { op: string }).op);
    const modelName = this.model.modelName;

    if (UPDATE_OPS.has(op)) {
      assertUpdateLeavesCompanyIdAlone(this.getUpdate(), `${modelName}.${op}()`, authorisedWrite);
    }
    if (REPLACE_OPS.has(op) && !authorisedWrite) {
      const replacement = this.getUpdate();
      const replacementCompanyId = isPlainObject(replacement) ? replacement.companyId : undefined;
      const ctx = getTenantContext();
      if (replacementCompanyId !== undefined && ctx && ctx.companyId !== null && replacementCompanyId !== ctx.companyId) {
        throw new TenantScopeViolationError(`${modelName}.${op}() cannot replace a document into a different companyId.`);
      }
    }

    const condition = scopeCondition(getTenantContext());
    if (condition) this.and([condition]);
  });

  schema.pre("estimatedDocumentCount", function (this: Query<unknown, unknown>) {
    throw new TenantScopeViolationError(
      `${this.model.modelName}.estimatedDocumentCount() reads collection metadata and ignores every filter — ` +
      `it can never be scoped to one company. Use countDocuments() instead.`
    );
  });

  schema.pre("aggregate", function (this: Aggregate<unknown>) {
    const condition = scopeCondition(getTenantContext());
    if (!condition) return;
    const pipeline = this.pipeline();
    assertJoinsAreScoped(this.model(), pipeline);
    insertScopeMatch(pipeline, condition);
  });

  // `pre("validate")`, not `pre("save")`: Mongoose runs validation (which
  // enforces `companyId`'s `required: true` above) BEFORE `save` hooks, so
  // stamping companyId in a `save` hook would always be too late — the
  // required-field check would already have failed by the time it ran.
  schema.pre("validate", function (this: Document & { companyId?: number | null }) {
    const isNew = (this as unknown as { isNew: boolean }).isNew;
    if (isNew) {
      this.companyId = resolveCompanyIdForCreate(this, `Creating a ${modelNameOf(this)} record`, isExempt(this));
      return;
    }
    if (isExempt(this)) return;
    const modified = (this as unknown as { isModified: (p: string) => boolean }).isModified("companyId");
    if (modified) {
      throw new TenantScopeViolationError(`save() cannot change companyId. It is immutable after creation.`);
    }
  });

  schema.pre("insertMany", function (this: Model<unknown>, docs: unknown) {
    const list = Array.isArray(docs) ? docs : [docs];
    for (const doc of list) {
      const companyId = resolveCompanyIdForCreate(doc, `${this.modelName}.insertMany()`, isExempt(doc));
      if (isPlainObject(doc)) doc.companyId = companyId;
    }
  });

  schema.pre("bulkWrite", function (this: Model<unknown>, ops: Array<AnyBulkWriteOperation<any>>) {
    const context = `${this.modelName}.bulkWrite()`;
    const ctx = getTenantContext();
    const condition = scopeCondition(ctx);
    for (const op of ops) {
      if ("insertOne" in op) {
        const companyId = resolveCompanyIdForCreate(op.insertOne.document, context, isExempt(op.insertOne.document));
        (op.insertOne.document as PlainObject).companyId = companyId;
      } else if ("updateOne" in op) {
        assertUpdateLeavesCompanyIdAlone(op.updateOne.update, context, false);
        if (condition) op.updateOne.filter = { $and: [op.updateOne.filter ?? {}, condition] };
      } else if ("updateMany" in op) {
        assertUpdateLeavesCompanyIdAlone(op.updateMany.update, context, false);
        if (condition) op.updateMany.filter = { $and: [op.updateMany.filter ?? {}, condition] };
      } else if ("replaceOne" in op) {
        const companyId = resolveCompanyIdForCreate(op.replaceOne.replacement, context, isExempt(op.replaceOne.replacement));
        (op.replaceOne.replacement as PlainObject).companyId = companyId;
        if (condition) op.replaceOne.filter = { $and: [op.replaceOne.filter ?? {}, condition] };
      } else if ("deleteOne" in op) {
        if (condition) op.deleteOne.filter = { $and: [op.deleteOne.filter ?? {}, condition] };
      } else if ("deleteMany" in op) {
        if (condition) op.deleteMany.filter = { $and: [op.deleteMany.filter ?? {}, condition] };
      }
    }
  });

  tenantSchemas.add(schema);
}
