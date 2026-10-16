import type { mongo } from "mongoose";
import {
  AdminUser,
  Category,
  HouseType,
  HouseTypeRoomTemplate,
  Product,
  ProductVariant,
  ProductVariantHistory,
  Quotation,
  QuotationAuditEvent,
  QuotationItem,
  QuotationRoom,
  RoleDefinition,
  RoomType,
} from "@/models";
import { DeletionAuditEvent } from "@/models/DeletionAuditEvent";
import { planCounterBootstrap } from "@/lib/counterBootstrap";
import { DEFAULT_COMPANY_SLUG } from "@/lib/tenant/constants";
import { KNOWN_ORPHAN_EXCEPTIONS, type KnownOrphanException } from "@/lib/migrations/knownOrphans";
import { classifyImagePublicId } from "@/lib/uploadPaths";

/**
 * Dry-run of the tenant backfill (assigning every existing record to the
 * default company). READ-ONLY: it only ever calls find/count/aggregate on the
 * handle it is given — the CLI passes a `readOnlyDb()` wrapper that throws on
 * any write — and it is deterministic (no clock, no randomness, fully sorted
 * output), so re-running it on unchanged data yields an identical report.
 *
 * Ownership rule: a record with no companyId belongs to the default company
 * (the confirmed Phase 1 decision) — but only while nothing contradicts that.
 * A record whose relationships point at a DIFFERENT company, or at nothing, is
 * an error, never silently assigned. Nothing here guesses.
 */

type Db = mongo.Db;
type Doc = Record<string, unknown> & { _id: string | number };

export type Severity = "error" | "warning" | "info";
export type Action = "create" | "update" | "skip" | "error";

export interface Diagnostic {
  severity: Severity;
  collection: string;
  id: string | number | null;
  code: string;
  message: string;
}

export interface CollectionSummary {
  collection: string;
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
}

export interface BackfillReport {
  companySlug: string;
  defaultCompany: { exists: boolean; id: number; action: "create" | "skip" };
  collections: CollectionSummary[];
  totals: { create: number; update: number; skip: number; error: number };
  diagnostics: Diagnostic[];
  diagnosticCounts: { error: number; warning: number; info: number };
  /** Declared orphan exceptions: how many were declared, and which exact records were found and preserved. */
  orphanExceptions: { declared: number; preserved: Array<{ collection: string; id: string | number; field: string; missingValue: string | number }> };
  /** True when there is nothing blocking: zero error-level diagnostics. */
  ok: boolean;
}

interface Ref {
  field: string;
  parent: string;
  nullable: boolean;
}

interface TenantCollection {
  name: string;
  refs: Ref[];
  /** Pure ownership exemption (platform accounts, global role templates). */
  exempt?: (doc: Doc) => boolean;
}

const TENANT_COLLECTIONS: TenantCollection[] = [
  { name: Category.collection.name, refs: [] },
  { name: RoomType.collection.name, refs: [] },
  { name: HouseType.collection.name, refs: [] },
  {
    name: HouseTypeRoomTemplate.collection.name,
    refs: [
      { field: "houseTypeId", parent: HouseType.collection.name, nullable: false },
      { field: "roomTypeId", parent: RoomType.collection.name, nullable: false },
    ],
  },
  { name: Product.collection.name, refs: [{ field: "categoryId", parent: Category.collection.name, nullable: true }] },
  { name: ProductVariant.collection.name, refs: [{ field: "productId", parent: Product.collection.name, nullable: false }] },
  { name: ProductVariantHistory.collection.name, refs: [{ field: "productId", parent: Product.collection.name, nullable: false }] },
  {
    name: AdminUser.collection.name,
    refs: [],
    exempt: (d) => d.role === "super_admin",
  },
  {
    name: Quotation.collection.name,
    refs: [
      { field: "houseTypeId", parent: HouseType.collection.name, nullable: true },
      { field: "dealerId", parent: AdminUser.collection.name, nullable: true },
      { field: "assignedSalesId", parent: AdminUser.collection.name, nullable: true },
    ],
  },
  {
    name: QuotationRoom.collection.name,
    refs: [
      { field: "quotationId", parent: Quotation.collection.name, nullable: false },
      { field: "roomTypeId", parent: RoomType.collection.name, nullable: true },
    ],
  },
  {
    name: QuotationItem.collection.name,
    refs: [
      { field: "quotationRoomId", parent: QuotationRoom.collection.name, nullable: false },
      { field: "productId", parent: Product.collection.name, nullable: false },
      { field: "productVariantId", parent: ProductVariant.collection.name, nullable: true },
    ],
  },
  { name: QuotationAuditEvent.collection.name, refs: [{ field: "quotationId", parent: Quotation.collection.name, nullable: false }] },
  { name: DeletionAuditEvent.collection.name, refs: [] },
  {
    name: RoleDefinition.collection.name,
    refs: [],
    exempt: (d) => d.isSystem === true && (d.companyId === undefined || d.companyId === null),
  },
];

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const CLOUDINARY_URL = /^https:\/\/res\.cloudinary\.com\//;

