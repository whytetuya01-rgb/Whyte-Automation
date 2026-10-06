import type { Quotation, QuotationRoom, QuotationItem, Category, RoomType, HouseType, Product, ProductVariant } from "@/types";
import { serializeVariant } from "@/lib/productVariantService";
import { calculateQuotationGst } from "@/lib/pricing";

/**
 * Normalizes a product variant to guarantee a plain, server-safe shape:
 * - numeric `id` and `productId`
 * - primitive strings for all Decimal128 values (price, priceWithoutTax, taxPercent, taxAmount, cost, purchaseTaxPercent)
 * - primary `automationTier` and `surfaceFinish` with formatted labels
 * - zero BSON / Mongoose objects with toJSON methods
 * - drops redundant config fields
 */
export function normalizeProductVariant(v: any): ProductVariant {
  return serializeVariant(v);
}

/**
 * Normalizes a product POJO or Mongoose document to guarantee a plain, server-safe shape:
 * - numeric `id` and `categoryId`
 * - fully normalized variants with string pricing
 * - no raw Decimal128 objects
 */
export function normalizeProduct(product: any): Product {
  if (!product || typeof product !== "object") return product;
  const id = Number(product.id ?? product._id ?? 0);
  const categoryId = product.categoryId !== undefined && product.categoryId !== null
    ? Number(product.categoryId)
    : (product.category?.id ? Number(product.category.id) : null);

  let priceStr: string | undefined;
  if (product.price !== undefined && product.price !== null) {
    if (typeof product.price === "object" && "$numberDecimal" in product.price) {
      priceStr = String(product.price.$numberDecimal);
    } else if (typeof product.price === "object" && typeof product.price.toString === "function") {
      priceStr = product.price.toString();
    } else {
      priceStr = String(product.price);
    }
  }

  const tier = product.automationTier ? String(product.automationTier).trim() : null;
  const finish = product.surfaceFinish ? String(product.surfaceFinish).trim() : null;

  const variants = Array.isArray(product.variants)
    ? product.variants.map((v: any) =>
        serializeVariant({ ...v, productId: v.productId ?? id })
      )
    : [];

  return {
    id,
    name: String(product.name ?? ""),
    code: product.code ? String(product.code) : null,
    description: product.description ? String(product.description) : null,
    type: product.type ?? "switch_board",
    categoryId,
    category: product.category ? normalizeCategory(product.category) : undefined,
    automationTier: tier,
    surfaceFinish: finish,
    ...(priceStr ? { price: priceStr } : {}),
    unit: product.unit ? String(product.unit) : "pcs",
    imageUrl: product.imageUrl ? String(product.imageUrl) : null,
    imagePublicId: product.imagePublicId ? String(product.imagePublicId) : null,
    moduleSize: product.moduleSize ? String(product.moduleSize) : null,
    notes: product.notes ? String(product.notes) : null,
    isActive: product.isActive !== false,
    sortOrder: typeof product.sortOrder === "number" ? product.sortOrder : Number(product.sortOrder || 0),
    isMatrix: Boolean(product.isMatrix),
    matrixDimensions: Array.isArray(product.matrixDimensions)
      ? product.matrixDimensions.map((d: any) => ({
          key: String(d.key),
          label: String(d.label),
          options: Array.isArray(d.options) ? d.options.map(String) : [],
        }))
      : null,
    variants,
  };
}

export function normalizeProducts(products: any[]): Product[] {
  if (!Array.isArray(products)) return [];
  return products.map(normalizeProduct);
}

/**
 * Normalizes a category POJO or Mongoose document to guarantee `id: number`
 * and recursively normalizes its `children`.
 */
export function normalizeCategory(cat: any): Category {
  if (!cat || typeof cat !== "object") return cat;
  const id = Number(cat.id ?? cat._id ?? 0);
  return {
    ...cat,
    id,
    _id: id,
    children: Array.isArray(cat.children) ? cat.children.map(normalizeCategory) : [],
  };
}

export function normalizeCategories(cats: any[]): Category[] {
  if (!Array.isArray(cats)) return [];
  return cats.map(normalizeCategory);
}

/**
 * Normalizes a room type to guarantee `id: number`.
 */
