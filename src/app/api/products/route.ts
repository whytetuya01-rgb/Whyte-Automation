import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectMongoDB } from "@/lib/mongodb";
import { Product, ProductVariant, Category } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { withTransaction } from "@/lib/transaction";
import { parsePaginationParams, createPaginatedResponse } from "@/lib/pagination";
import { getCategoryVariantMatrix } from "@/lib/categoryConfig";
import { requireRole, requireSession } from "@/lib/api-auth";
import {
  ApiError,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from "@/lib/api-response";
import { createProductSchema } from "@/lib/validation/product";
import {
  findDuplicateVariantCode,
  normalizeVariantRows,
  serializeVariant,
  validateFinalVariantMatrix,
} from "@/lib/productVariantService";
import { normalizeProduct, normalizeProducts } from "@/lib/quotationNormalization";
import { redactProductsForRole } from "@/lib/variantRedaction";

export const dynamic = "force-dynamic";

/**
 * GET /api/products
 * Query params:
 *   ?page=1&pageSize=10  â†’ enables server-side database pagination
 *   ?search=...          â†’ database search across name, code, description
 *   ?type=...            â†’ filter by product type
 *   ?status=active|inactive|all â†’ filter by active status
 *   ?category=...        â†’ filter by category ID
 *   ?sort=...            â†’ database ordering
 *   ?all=true            â†’ returns all products (admin only)
 *   Default              â†’ returns only active products (estimator)
 * Includes variants[] for each product.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getCategoryAndDescendantIds(catId: number): Promise<number[]> {
  const ids: number[] = [catId];
  const children = await Category.find({ parentId: catId }, { _id: 1 }).lean();
  for (const child of children) {
    const subIds = await getCategoryAndDescendantIds(child._id as number);
    ids.push(...subIds);
  }
  return ids;
}

export async function GET(req: Request) {
  // Every product read is business data, so the whole endpoint requires a
  // session. `?all=true` no longer needs its own check because the default
  // (active products) is authenticated too.
  let callerRole: string | undefined;
  try {
    const session = await requireSession();
    callerRole = (session.user as { role?: string }).role;
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/products" });
  }

  const { searchParams } = new URL(req.url);
  const showAll = searchParams.get("all") === "true";
  const isPaginated = searchParams.has("page") || searchParams.has("pageSize");

  const searchParam = searchParams.get("search")?.trim();
  const typeParam = searchParams.get("type")?.trim();
  const statusParam = searchParams.get("status")?.trim();
  const categoryParam = searchParams.get("category")?.trim();
  const automationTierParam = searchParams.get("automationTier")?.trim();
  const surfaceFinishParam = searchParams.get("surfaceFinish")?.trim();
  const sortParam = searchParams.get("sort")?.trim();
  const sortByParam = searchParams.get("sortBy")?.trim();
  const sortOrderParam = searchParams.get("sortOrder")?.trim();

  try {
    await connectMongoDB();

    const andConditions: Array<Record<string, unknown>> = [];

    // Active status filter
    if (statusParam === "active") {
      andConditions.push({ isActive: true });
    } else if (statusParam === "inactive") {
      andConditions.push({ isActive: false });
    } else if (!showAll) {
      andConditions.push({ isActive: true });
    }

    // Type filter
    if (typeParam && typeParam !== "all") {
      andConditions.push({ type: typeParam });
    }

    // Category filter (includes subcategories if any)
    if (categoryParam && categoryParam !== "all") {
      const catId = parseInt(categoryParam, 10);
      if (Number.isFinite(catId)) {
        const descendantIds = await getCategoryAndDescendantIds(catId);
        if (descendantIds.length > 1) {
          andConditions.push({ categoryId: { $in: descendantIds } });
        } else {
          andConditions.push({ categoryId: catId });
        }
      }
    }

    // Automation Tier and Surface Finish filters (handles single products & matrix variants)
    const hasTier = Boolean(automationTierParam && automationTierParam !== "all");
    const hasFinish = Boolean(surfaceFinishParam && surfaceFinishParam !== "all");

    if (hasTier && hasFinish) {
      const tierRegex = new RegExp(`^${escapeRegex(automationTierParam!)}$`, "i");
      const finishRegex = new RegExp(`^${escapeRegex(surfaceFinishParam!)}$`, "i");

      // Variant must match BOTH tier and finish within the exact same variant
      const variantCondition: Record<string, unknown> = {
        automationTier: { $regex: tierRegex },
        surfaceFinish: { $regex: finishRegex },
      };
      if (!showAll) {
        variantCondition.isActive = true;
      }

      const matchingVariantProductIds = await ProductVariant.distinct("productId", variantCondition);

      andConditions.push({
        $or: [
          {
            automationTier: { $regex: tierRegex },
            surfaceFinish: { $regex: finishRegex },
          },
          { _id: { $in: matchingVariantProductIds } },
        ],
      });
    } else if (hasTier) {
      const tierRegex = new RegExp(`^${escapeRegex(automationTierParam!)}$`, "i");
      const variantCondition: Record<string, unknown> = {
        automationTier: { $regex: tierRegex },
      };
      if (!showAll) {
        variantCondition.isActive = true;
      }

      const matchingVariantProductIds = await ProductVariant.distinct("productId", variantCondition);

      andConditions.push({
        $or: [
          { automationTier: { $regex: tierRegex } },
          { _id: { $in: matchingVariantProductIds } },
        ],
      });
    } else if (hasFinish) {
      const finishRegex = new RegExp(`^${escapeRegex(surfaceFinishParam!)}$`, "i");
      const variantCondition: Record<string, unknown> = {
        surfaceFinish: { $regex: finishRegex },
      };
      if (!showAll) {
        variantCondition.isActive = true;
      }

      const matchingVariantProductIds = await ProductVariant.distinct("productId", variantCondition);

      andConditions.push({
        $or: [
          { surfaceFinish: { $regex: finishRegex } },
          { _id: { $in: matchingVariantProductIds } },
        ],
      });
    }

    // Has variants filter
    const hasVariantsParam = searchParams.get("hasVariants")?.trim();
    if (hasVariantsParam === "yes" || hasVariantsParam === "has_variants") {
      const prodsWithVariants = await ProductVariant.distinct("productId");
      andConditions.push({ _id: { $in: prodsWithVariants } });
    } else if (hasVariantsParam === "no" || hasVariantsParam === "no_variants") {
      const prodsWithVariants = await ProductVariant.distinct("productId");
      andConditions.push({ _id: { $nin: prodsWithVariants } });
    }

    // Search filter across name, code, description, and variantCode
    if (searchParam) {
      const searchRegex = new RegExp(escapeRegex(searchParam), "i");
      const matchingVariantProductIds = await ProductVariant.distinct("productId", {
        $or: [
          { variantCode: { $regex: searchRegex } },
          { code: { $regex: searchRegex } },
          { name: { $regex: searchRegex } },
          { "config.code": { $regex: searchRegex } },
          { "config.name": { $regex: searchRegex } },
        ],
      });

      andConditions.push({
        $or: [
          { name: { $regex: searchRegex } },
          { code: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
          { _id: { $in: matchingVariantProductIds } },
        ],
      });
    }

    const filter: Record<string, unknown> = andConditions.length > 0 ? { $and: andConditions } : {};

    // Sorting
    let sortOptions: Record<string, 1 | -1> = { sortOrder: 1, _id: 1 };
    if (sortParam === "sortOrder_asc" || sortParam === "sortOrder" || sortByParam === "sortOrder") {
      sortOptions = { sortOrder: 1, _id: 1 };
    } else if (sortParam === "sortOrder_desc") {
      sortOptions = { sortOrder: -1, _id: -1 };
    } else if (sortParam === "newest" || (sortByParam === "createdAt" && sortOrderParam === "desc")) {
      sortOptions = { createdAt: -1, _id: -1 };
    } else if (sortParam === "oldest" || (sortByParam === "createdAt" && sortOrderParam === "asc")) {
      sortOptions = { createdAt: 1, _id: 1 };
    } else if (sortParam === "name_asc") {
      sortOptions = { name: 1, _id: 1 };
    } else if (sortParam === "name_desc") {
      sortOptions = { name: -1, _id: -1 };
    } else if (sortParam === "code_asc") {
      sortOptions = { code: 1, _id: 1 };
    } else if (sortParam === "price_asc") {
      sortOptions = { price: 1, name: 1, _id: 1 };
    } else if (sortParam === "price_desc") {
      sortOptions = { price: -1, name: 1, _id: 1 };
    }

    const populateOptions = [
      {
        path: "category",
        populate: {
          path: "parent",
          populate: { path: "parent" },
        },
      },
      {
        path: "variants",
        match: showAll ? {} : { isActive: true },
        options: { sort: { sortOrder: 1 } },
      },
    ];

    if (isPaginated) {
      const paginationParams = parsePaginationParams(searchParams, {
        defaultPageSize: 10,
        maxPageSize: 100,
      });

      const [total, rawProducts, totalProducts, totalActive, totalVariants, totalCategories] = await Promise.all([
        Product.countDocuments(filter),
        Product.find(filter)
          .sort(sortOptions)
          .skip(paginationParams.skip)
          .limit(paginationParams.take)
          .populate(populateOptions)
          .lean({ virtuals: true, getters: true }),
        Product.countDocuments({}),
        Product.countDocuments({ isActive: true }),
        ProductVariant.countDocuments({}),
        Category.countDocuments({ isActive: true }),
      ]);

      const products = redactProductsForRole(normalizeProducts(rawProducts), callerRole);

      const paginatedRes = createPaginatedResponse(products, total, paginationParams);
      return NextResponse.json({
        ...paginatedRes,
        stats: {
          totalProducts,
          totalActive,
          totalVariants,
          totalCategories,
        },
      });
    }

    const rawProducts = await Product.find(filter)
      .sort(sortOptions)
      .populate(populateOptions)
      .lean({ virtuals: true, getters: true });

    const products = redactProductsForRole(normalizeProducts(rawProducts), callerRole);

    return NextResponse.json(products);
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/products" });
  }
}

/**
 * POST /api/products
 * Body: { name, code, type, categoryId, unit, imageUrl, moduleSize, notes,
 *         isActive, sortOrder, variants[] }
 * variants: [{ automationTier?, surfaceFinish?, variantCode, price }]
 *
 * The category master matrix is authoritative: every submitted combination must
 * be one the category defines. The submitted (possibly partial) matrix is
 * persisted exactly as the final state of the product.
 *
 * Responds with the standard envelope:
 *   201 { success: true, data: product }
 *   4xx/5xx { success: false, error: { code, message, field?, details? } }
 */
export async function POST(req: Request) {
  try {
    // Catalog writes are restricted to Super Admin / Admin. A dealer session
    // must never be able to create products, even by calling this API directly.
    await requireRole("super_admin", "admin");

    await connectMongoDB();

    const rawBody = await readJsonBody(req);
    const parsed = createProductSchema.safeParse(rawBody);
    if (!parsed.success) throw parsed.error;

    const { variants: variantsInput, ...productData } = parsed.data;
    const categoryId = productData.categoryId;

    // 1. Authoritative category validation
    const category = await Category.findById(categoryId);
    if (!category) {
      throw new ApiError("NOT_FOUND", "The selected category does not exist.", {
        field: "categoryId",
      });
    }
    if (!category.isActive) {
      throw new ApiError("CONFLICT", "The selected category is inactive.", { field: "categoryId" });
    }

    // 2. Validate the submitted final matrix against the category master matrix
    const matrixResult = validateFinalVariantMatrix({
      category,
      submittedRows: variantsInput,
    });
    if (!matrixResult.valid) {
      throw new ApiError(matrixResult.error.code, matrixResult.error.message, {
        field: matrixResult.error.field,
      });
    }

    // 3. Normalise rows and enforce per-product variant code uniqueness
    const finalVariants = normalizeVariantRows(variantsInput);

    const duplicateCode = findDuplicateVariantCode(
      finalVariants.map((row) => ({ id: null, variantCode: row.variantCode }))
    );
    if (duplicateCode) {
      throw new ApiError(
        "DUPLICATE_RECORD",
        `Variant code '${duplicateCode.variantCode}' is used by more than one variant of this product.`,
        { field: "variants" }
      );
    }

    // 4. Application-level product code uniqueness (no DB unique index on purpose)
    if (productData.code) {
      const codeOwner = await Product.findOne({ code: productData.code }).select("_id").lean();
      if (codeOwner) {
        throw new ApiError("DUPLICATE_RECORD", `Product code '${productData.code}' is already in use.`, {
          field: "code",
        });
      }
    }

    const matrix = getCategoryVariantMatrix(category);

    const matrixDimensions = matrix.hasMatrix
      ? [
          ...(matrix.hasAutomationTiers
            ? [
                {
                  key: "series",
                  label: "Automation Tier",
                  name: "Automation",
                  options: matrix.configuredTiers.map((t) => t.value),
                  values: matrix.configuredTiers.map((t) => t.value),
                },
              ]
            : []),
          ...(matrix.hasSurfaceFinishes
            ? [
                {
                  key: "finish",
                  label: "Surface Finish",
                  name: "Finish",
                  options: matrix.configuredFinishes.map((f) => f.value),
                  values: matrix.configuredFinishes.map((f) => f.value),
                },
              ]
            : []),
        ]
      : null;

    // 5. Atomic Product + ProductVariant creation
    const createdProduct = await withTransaction(async (dbSession) => {
      const nextProductId = await getNextSequence("product", Product, dbSession);

      const newProduct = new Product({
        _id: nextProductId,
        name: productData.name,
        code: productData.code,
        description: productData.description,
        type: productData.type,
        categoryId,
        // Legacy product-level tier/finish stay null: the matrix lives on the variants.
        automationTier: null,
        surfaceFinish: null,
        unit: productData.unit ?? "pcs",
        imageUrl: productData.imageUrl,
        imagePublicId: productData.imagePublicId,
        moduleSize: productData.moduleSize,
        notes: productData.notes,
        sortOrder: productData.sortOrder ?? 0,
        isActive: productData.isActive ?? true,
        isMatrix: matrix.hasMatrix,
        matrixDimensions,
      });

      if (dbSession) {
        await newProduct.save({ session: dbSession });
      } else {
        await newProduct.save();
      }

      const variantDocs = finalVariants.map((row, index) => ({
        _id: 0, // replaced below
        productId: nextProductId,
        variantCode: row.variantCode,
        code: row.variantCode,
        name: row.displayName,
        automationTier: row.automationTier,
        surfaceFinish: row.surfaceFinish,
        config: {
          series: row.automationTier,
          finish: row.surfaceFinish,
          variantCode: row.variantCode,
        },
        price: mongoose.Types.Decimal128.fromString(row.price.toFixed(2)),
        priceWithoutTax: mongoose.Types.Decimal128.fromString(row.priceWithoutTax.toFixed(2)),
        taxPercent: mongoose.Types.Decimal128.fromString(row.taxPercent.toFixed(2)),
        cost: mongoose.Types.Decimal128.fromString(row.cost.toFixed(2)),
        purchaseTaxPercent: mongoose.Types.Decimal128.fromString(row.purchaseTaxPercent.toFixed(2)),
        sortOrder: index,
        isActive: true,
      }));

      for (const doc of variantDocs) {
        doc._id = await getNextSequence("productVariant", ProductVariant, dbSession);
      }

      try {
        if (dbSession) {
          await ProductVariant.insertMany(variantDocs, { session: dbSession });
        } else {
          await ProductVariant.insertMany(variantDocs);
        }
      } catch (insertErr) {
        // Rollback fallback for standalone MongoDB instances without a replica set
        if (!dbSession) {
          await Product.deleteOne({ _id: nextProductId }).catch(() => {});
        }
        throw insertErr;
      }

      let query = Product.findById(nextProductId);
      if (dbSession) query = query.session(dbSession);
      return await query.populate({
        path: "variants",
        options: { sort: { sortOrder: 1 } },
      });
    });

    return apiSuccess(
      normalizeProduct(createdProduct?.toObject ? createdProduct.toObject() : createdProduct),
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/products" });
  }
}
