import {
  getCategoryDependencies,
  getHouseTypeDependencies,
  getProductDependencies,
  getRoomTypeDependencies,
  getVariantDependencies,
} from "@/lib/dependencies";
import { ProductVariant } from "@/models";

/**
 * One reference reason surfaced to the UI — a human label plus the exact
 * count the server found, never guessed on the client.
 *
 * `blocking: true` means it actually prevents the delete (currently only the
 * "last remaining variant" business rule). Every other reference is
 * informational: soft delete never destroys the record, so an existing
 * subcategory/product/template/quotation that points at it keeps resolving
 * it exactly as before — the record just stops being offered for anything
 * NEW, which is enforced at that creation point, not here.
 */
export interface DeletionBlocker {
  type: string;
  label: string;
  count: number;
  blocking?: boolean;
}

/**
 * The structured "deletion impact" result every entity's preview endpoint
 * returns, so the frontend renders one consistent dialog shape everywhere
 * (`DeletionImpactDialog`) instead of a bespoke one per page.
 */
export interface DeletionImpactResult {
  canDelete: boolean;
  /** Includes non-blocking, informational references too — see `DeletionBlocker.blocking`. */
  blockers: DeletionBlocker[];
  /** Sum of every dependency count found, blocking or not — for display context. */
  totalReferences: number;
  /** @deprecated No longer meaningful now that soft delete always succeeds when `canDelete` is true; kept at `false` for existing callers. */
  archiveOnly: boolean;
}

function canDeleteFrom(blockers: DeletionBlocker[]): boolean {
  return !blockers.some((b) => b.blocking);
}

export async function getProductDeletionImpact(productId: number): Promise<DeletionImpactResult> {
  const dependencies = await getProductDependencies(productId);
  const blockers: DeletionBlocker[] = [];
  if (dependencies.quotationItems > 0) {
    blockers.push({
      type: "quotationItems",
      label: dependencies.quotationItems === 1 ? "quotation item" : "quotation items",
      count: dependencies.quotationItems,
    });
  }
  return {
    canDelete: canDeleteFrom(blockers),
    blockers,
    totalReferences: dependencies.totalDependencies,
    archiveOnly: false,
  };
}

export async function getVariantDeletionImpact(variantId: number): Promise<DeletionImpactResult> {
  const variant = await ProductVariant.findById(variantId).select("productId").lean();
  const dependencies = await getVariantDependencies(variantId);
  const blockers: DeletionBlocker[] = [];
  if (dependencies.quotationItems > 0) {
    blockers.push({
      type: "quotationItems",
      label: dependencies.quotationItems === 1 ? "quotation item" : "quotation items",
      count: dependencies.quotationItems,
    });
  }
  if (variant) {
    const siblingCount = await ProductVariant.countDocuments({ productId: variant.productId });
    if (siblingCount <= 1) {
      // Still a real block: a product must always keep at least one live
      // variant to stay orderable. Phrased as a "<count> <label>" fragment
      // (like every other blocker) so it joins into one coherent sentence.
      blockers.push({ type: "minimumVariant", label: "variant — it is the product's last one", count: 1, blocking: true });
    }
  }
  return {
    canDelete: canDeleteFrom(blockers),
    blockers,
    totalReferences: dependencies.totalDependencies,
    archiveOnly: false,
  };
}

export async function getCategoryDeletionImpact(categoryId: number): Promise<DeletionImpactResult> {
  const dependencies = await getCategoryDependencies(categoryId);
  const blockers: DeletionBlocker[] = [];
  if (dependencies.childCategories > 0) {
    blockers.push({
      type: "childCategories",
      label: dependencies.childCategories === 1 ? "subcategory" : "subcategories",
      count: dependencies.childCategories,
    });
  }
  if (dependencies.totalProducts > 0) {
    blockers.push({
      type: "products",
      label: `product${dependencies.totalProducts === 1 ? "" : "s"} (${dependencies.activeProducts} active)`,
      count: dependencies.totalProducts,
    });
  }
  return {
    canDelete: canDeleteFrom(blockers),
    blockers,
    totalReferences: dependencies.totalDependencies,
    archiveOnly: false,
  };
}

export async function getRoomTypeDeletionImpact(roomTypeId: number): Promise<DeletionImpactResult> {
  const dependencies = await getRoomTypeDependencies(roomTypeId);
  const blockers: DeletionBlocker[] = [];
  if (dependencies.houseTypeTemplates > 0) {
    blockers.push({
      type: "houseTypeTemplates",
      label: dependencies.houseTypeTemplates === 1 ? "house type template" : "house type templates",
      count: dependencies.houseTypeTemplates,
    });
  }
  if (dependencies.quotationRooms > 0) {
    blockers.push({
      type: "quotationRooms",
      label: dependencies.quotationRooms === 1 ? "quotation room" : "quotation rooms",
      count: dependencies.quotationRooms,
    });
  }
  return {
    canDelete: canDeleteFrom(blockers),
    blockers,
    totalReferences: dependencies.totalDependencies,
    archiveOnly: false,
  };
}

export async function getHouseTypeDeletionImpact(houseTypeId: number): Promise<DeletionImpactResult> {
  const dependencies = await getHouseTypeDependencies(houseTypeId);
  const blockers: DeletionBlocker[] = [];
  if (dependencies.roomTemplates > 0) {
    blockers.push({
      type: "roomTemplates",
      label: dependencies.roomTemplates === 1 ? "configured room template" : "configured room templates",
      count: dependencies.roomTemplates,
    });
  }
  if (dependencies.quotations > 0) {
    blockers.push({
      type: "quotations",
      label: dependencies.quotations === 1 ? "quotation" : "quotations",
      count: dependencies.quotations,
    });
  }
  return {
    canDelete: canDeleteFrom(blockers),
    blockers,
    totalReferences: dependencies.totalDependencies,
    archiveOnly: false,
  };
}