export function normalizeRoomType(rt: any): RoomType {
  if (!rt || typeof rt !== "object") return rt;
  const id = Number(rt.id ?? rt._id ?? 0);
  return {
    ...rt,
    id,
    _id: id,
  };
}

export function normalizeRoomTypes(rts: any[]): RoomType[] {
  if (!Array.isArray(rts)) return [];
  return rts.map(normalizeRoomType);
}

/**
 * Normalizes a house type to guarantee `id: number`.
 */
export function normalizeHouseType(ht: any): HouseType {
  if (!ht || typeof ht !== "object") return ht;
  const id = Number(ht.id ?? ht._id ?? 0);
  return {
    ...ht,
    id,
    _id: id,
    roomTemplate: Array.isArray(ht.roomTemplate)
      ? ht.roomTemplate.map((t: any) => ({
          ...t,
          id: Number(t.id ?? t._id ?? 0),
          roomType: t.roomType ? normalizeRoomType(t.roomType) : undefined,
        }))
      : undefined,
  };
}

export function normalizeHouseTypes(hts: any[]): HouseType[] {
  if (!Array.isArray(hts)) return [];
  return hts.map(normalizeHouseType);
}

/**
 * Normalizes a quotation item to guarantee `id: number`, `quotationRoomId: number`,
 * valid numeric `quantity`, populated `unitPrice`, and normalized nested product/variant.
 */
export function normalizeQuotationItem(item: any, fallbackRoomId?: number): QuotationItem {
  if (!item || typeof item !== "object") return item;
  const id = Number(item.id ?? item._id ?? 0);
  const quotationRoomId = Number(item.quotationRoomId ?? fallbackRoomId ?? 0);
  const quantity = Math.max(1, Number(item.quantity || 1));
  const rawUnitPrice = item.unitPrice !== undefined && item.unitPrice !== null
    ? (typeof item.unitPrice === "object" && "$numberDecimal" in item.unitPrice
        ? Number(item.unitPrice.$numberDecimal)
        : Number(item.unitPrice))
    : 0;
  const unitPrice = isNaN(rawUnitPrice) ? "0.00" : rawUnitPrice.toFixed(2);

  const rawTaxPercent = item.taxPercent !== undefined && item.taxPercent !== null
    ? (typeof item.taxPercent === "object" && "$numberDecimal" in item.taxPercent
        ? Number(item.taxPercent.$numberDecimal)
        : Number(item.taxPercent))
    : 18;
  const taxPercent = isNaN(rawTaxPercent) ? 18 : rawTaxPercent;

  let rawPriceWithoutTax: number;
  let rawTaxAmount: number;

  if (item.priceWithoutTax !== undefined && item.priceWithoutTax !== null) {
    rawPriceWithoutTax = typeof item.priceWithoutTax === "object" && "$numberDecimal" in item.priceWithoutTax
      ? Number(item.priceWithoutTax.$numberDecimal)
      : Number(item.priceWithoutTax);
  } else {
    rawPriceWithoutTax = Math.round((rawUnitPrice / (1 + taxPercent / 100)) * 100) / 100;
  }

  if (item.taxAmount !== undefined && item.taxAmount !== null) {
    rawTaxAmount = typeof item.taxAmount === "object" && "$numberDecimal" in item.taxAmount
      ? Number(item.taxAmount.$numberDecimal)
      : Number(item.taxAmount);
  } else {
    rawTaxAmount = Math.round((rawUnitPrice - rawPriceWithoutTax) * 100) / 100;
  }

  const product = item.product ? normalizeProduct(item.product) : undefined;
  const productVariant = item.productVariant
    ? serializeVariant({
        ...item.productVariant,
        productId: item.productVariant.productId ?? product?.id ?? Number(item.productId ?? 0),
      })
    : null;

  return {
    ...item,
    id,
    _id: id,
    quotationRoomId,
    productId: Number(item.productId ?? product?.id ?? 0),
    product,
    productVariantId: item.productVariantId ? Number(item.productVariantId) : (productVariant?.id ?? null),
    productVariant,
    quantity,
    unitPrice,
    priceWithoutTax: isNaN(rawPriceWithoutTax) ? undefined : rawPriceWithoutTax.toFixed(2),
    taxPercent: isNaN(taxPercent) ? undefined : taxPercent.toFixed(2),
    taxAmount: isNaN(rawTaxAmount) ? undefined : rawTaxAmount.toFixed(2),
    linePrice: Math.round(Number(unitPrice) * quantity * 100) / 100,
    notes: item.notes ?? null,
    variantLabel: item.variantLabel ?? null,
    variantConfig: item.variantConfig ?? null,
    sbNumber: item.sbNumber ?? null,
    sortOrder: Number(item.sortOrder ?? 0),
  };
}

