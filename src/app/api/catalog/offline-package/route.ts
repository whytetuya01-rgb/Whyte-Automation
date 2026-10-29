import { NextResponse } from "next/server";
import crypto from "crypto";
import { connectMongoDB } from "@/lib/mongodb";
import { withSession } from "@/lib/api-auth";
import { ApiError, handleApiError } from "@/lib/api-response";
import {
  Category,
  HouseType,
  RoomType,
  Company,
  AdminUser,
} from "@/models";
import { buildEditorCatalog, loadEditorCatalogSources } from "@/lib/editorCatalog";
import { normalizeCategories, normalizeHouseTypes, normalizeRoomTypes } from "@/lib/quotationNormalization";
import { isBathroomLikeRoomName } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/offline-package
 *
 * Secure, tenant-scoped, offline catalog download endpoint.
 * Delivers active products (with sanitized editor variants), categories,
 * house types, and room types for the authenticated company.
 * Strictly strips purchase cost and internal margin fields.
 */
interface VersionContext {
  companyId: number;
  userId: number;
  role: string;
  allocatedDiscountPercent: number;
}

function computeCatalogVersion(
  tenant: VersionContext,
  data: {
    products: ReturnType<typeof buildEditorCatalog>;
    categories: ReturnType<typeof normalizeCategories>;
    houseTypes: ReturnType<typeof normalizeHouseTypes>;
    roomTypes: ReturnType<typeof normalizeRoomTypes>;
  }
): string {
  const hash = crypto.createHash("sha256");

  // 1. Tenant & Role Authorization Context
  hash.update(`tenant:${tenant.companyId}:${tenant.userId}:${tenant.role}:${tenant.allocatedDiscountPercent}\n`);

  // 2. Categories
  const sortedCategories = [...data.categories].sort((a, b) => Number(a.id) - Number(b.id));
  for (const c of sortedCategories) {
    hash.update(`cat:${c.id}:${c.name ?? ""}:${c.sortOrder ?? 0}\n`);
  }

  // 3. Room Types
  const sortedRoomTypes = [...data.roomTypes].sort((a, b) => Number(a.id) - Number(b.id));
  for (const rt of sortedRoomTypes) {
    hash.update(`rt:${rt.id}:${rt.name ?? ""}:${rt.icon ?? ""}:${rt.sortOrder ?? 0}\n`);
  }

  // 4. House Types & Room Templates
  const sortedHouseTypes = [...data.houseTypes].sort((a, b) => Number(a.id) - Number(b.id));
  for (const ht of sortedHouseTypes) {
    hash.update(`ht:${ht.id}:${ht.name ?? ""}:${ht.description ?? ""}:${ht.sortOrder ?? 0}`);
    const templates = Array.isArray(ht.roomTemplate)
      ? [...ht.roomTemplate].sort((a, b) => Number(a.roomTypeId ?? a.id) - Number(b.roomTypeId ?? b.id))
      : [];
    for (const t of templates) {
      const count = (t as any).defaultCount ?? (t as any).quantity ?? 1;
      hash.update(`:tmpl:${t.roomTypeId}:${count}:${t.sortOrder ?? 0}:${t.roomType?.name ?? ""}`);
    }
    hash.update("\n");
  }

  // 5. Products & Variants (Names, descriptions, prices, image URLs, tiers, finishes)
  const sortedProducts = [...data.products].sort((a, b) => Number(a.id) - Number(b.id));
  for (const p of sortedProducts) {
    hash.update(
      `prod:${p.id}:${p.name ?? ""}:${p.description ?? ""}:${p.imageUrl ?? ""}:${p.categoryId ?? ""}:${p.automationTier ?? ""}:${p.surfaceFinish ?? ""}:${p.price ?? ""}:${p.isActive ? 1 : 0}\n`
    );
    const sortedVariants = [...(p.variants || [])].sort((a, b) => Number(a.id) - Number(b.id));
    for (const v of sortedVariants) {
      hash.update(
        `var:${v.id}:${v.code ?? ""}:${v.variantCode ?? ""}:${v.name ?? ""}:${v.automationTier ?? ""}:${v.surfaceFinish ?? ""}:${v.price ?? ""}:${v.isActive ? 1 : 0}\n`
      );
    }
  }

  return `v_${tenant.companyId}_${hash.digest("hex").slice(0, 16)}`;
}

import { createRequestTracer } from "@/lib/perfTracer";

