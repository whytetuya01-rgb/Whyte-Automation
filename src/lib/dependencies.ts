import type { ClientSession } from "mongoose";
import {
  Category,
  HouseTypeRoomTemplate,
  Product,
  ProductVariant,
  Quotation,
  QuotationItem,
  QuotationRoom,
  RoomType,
} from "@/models";

/**
 * Centralised dependency lookups used by hard-delete flows.
 *
 * Every dependency query must complete BEFORE the parent record is removed so
 * that an attempted delete can never orphan dependent records.
 */

export interface VariantDependencyReport {
  variantId: number;
  /** Number of quotation items pointing at this variant. */
  quotationItems: number;
  /** Sample of the dependent quotation items for error details. */
  quotationItemIds: number[];
  totalDependencies: number;
}

function buildQuotationDependencyReport(
  variantId: number,
  dependentItems: Array<{ _id: number }>
): VariantDependencyReport {
  const quotationItemIds = dependentItems.map((item) => item._id);
  return {
    variantId,
    quotationItems: dependentItems.length,
    quotationItemIds,
    totalDependencies: dependentItems.length,
  };
}

/**
 * ProductVariant dependencies. Today the only inbound reference is
 * QuotationItem.productVariantId — this is the ONLY place that reference is
 * queried for delete guards, so it can never drift from the actual schema.
 */
export async function getVariantDependencies(
  variantId: number,
  session?: ClientSession
): Promise<VariantDependencyReport> {
  const quotationItems = await QuotationItem.find({ productVariantId: variantId })
    .select("_id")
    .session(session ?? null)
    .lean()
    .exec();

  return buildQuotationDependencyReport(variantId, quotationItems as Array<{ _id: number }>);
}

export interface ProductDependencyReport {
  productId: number;
  variantCount: number;
  quotationItems: number;
  quotationItemIds: number[];
  totalDependencies: number;
}

/** Product dependencies: its own variants plus any quotation item referencing the product. */
export async function getProductDependencies(
  productId: number,
  session?: ClientSession
): Promise<ProductDependencyReport> {
  const [variantCount, quotationItems] = await Promise.all([
    ProductVariant.countDocuments({ productId }).session(session ?? null).exec(),
    QuotationItem.find({ productId })
      .select("_id")
      .session(session ?? null)
      .lean()
      .exec(),
  ]);

  const quotationItemIds = quotationItems.map((item) => item._id);
  return {
    productId,
    variantCount,
    quotationItems: quotationItems.length,
    quotationItemIds,
    totalDependencies: variantCount + quotationItems.length,
  };
}

export interface CategoryDependencyReport {
  categoryId: number;
  childCategories: number;
  activeProducts: number;
  totalProducts: number;
  totalDependencies: number;
}

/** Category dependencies: child categories and products still assigned to it. */
export async function getCategoryDependencies(
  categoryId: number
): Promise<CategoryDependencyReport> {
  const [childCategories, activeProducts, totalProducts] = await Promise.all([
    Category.countDocuments({ parentId: categoryId }).exec(),
    Product.countDocuments({ categoryId, isActive: true }).exec(),
    Product.countDocuments({ categoryId }).exec(),
  ]);

  return {
    categoryId,
    childCategories,
    activeProducts,
    totalProducts,
    totalDependencies: childCategories + totalProducts,
  };
}

export interface RoomTypeDependencyReport {
  roomTypeId: number;
  /** House type templates that still reference this room type. */
  houseTypeTemplates: number;
  /** Quotation rooms that still reference this room type. */
  quotationRooms: number;
  totalDependencies: number;
}

/**
 * RoomType dependencies: the only two inbound references are
 * HouseTypeRoomTemplate.roomTypeId and QuotationRoom.roomTypeId.
 */
export async function getRoomTypeDependencies(
  roomTypeId: number,
  session?: ClientSession
): Promise<RoomTypeDependencyReport> {
  const [houseTypeTemplates, quotationRooms] = await Promise.all([
    HouseTypeRoomTemplate.countDocuments({ roomTypeId }).session(session ?? null).exec(),
    QuotationRoom.countDocuments({ roomTypeId }).session(session ?? null).exec(),
  ]);

  return {
    roomTypeId,
    houseTypeTemplates,
    quotationRooms,
    totalDependencies: houseTypeTemplates + quotationRooms,
  };
}

export interface HouseTypeDependencyReport {
  houseTypeId: number;
  roomTemplates: number;
  quotations: number;
  totalDependencies: number;
}

/** HouseType dependencies: its own room templates plus any quotation built on it. */
export async function getHouseTypeDependencies(
  houseTypeId: number,
  session?: ClientSession
): Promise<HouseTypeDependencyReport> {
  const [roomTemplates, quotations] = await Promise.all([
    HouseTypeRoomTemplate.countDocuments({ houseTypeId }).session(session ?? null).exec(),
    Quotation.countDocuments({ houseTypeId }).session(session ?? null).exec(),
  ]);

  return {
    houseTypeId,
    roomTemplates,
    quotations,
    totalDependencies: roomTemplates + quotations,
  };
}