/**
 * Normalizes a quotation room to guarantee `id: number`, `quotationId: string`,
 * normalized roomType, and normalized items list.
 */
export function normalizeQuotationRoom(room: any, fallbackQuotationId?: string): QuotationRoom {
  if (!room || typeof room !== "object") return room;
  const id = Number(room.id ?? room._id ?? 0);
  const quotationId = String(room.quotationId ?? fallbackQuotationId ?? "");
  const roomTypeId = room.roomTypeId !== undefined && room.roomTypeId !== null ? Number(room.roomTypeId) : null;
  const roomType = room.roomType ? normalizeRoomType(room.roomType) : undefined;
  const items = Array.isArray(room.items)
    ? room.items.map((i: any) => normalizeQuotationItem(i, id))
    : [];

  const subtotal = Math.round(
    items.reduce((sum: number, it: any) => sum + (it.linePrice ?? (Number(it.unitPrice || 0) * (it.quantity || 1))), 0) * 100
  ) / 100;
  const productsCount = items.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0);

  return {
    ...room,
    id,
    _id: id,
    quotationId,
    roomTypeId,
    roomType,
    customName: room.customName ?? null,
    subArea: room.subArea ?? null,
    notes: room.notes ?? null,
    sortOrder: Number(room.sortOrder ?? 0),
    items,
    subtotal,
    productsCount,
  };
}

/**
 * Complete Quotation normalizer:
 * Guarantees `quotation.id: string`, all child rooms with `id: number`, all items
 * with `id: number`, accurate line pricing, accurate financial subtotals, discounts,
 * and dealer earnings.
 */
export function normalizeQuotation(quotation: any): Quotation & {
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  productsCount: number;
  netSubtotal: number;
  cgstAmount: number;
  sgstAmount: number;
} {
  if (!quotation || typeof quotation !== "object") return quotation;

  const id = String(quotation.id ?? quotation._id ?? "");
  const houseTypeId = quotation.houseTypeId !== undefined && quotation.houseTypeId !== null
    ? Number(quotation.houseTypeId)
    : null;
  const houseType = quotation.houseType ? normalizeHouseType(quotation.houseType) : undefined;

  const rawRooms = Array.isArray(quotation.rooms) ? quotation.rooms : [];
  const rooms = rawRooms.map((r: any) => normalizeQuotationRoom(r, id));

  // Compute canonical subtotal and total products count
  let subtotal = 0;
  let productsCount = 0;

  for (const r of rooms) {
    for (const item of r.items) {
      const q = Math.max(1, item.quantity || 1);
      const p = Number(item.unitPrice || 0);
      subtotal += q * p;
      productsCount += q;
    }
  }

  // Financial calculations
  const discountType = quotation.discountType ?? "none";
  const rawDiscountVal = (() => { const v: any = quotation.discountValue; if (v == null) return 0; if (typeof v === 'object' && v && '$numberDecimal' in (v as any)) return Number((v as any).$numberDecimal); if (typeof v === 'object' && typeof (v as any).toString === 'function') return Number((v as any).toString()); const n = Number(v); return isNaN(n) ? 0 : n; })();

  const customerPct = Number(
    quotation.customerDiscountPercent !== undefined && quotation.customerDiscountPercent !== null
      ? quotation.customerDiscountPercent
      : discountType === "percentage"
      ? rawDiscountVal
      : 0
  );

  let discountAmount = 0;
  if (discountType === "percentage") {
    discountAmount = Math.round(((subtotal * customerPct) / 100) * 100) / 100;
  } else if (discountType === "fixed") {
    discountAmount = Math.min(subtotal, Math.round(rawDiscountVal * 100) / 100);
  }

  const gst = calculateQuotationGst(subtotal, discountAmount);

  const allocatedPct = Number(quotation.allocatedDiscountPercent || 0);
  const earningPct = Math.max(0, allocatedPct - customerPct);
  const earningAmount = Math.round(((subtotal * earningPct) / 100) * 100) / 100;

  return {
    ...quotation,
    id,
    _id: id,
    houseTypeId,
    houseType,
    rooms,
    subtotal: gst.grossSubtotal,
    productsCount,
    totalProducts: productsCount,
    discountType,
    discountValue: rawDiscountVal.toString(),
    discountAmount: gst.discountAmount,
    netSubtotal: gst.netSubtotal,
    cgstPercent: gst.cgstPercent,
    cgstAmount: gst.cgstAmount,
    sgstPercent: gst.sgstPercent,
    sgstAmount: gst.sgstAmount,
    totalGstAmount: gst.totalGstAmount,
    totalAmount: gst.grandTotal,
    grandTotal: gst.grandTotal,
    allocatedDiscountPercent: allocatedPct,
    customerDiscountPercent: customerPct,
    estimatedEarningPercent: earningPct,
    estimatedEarningAmount: earningAmount,
    earningPercent: earningPct,
    estimatedEarning: earningAmount,
  };
}


