import { Category, Product, ProductVariant } from "@/models";
import { normalizeProduct } from "@/lib/quotationNormalization";
import { serializeVariant } from "@/lib/productVariantService";
import type { EditorCatalogProduct, EditorCatalogVariant } from "@/types";

/**
 * The product catalog shipped to the quotation editor as `initialProducts`.
 *
 * The editor only needs what its product picker reads (see
 * `EditorCatalogProduct`), so only those stored fields are selected, and only
 * those fields are emitted. Margin data (`cost`, `purchaseTaxPercent`) is never
 * selected at all, so the payload is identical for every role and nothing
 * internal can leak through it.
 *
 * Values are not re-derived here: products go through the shared
 * `normalizeProduct` and variants through `serializeVariant` - the same
 * functions the full catalog uses, which stay the only authority for price,
 * tax and tier/finish resolution - and the result is a plain subset of their
 * output.
 */

const PRODUCT_PROJECTION =
  "name code description type categoryId automationTier surfaceFinish price imageUrl moduleSize isActive isMatrix matrixDimensions";

// `serializeVariant` derives price from price / priceWithoutTax / taxPercent and falls
// back to config.series / config.finish when a variant has no tier / finish of its own.
const VARIANT_PROJECTION =
  "productId name code variantCode automationTier surfaceFinish price priceWithoutTax taxPercent isActive config.series config.finish";

type RawEditorProduct = { _id: number } & Record<string, unknown>;
type RawEditorVariant = Parameters<typeof serializeVariant>[0];
type RawEditorCategory = { _id: number; name?: string | null };

export interface EditorCatalogSources {
  /** Active products in display order. */
  products: RawEditorProduct[];
  /** Active variants in display order (a product's variants keep this relative order). */
  variants: RawEditorVariant[];
  categories: RawEditorCategory[];
}

function toEditorVariant(raw: RawEditorVariant): EditorCatalogVariant {
  const variant = serializeVariant(raw);
  return {
    id: variant.id,
    automationTier: variant.automationTier,
    surfaceFinish: variant.surfaceFinish,
    name: variant.name,
    price: variant.price,
    isActive: variant.isActive,
    // The picker's search treats a missing code exactly like an empty one.
    ...(variant.code ? { code: variant.code } : {}),
    ...(variant.variantCode ? { variantCode: variant.variantCode } : {}),
  };
}

export function buildEditorCatalog({ products, variants, categories }: EditorCatalogSources): EditorCatalogProduct[] {
  const variantsByProduct = new Map<number, EditorCatalogVariant[]>();
  for (const raw of variants) {
    const productId = Number(raw.productId);
    const bucket = variantsByProduct.get(productId);
    const variant = toEditorVariant(raw);
    if (bucket) bucket.push(variant);
    else variantsByProduct.set(productId, [variant]);
  }

  const categoryNames = new Map<number, string>();
  for (const category of categories) {
    if (category.name) categoryNames.set(Number(category._id), category.name);
  }

  return products.map((raw) => {
    const product = normalizeProduct({ ...raw, variants: [] });
    const categoryName = product.categoryId !== null ? categoryNames.get(product.categoryId) : undefined;
    return {
      id: product.id,
      name: product.name,
      code: product.code,
      description: product.description,
      type: product.type,
      categoryId: product.categoryId,
      automationTier: product.automationTier,
      surfaceFinish: product.surfaceFinish,
      ...(product.price !== undefined ? { price: product.price } : {}),
      imageUrl: product.imageUrl,
      moduleSize: product.moduleSize,
      isActive: product.isActive,
      isMatrix: product.isMatrix,
      matrixDimensions: product.matrixDimensions,
      ...(categoryName !== undefined && product.categoryId !== null
        ? { category: { id: product.categoryId, name: categoryName } }
        : {}),
      variants: variantsByProduct.get(product.id) ?? [],
    };
  });
}

/** Three independent projected `lean()` reads in parallel; they are joined in memory by `buildEditorCatalog`. */
export async function loadEditorCatalogSources(): Promise<EditorCatalogSources> {
  const [products, variants, categories] = await Promise.all([
    Product.find({ isActive: true }).select(PRODUCT_PROJECTION).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductVariant.find({ isActive: true }).select(VARIANT_PROJECTION).sort({ sortOrder: 1, _id: 1 }).lean(),
    Category.find({}).select("name").lean(),
  ]);

  return {
    products: products as unknown as RawEditorProduct[],
    variants: variants as unknown as RawEditorVariant[],
    categories: categories as unknown as RawEditorCategory[],
  };
}

export async function getEditorCatalog(): Promise<EditorCatalogProduct[]> {
  return buildEditorCatalog(await loadEditorCatalogSources());
}