export async function planTenantBackfill(
  db: Db,
  options: { companySlug?: string; knownOrphans?: readonly KnownOrphanException[] } = {}
): Promise<BackfillReport> {
  const knownOrphans = options.knownOrphans ?? KNOWN_ORPHAN_EXCEPTIONS;
  const orphanKey = (collection: string, id: string | number, field: string, value: string | number) => `${collection}|${String(id)}|${field}|${String(value)}`;
  const declaredOrphans = new Map(knownOrphans.map((e) => [orphanKey(e.collection, e.id, e.field, e.missingValue), e]));
  const preservedOrphans = new Set<string>();
  const companySlug = options.companySlug ?? DEFAULT_COMPANY_SLUG;
  const diagnostics: Diagnostic[] = [];
  const diag = (severity: Severity, collection: string, id: string | number | null, code: string, message: string) =>
    diagnostics.push({ severity, collection, id, code, message });

  // ── Companies ────────────────────────────────────────────────────────────
  const companies = await db.collection("companies").find({}, { projection: { slug: 1, status: 1 } }).sort({ _id: 1 }).toArray();
  const companyIds = new Set<number>(companies.map((c) => c._id as unknown as number));

  const slugOwners = new Map<string, Array<string | number>>();
  for (const c of companies) {
    const slug = String(c.slug ?? "");
    slugOwners.set(slug, [...(slugOwners.get(slug) ?? []), c._id as unknown as number]);
  }
  for (const [slug, ids] of slugOwners) {
    if (ids.length > 1) diag("error", "companies", ids[0], "DUPLICATE_COMPANY_SLUG", `Company slug '${slug}' is used by ${ids.length} companies (${ids.join(", ")}).`);
  }

  const existingDefault = companies.find((c) => c.slug === companySlug);
  const maxCompanyId = companies.reduce((m, c) => Math.max(m, c._id as unknown as number), 0);
  // The id the default company will get if it has to be created: what the
  // `company` sequence would hand out next. Deterministic, and never a real id.
  const defaultCompanyId = existingDefault ? (existingDefault._id as unknown as number) : maxCompanyId + 1;
  if (existingDefault && existingDefault.status !== "active") {
    diag("error", "companies", defaultCompanyId, "DEFAULT_COMPANY_NOT_ACTIVE", `Default company '${companySlug}' has status '${String(existingDefault.status)}'; its users could not sign in.`);
  }

  // ── Load every tenant collection (read-only, bounded projections) ───────
  const loaded = new Map<string, Doc[]>();
  for (const { name } of TENANT_COLLECTIONS) {
    loaded.set(name, (await db.collection(name).find({}).sort({ _id: 1 }).toArray()) as unknown as Doc[]);
  }

  // Effective owner per record: explicit companyId, else the default company;
  // `null` for exempt platform records.
  const owner = new Map<string, Map<string, number | null>>();
  const summaries = new Map<string, CollectionSummary>();
  const errored = new Map<string, Set<string>>();
  const updated = new Map<string, Set<string>>();

  const markError = (collection: string, id: string | number) => {
    const set = errored.get(collection) ?? new Set<string>();
    set.add(String(id));
    errored.set(collection, set);
  };

  for (const spec of TENANT_COLLECTIONS) {
    const docs = loaded.get(spec.name) ?? [];
    const ownerOf = new Map<string, number | null>();
    owner.set(spec.name, ownerOf);
    updated.set(spec.name, new Set());

    for (const doc of docs) {
      const id = String(doc._id);
      if (spec.exempt?.(doc)) {
        ownerOf.set(id, null);
        continue;
      }
      const explicit = doc.companyId;
      if (explicit === undefined || explicit === null) {
        ownerOf.set(id, defaultCompanyId);
        updated.get(spec.name)!.add(id);
      } else if (typeof explicit !== "number") {
        ownerOf.set(id, null);
        diag("error", spec.name, doc._id, "COMPANY_ID_INVALID_TYPE", `companyId is ${typeof explicit}, expected a number.`);
        markError(spec.name, doc._id);
      } else if (!companyIds.has(explicit) && explicit !== defaultCompanyId) {
        ownerOf.set(id, explicit);
        diag("error", spec.name, doc._id, "COMPANY_MISSING", `companyId ${explicit} does not match any company.`);
        markError(spec.name, doc._id);
      } else {
        ownerOf.set(id, explicit);
      }
    }
  }

  // ── Cross-collection references: missing parent, or a different owner ──
  for (const spec of TENANT_COLLECTIONS) {
    const childOwners = owner.get(spec.name)!;
    for (const doc of loaded.get(spec.name) ?? []) {
      const id = String(doc._id);
      const childOwner = childOwners.get(id);
      const explicitChild = doc.companyId !== undefined && doc.companyId !== null;

      for (const ref of spec.refs) {
        const value = doc[ref.field];
        if (value === undefined || value === null) {
          if (!ref.nullable) {
            diag("error", spec.name, doc._id, "MISSING_REFERENCE", `${ref.field} is empty but required.`);
            markError(spec.name, doc._id);
          }
          continue;
        }
        const parentOwners = owner.get(ref.parent);
        if (!parentOwners || !parentOwners.has(String(value))) {
          const key = orphanKey(spec.name, doc._id, ref.field, value as string | number);
          const exception = declaredOrphans.get(key);
          if (exception) {
            // Explicitly approved: keep the record untouched (it still gets the default company like any legacy record).
            preservedOrphans.add(key);
            diag("info", spec.name, doc._id, "KNOWN_ORPHAN_PRESERVED", `${ref.field} ${String(value)} does not exist in ${ref.parent}; preserved as a documented exception: ${exception.reason}`);
            continue;
          }
          diag("error", spec.name, doc._id, "MISSING_REFERENCE", `${ref.field} ${String(value)} does not exist in ${ref.parent}.`);
          markError(spec.name, doc._id);
          continue;
        }
        const parentOwner = parentOwners.get(String(value));
        if (parentOwner === null || childOwner === null || childOwner === undefined) continue; // platform record: nothing to compare
        if (parentOwner !== childOwner) {
          const code = explicitChild ? "CROSS_COMPANY_REFERENCE" : "AMBIGUOUS_OWNERSHIP";
          const detail = explicitChild
            ? `belongs to company ${childOwner} but ${ref.field} ${String(value)} (${ref.parent}) belongs to company ${parentOwner}.`
            : `has no company, and ${ref.field} ${String(value)} (${ref.parent}) belongs to company ${parentOwner}, not the default ${defaultCompanyId}; not assigned automatically.`;
          diag("error", spec.name, doc._id, code, detail);
          markError(spec.name, doc._id);
        }
      }
    }
  }

  // A declared exception that no longer matches anything is stale: say so (never silently ignored).
  for (const [key, exception] of declaredOrphans) {
    if (!preservedOrphans.has(key)) {
      diag("warning", exception.collection, exception.id, "KNOWN_ORPHAN_EXCEPTION_UNUSED", `Declared exception for ${exception.field} ${String(exception.missingValue)} matched nothing; remove it or re-check the record.`);
    }
  }

  // ── Uniqueness the new indexes will enforce ──────────────────────────────
  const emailOwners = new Map<string, Array<string | number>>();
  for (const doc of loaded.get(AdminUser.collection.name) ?? []) {
    const email = String(doc.email ?? "").trim().toLowerCase();
    emailOwners.set(email, [...(emailOwners.get(email) ?? []), doc._id]);
  }
  for (const [email, ids] of emailOwners) {
    if (ids.length > 1) {
      diag("error", AdminUser.collection.name, ids[0], "DUPLICATE_EMAIL", `Email '${email}' is used by ${ids.length} accounts (${ids.join(", ")}); email must stay globally unique.`);
      for (const id of ids) markError(AdminUser.collection.name, id);
    }
  }

  const quotationOwners = new Map<string, Array<string | number>>();
  for (const doc of loaded.get(Quotation.collection.name) ?? []) {
    const key = `${owner.get(Quotation.collection.name)!.get(String(doc._id))}|${String(doc.quotationNumber)}`;
    quotationOwners.set(key, [...(quotationOwners.get(key) ?? []), doc._id]);
  }
  for (const [key, ids] of quotationOwners) {
    if (ids.length > 1) {
      diag("error", Quotation.collection.name, ids[0], "DUPLICATE_QUOTATION_NUMBER", `Quotation number '${key.split("|")[1]}' repeats within one company (${ids.join(", ")}).`);
      for (const id of ids) markError(Quotation.collection.name, id);
    }
  }

  const roleKeys = new Map<string, Array<string | number>>();
  for (const doc of loaded.get(RoleDefinition.collection.name) ?? []) {
    const key = `${owner.get(RoleDefinition.collection.name)!.get(String(doc._id))}|${String(doc.key)}`;
    roleKeys.set(key, [...(roleKeys.get(key) ?? []), doc._id]);
  }
  for (const [key, ids] of roleKeys) {
    if (ids.length > 1) {
      diag("error", RoleDefinition.collection.name, ids[0], "DUPLICATE_ROLE_KEY", `Role key '${key.split("|")[1]}' repeats within one company (${ids.join(", ")}).`);
      for (const id of ids) markError(RoleDefinition.collection.name, id);
    }
  }

  // ── Image assets ─────────────────────────────────────────────────────────
  const assetOwners = new Map<string, Set<number>>();
  let legacyAssets = 0;
  for (const doc of loaded.get(Product.collection.name) ?? []) {
    const publicId = typeof doc.imagePublicId === "string" ? doc.imagePublicId.trim() : "";
    const url = typeof doc.imageUrl === "string" ? doc.imageUrl.trim() : "";
    if (url && !CLOUDINARY_URL.test(url)) {
      diag("warning", Product.collection.name, doc._id, "IMAGE_URL_NOT_CLOUDINARY", "imageUrl is not a Cloudinary URL; it is left as-is.");
    }
    if (!publicId) continue;

    const productOwner = owner.get(Product.collection.name)!.get(String(doc._id));
    if (typeof productOwner !== "number") continue;

    if (url && !url.includes(publicId)) {
      diag("warning", Product.collection.name, doc._id, "IMAGE_URL_MISMATCH", `imageUrl does not contain imagePublicId '${publicId}'.`);
    }

    const verdict = classifyImagePublicId(publicId, { companyId: productOwner, legacyOwnerCompanyId: defaultCompanyId });
    if (verdict === "own") {
      if (publicId.startsWith("whyte/products/")) legacyAssets += 1;
      assetOwners.set(publicId, (assetOwners.get(publicId) ?? new Set()).add(productOwner));
    } else {
      const why =
        verdict === "malformed"
          ? "is not a safe path"
          : verdict === "outside"
          ? "is outside the product image folders"
          : "belongs to a different company's folder, or is a legacy asset on a company that does not own legacy assets";
      diag("error", Product.collection.name, doc._id, "UNSAFE_ASSET_PATH", `imagePublicId '${publicId}' ${why}.`);
      markError(Product.collection.name, doc._id);
    }
  }
  for (const [publicId, owners] of assetOwners) {
    if (owners.size > 1) {
      diag("error", Product.collection.name, null, "ASSET_SHARED_ACROSS_COMPANIES", `Asset '${publicId}' is referenced by products of ${owners.size} companies; deleting it from one would break the others.`);
    }
  }
  if (legacyAssets > 0) {
    diag("info", Product.collection.name, null, "LEGACY_ASSETS_KEPT", `${legacyAssets} product image(s) stay at their existing 'whyte/products/' path under the default company; no URL or public id changes.`);
  }

  // ── Counters, as they will look once the backfill has run ───────────────
  const counterPlan = await planCounterBootstrap(db, {
    defaultCompanySlug: companySlug,
    unassignedCompanyId: defaultCompanyId,
    plannedDefaultCompanyId: existingDefault ? undefined : defaultCompanyId,
  });
  for (const conflict of counterPlan.conflicts) {
    diag(conflict.severity, "counters", null, conflict.code, `${conflict.message}${conflict.records?.length ? ` [${conflict.records.join(", ")}]` : ""}`);
  }
  const counterSummary: CollectionSummary = { collection: "counters", total: counterPlan.entries.length, create: 0, update: 0, skip: 0, error: 0 };
  for (const entry of counterPlan.entries) {
    if (entry.action === "create") counterSummary.create += 1;
    else if (entry.action === "advance") {
      counterSummary.update += 1;
      diag("warning", "counters", entry.counter, "COUNTER_BEHIND_DATA", `Counter '${entry.counter}' is ${entry.currentSeq} but existing data goes up to ${entry.dataMax}; it would be advanced to ${entry.target}.`);
    } else counterSummary.skip += 1;
  }
  counterSummary.error = counterPlan.conflicts.filter((c) => c.severity === "error").length;

  // ── Summaries ────────────────────────────────────────────────────────────
  const collections: CollectionSummary[] = [];
  const companySummary: CollectionSummary = {
    collection: "companies",
    total: companies.length,
    create: existingDefault ? 0 : 1,
    update: 0,
    skip: companies.length,
    error: diagnostics.filter((d) => d.collection === "companies" && d.severity === "error").length,
  };
  collections.push(companySummary);

  for (const spec of TENANT_COLLECTIONS) {
    const docs = loaded.get(spec.name) ?? [];
    const summary: CollectionSummary = { collection: spec.name, total: docs.length, create: 0, update: 0, skip: 0, error: 0 };
    for (const doc of docs) {
      const id = String(doc._id);
      if (errored.get(spec.name)?.has(id)) summary.error += 1;
      else if (updated.get(spec.name)?.has(id)) summary.update += 1;
      else summary.skip += 1;
    }
    summaries.set(spec.name, summary);
    collections.push(summary);
  }
  collections.push(counterSummary);
  collections.sort((a, b) => a.collection.localeCompare(b.collection));

  const totals = collections.reduce(
    (acc, c) => ({ create: acc.create + c.create, update: acc.update + c.update, skip: acc.skip + c.skip, error: acc.error + c.error }),
    { create: 0, update: 0, skip: 0, error: 0 }
  );

  diagnostics.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.collection.localeCompare(b.collection) ||
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true }) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message)
  );
  const diagnosticCounts = {
    error: diagnostics.filter((d) => d.severity === "error").length,
    warning: diagnostics.filter((d) => d.severity === "warning").length,
    info: diagnostics.filter((d) => d.severity === "info").length,
  };

  return {
    companySlug,
    defaultCompany: { exists: Boolean(existingDefault), id: defaultCompanyId, action: existingDefault ? "skip" : "create" },
    collections,
    totals,
    diagnostics,
    diagnosticCounts,
    orphanExceptions: {
      declared: knownOrphans.length,
      preserved: [...declaredOrphans].filter(([k]) => preservedOrphans.has(k)).map(([, e]) => ({ collection: e.collection, id: e.id, field: e.field, missingValue: e.missingValue })),
    },
    ok: diagnosticCounts.error === 0,
  };
}