export function serializeQuotationForClient(q: any): any {
  if (!q || typeof q !== 'object') return q;
  const toNum = (v: any) => {
    if (v == null) return 0;
    if (typeof v === 'object' && v && typeof v.toString === 'function') return Number(v.toString());
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };
  const toStr = (v: any) => {
    if (v == null) return null;
    if (typeof v === 'object' && v && typeof v.toString === 'function') return (v as any).toString();
    return String(v);
  };
  const toIso = (d: any) => {
    if (d == null) return null;
    if (d instanceof Date) return d.toISOString();
    try { return new Date(d).toISOString(); } catch { return null; }
  };
  const gst = calculateQuotationGst(q.subtotal, q.discountAmount);
  return {
    ...q,
    id: q.id ?? q._id ?? '',
    discountValue: toStr(q.discountValue),
    totalAmount: toNum(q.totalAmount ?? q.grandTotal ?? gst.grandTotal),
    grandTotal: toNum(q.grandTotal ?? q.totalAmount ?? gst.grandTotal),
    subtotal: toNum(q.subtotal ?? gst.grossSubtotal),
    discountAmount: toNum(q.discountAmount ?? gst.discountAmount),
    netSubtotal: toNum(q.netSubtotal ?? gst.netSubtotal),
    cgstPercent: toNum(q.cgstPercent ?? gst.cgstPercent),
    cgstAmount: toNum(q.cgstAmount ?? gst.cgstAmount),
    sgstPercent: toNum(q.sgstPercent ?? gst.sgstPercent),
    sgstAmount: toNum(q.sgstAmount ?? gst.sgstAmount),
    totalGstAmount: toNum(q.totalGstAmount ?? gst.totalGstAmount),
    productsCount: toNum(q.productsCount ?? q.totalProducts ?? 0),
    roomsCount: toNum(q.roomsCount ?? 0),
    allocatedDiscountPercent: toNum(q.allocatedDiscountPercent),
    customerDiscountPercent: toNum(q.customerDiscountPercent),
    estimatedEarningPercent: toNum(q.estimatedEarningPercent ?? q.earningPercent),
    estimatedEarningAmount: toNum(q.estimatedEarningAmount ?? q.estimatedEarning),
    createdAt: toIso(q.createdAt),
    updatedAt: toIso(q.updatedAt),
    sentAt: toIso(q.sentAt),
    approvedAt: toIso(q.approvedAt),
    deliveredAt: toIso(q.deliveredAt),
    rejectedAt: toIso(q.rejectedAt),
    validUntil: toIso(q.validUntil),
    houseType: q.houseType ? { id: Number(q.houseType.id ?? q.houseType._id ?? 0), name: String(q.houseType.name ?? '') } : null,
  };
}