export async function GET(request: Request) {
  const tracer = createRequestTracer(request, "GET", "/api/catalog/offline-package");
  try {
    return await withSession(async (actor) => {
      const { role, userId, companyId } = actor;

      if (actor._timings) {
        tracer.mark("Session Resolution", { durationMs: actor._timings.sessionResolutionMs });
        tracer.mark("Session Guard (DB/Cache)", { durationMs: actor._timings.sessionGuardMs });
        tracer.mark("Tenant Context", { durationMs: actor._timings.tenantContextMs });
      }

      if (!companyId) {
        throw new ApiError(
          "FORBIDDEN",
          role === "super_admin"
            ? "Super Admin must select an active company to download an offline catalog."
            : "No active company tenant context found."
        );
      }

      await tracer.measure("MongoDB Connection", () => connectMongoDB());

      const url = new URL(request.url);
      const checkVersionOnly = url.searchParams.get("checkVersionOnly") === "true";

      // 1. Fetch Company details and Dealer discount allocation
      const [companyDoc, userDoc] = await tracer.measure("Tenant Context Lookups", () =>
        Promise.all([
          Company.findById(companyId).select("name status").lean(),
          AdminUser.findById(userId).select("discountAllocationPercent isActive").lean(),
        ])
      );

      if (!companyDoc || companyDoc.status === "suspended") {
        throw new ApiError("FORBIDDEN", "Company is suspended or inactive.");
      }

      const allocatedDiscount = Number((userDoc as any)?.discountAllocationPercent || 0);

      // 2. Fetch Catalog Data in Parallel
      const [editorSources, rawCategories, rawHouseTypes, rawRoomTypes] = await tracer.measure("Raw Catalog Queries (Parallel)", () =>
        Promise.all([
          loadEditorCatalogSources(),
          Category.find({ isActive: true }).sort({ sortOrder: 1, _id: 1 }).lean(),
          HouseType.find({ isActive: true })
            .sort({ sortOrder: 1, _id: 1 })
            .populate({
              path: "roomTemplate",
              options: { sort: { sortOrder: 1 } },
              populate: { path: "roomType" },
            }),
          RoomType.find({ isActive: true }).sort({ sortOrder: 1, _id: 1 }).lean(),
        ])
      );

      const totalVariants = editorSources.variants.length;
      const tTrans = performance.now();
      const products = buildEditorCatalog(editorSources);
      tracer.mark("Products & Variants Transformation (buildEditorCatalog)", {
        durationMs: Number((performance.now() - tTrans).toFixed(2)),
        productsTransformed: products.length,
        variantsTransformed: totalVariants,
      });

      const cleanedHouseTypes = rawHouseTypes.map((htDoc) => {
        const ht = (typeof htDoc.toJSON === "function" ? htDoc.toJSON() : htDoc) as unknown as Record<string, unknown>;
        const templates = Array.isArray(ht.roomTemplate) ? ht.roomTemplate : [];
        return {
          ...ht,
          roomTemplate: templates.filter(
            (t: { roomType?: { name?: string } | null }) => !isBathroomLikeRoomName(t.roomType?.name)
          ),
        };
      });

      const categories = normalizeCategories(rawCategories as any);
      const houseTypes = normalizeHouseTypes(cleanedHouseTypes as any);
      const roomTypes = normalizeRoomTypes(rawRoomTypes as any);

      // 4. Compute reliable deterministic content-based catalog version hash
      const tHash = performance.now();
      const catalogVersion = computeCatalogVersion(
        {
          companyId,
          userId,
          role,
          allocatedDiscountPercent: allocatedDiscount,
        },
        {
          products,
          categories,
          houseTypes,
          roomTypes,
        }
      );
      tracer.mark("Content-based SHA-256 Version Hash", {
        durationMs: Number((performance.now() - tHash).toFixed(2)),
        productsHashed: products.length,
        variantsHashed: totalVariants,
      });

      // Fast-path: Check version only without transmitting full catalog data
      if (checkVersionOnly) {
        const tJson = performance.now();
        const jsonBody = JSON.stringify({
          success: true,
          catalogVersion,
          generatedAt: new Date().toISOString(),
          counts: {
            products: products.length,
            variants: totalVariants,
            categories: categories.length,
            houseTypes: houseTypes.length,
            roomTypes: roomTypes.length,
          },
        });
        tracer.mark("JSON Serialization (Version-Only)", {
          durationMs: Number((performance.now() - tJson).toFixed(2)),
          payloadBytes: Buffer.byteLength(jsonBody, "utf8"),
        });
        tracer.end({ checkVersionOnly: true });

        return new NextResponse(jsonBody, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      }

      const payload = {
        success: true,
        catalogVersion,
        generatedAt: new Date().toISOString(),
        tenant: {
          companyId,
          companyName: (companyDoc as any).name || "Whyte Automations",
          userId,
          role,
          allocatedDiscountPercent: allocatedDiscount,
        },
        counts: {
          products: products.length,
          variants: totalVariants,
          categories: categories.length,
          houseTypes: houseTypes.length,
          roomTypes: roomTypes.length,
        },
        products,
        categories,
        houseTypes,
        roomTypes,
      };

      const tJsonFull = performance.now();
      const fullJsonBody = JSON.stringify(payload);
      const payloadBytes = Buffer.byteLength(fullJsonBody, "utf8");
      tracer.mark("JSON Serialization (Full Package)", {
        durationMs: Number((performance.now() - tJsonFull).toFixed(2)),
        payloadBytes,
        payloadKb: Number((payloadBytes / 1024).toFixed(1)),
      });
      tracer.end({ checkVersionOnly: false, payloadBytes });

      return new NextResponse(fullJsonBody, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    });
  } catch (error) {
    tracer.mark("Error Handling");
    tracer.end();
    return handleApiError(error, { logPrefix: "GET /api/catalog/offline-package" });
  }
}
