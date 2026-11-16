/**
 * Whyte Quotation Platform — Smart Room Template Configuration Engine
 *
 * Pure, high-performance configuration engine that dynamically resolves
 * room template products against the active catalogue according to the customer's
 * requested automation protocol (Zigbee, Wi-Fi, etc.), control options (RF Remote),
 * and surface finishes.
 *
 * Enforces strict financial integrity, server-side pricing resolution,
 * inter-device accessory compatibility, and zero-loss quantity preservation.
 */

import type { EditorCatalogProduct, EditorCatalogVariant, RoomTemplate } from "@/types";
import { resolveStoredVariantPricing } from "@/lib/pricing";
import { formatTierLabel, formatFinishLabel } from "@/lib/categoryConfig";

export type CompatibilityStatus =
  | "EXACT_MATCH"        // Matches both target protocol and target finish
  | "PARTIAL_MATCH"      // Matches target protocol, but surface finish fell back to available
  | "FALLBACK_PROTOCOL"  // Product does not support target protocol (e.g. Wi-Fi only product when Zigbee requested)
  | "LOCKED_VARIANT"     // Template item explicitly locks a specific variant
  | "UNAVAILABLE";       // Product or variant is inactive or not found in catalogue

export interface ResolvedTemplateItem {
  itemIndex: number;
  productId: number;
  productName: string;
  productCode: string | null;
  productType: string;
  defaultQuantity: number;
  quantity: number;
  isRequired: boolean;
  notes: string | null;

  // Selected variant details
  variantId: number | null;
  variantCode: string | null;
  variantLabel: string;
  automationTier: string | null;
  surfaceFinish: string | null;
  config: Record<string, string>;

  // Authoritative Pricing Snapshot (Tax Inclusive)
  unitPrice: number;
  priceWithoutTax: number;
  taxPercent: number;
  taxAmount: number;
  lineTotal: number;

  // Compatibility & Control Capabilities
  compatibility: CompatibilityStatus;
  compatibilityMessage?: string;
  supportsRemote: boolean;
  requiresCompanionAccessory: boolean;
  companionAccessoryId?: number | null;
  companionAccessoryName?: string | null;

  // Available options for this line in case user wants to manually switch
  availableVariants: Array<{
    id: number;
    label: string;
    tier: string | null;
    finish: string | null;
    price: number;
  }>;
}

export interface CompanionAccessoryItem {
  accessoryId: number;
  productId: number;
  name: string;
  code: string | null;
  variantId: number | null;
  unitPrice: number;
  quantity: number;
  reason: string;
  selected: boolean;
}

export interface TemplateResolutionOptions {
  targetProtocol?: string | null;       // "zigbee" | "wifi" | "remote" | null
  targetFinish?: string | null;         // "glass_black" | "acrylic" | null
  enableRemoteControl?: boolean;        // Customer requests RF Remote control
  includeAccessories?: boolean;         // Auto-include detected companion accessories
  itemOverrides?: Record<
    number,
    {
      protocol?: string | null;
      finish?: string | null;
      variantId?: number | null;
      quantity?: number;
      excluded?: boolean;
    }
  >;
}

export interface TemplateResolutionResult {
  templateId: number;
  templateName: string;
  roomTypeId: number;
  targetProtocol: string | null;
  targetFinish: string | null;
  enableRemoteControl: boolean;

  resolvedItems: ResolvedTemplateItem[];
  companionAccessories: CompanionAccessoryItem[];

  // Financial & Operational Summary
  summary: {
    totalDevices: number;
    totalLineItems: number;
    subtotal: number;
    subtotalWithoutTax: number;
    taxAmount: number;
    exactMatchCount: number;
    partialMatchCount: number;
    fallbackCount: number;
    hasIncompatibilities: boolean;
    incompatibilityNotes: string[];
  };
}

/**
 * Normalizes protocol/tier token for comparison.
 */
function normToken(val: unknown): string {
  if (!val) return "";
  return String(val).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Extracts automation tier from a variant.
 */
function getVariantTier(v: EditorCatalogVariant): string | null {
  if (v.automationTier && v.automationTier.trim()) return v.automationTier.trim();
  const c = v.config as Record<string, string> | undefined;
  if (c?.series && c.series.trim()) return c.series.trim();
  if (c?.tier && c.tier.trim()) return c.tier.trim();
  if (c?.automationTier && c.automationTier.trim()) return c.automationTier.trim();
  return null;
}

/**
 * Extracts surface finish from a variant.
 */
function getVariantFinish(v: EditorCatalogVariant): string | null {
  if (v.surfaceFinish && v.surfaceFinish.trim()) return v.surfaceFinish.trim();
  const c = v.config as Record<string, string> | undefined;
  if (c?.finish && c.finish.trim()) return c.finish.trim();
  if (c?.surfaceFinish && c.surfaceFinish.trim()) return c.surfaceFinish.trim();
  return null;
}

/**
 * Checks whether a product or variant has RF Remote capability.
 */
export function checkRemoteCompatibility(
  product: EditorCatalogProduct,
  variant?: EditorCatalogVariant | null,
  catalogProducts: EditorCatalogProduct[] = []
): { supportsRemote: boolean; companionAccessory?: EditorCatalogProduct | null } {
  // 1. Direct tier is remote
  if (variant && normToken(getVariantTier(variant)) === "remote") {
    return { supportsRemote: true };
  }

  // 2. Direct variant config has remote flag
  const conf = variant?.config as Record<string, unknown> | undefined;
  if (conf?.hasRemote === true || conf?.rfRemote === true || conf?.remote === true) {
    return { supportsRemote: true };
  }

  // 3. Product specification has remote capability
  const specs = product.specs as Record<string, unknown> | undefined;
  if (
    specs?.rf_remote === "yes" ||
    specs?.remote === "yes" ||
    String(specs?.control_type || "").toLowerCase().includes("remote")
  ) {
    return { supportsRemote: true };
  }

  // 4. Product lists an RF Remote accessory in its accessoryIds
  const accessoryIds = product.accessoryIds || [];
  if (accessoryIds.length > 0 && catalogProducts.length > 0) {
    const remoteAccessory = catalogProducts.find((p) => {
      if (!accessoryIds.includes(p.id) || !p.isActive) return false;
      const lowerName = p.name.toLowerCase();
      const lowerCode = (p.code || "").toLowerCase();
      return (
        lowerName.includes("remote") ||
        lowerName.includes("handset") ||
        lowerCode.includes("rem") ||
        lowerCode.includes("rf")
      );
    });

    if (remoteAccessory) {
      return { supportsRemote: true, companionAccessory: remoteAccessory };
    }
  }

  // 5. Check if any catalog accessory is a Whyte RF Remote that pairs with smart switchboards
  if (product.type === "switch_board" || product.type === "curtain") {
    const generalRemote = catalogProducts.find(
      (p) =>
        p.isActive &&
        p.type === "accessory" &&
        (p.name.toLowerCase().includes("remote") || p.name.toLowerCase().includes("handset"))
    );
    if (generalRemote) {
      return { supportsRemote: true, companionAccessory: generalRemote };
    }
  }

  return { supportsRemote: false };
}

/**
 * Resolves a room template against the catalogue with full configuration rules.
 */
export function resolveConfigurableTemplate(
  template: RoomTemplate,
  catalogProducts: EditorCatalogProduct[],
  options: TemplateResolutionOptions = {}
): TemplateResolutionResult {
  const {
    targetProtocol: rawProtocol,
    targetFinish: rawFinish,
    enableRemoteControl = false,
    includeAccessories = true,
    itemOverrides = {},
  } = options;

  const defaultProtocol = template.defaultProtocol || null;
  const defaultFinish = template.defaultFinish || null;
  const effectiveTargetProtocol = rawProtocol !== undefined ? rawProtocol : defaultProtocol;
  const effectiveTargetFinish = rawFinish !== undefined ? rawFinish : defaultFinish;

  const resolvedItems: ResolvedTemplateItem[] = [];
  const companionAccessoriesMap = new Map<number, CompanionAccessoryItem>();
  const incompatibilityNotes: string[] = [];

  let exactMatchCount = 0;
  let partialMatchCount = 0;
  let fallbackCount = 0;

  const templateItems = template.items || [];

  templateItems.forEach((item, index) => {
    const override = itemOverrides[index];
    if (override?.excluded) return;

    const prod = catalogProducts.find((p) => p.id === item.productId);
    if (!prod || !prod.isActive) {
      resolvedItems.push({
        itemIndex: index,
        productId: item.productId,
        productName: item.product?.name || `Product #${item.productId}`,
        productCode: item.product?.code || null,
        productType: item.product?.type || "switch_board",
        defaultQuantity: item.defaultQuantity || 1,
        quantity: override?.quantity ?? item.defaultQuantity ?? 1,
        isRequired: Boolean(item.isRequired),
        notes: item.notes ?? null,
        variantId: null,
        variantCode: null,
        variantLabel: "Unavailable",
        automationTier: null,
        surfaceFinish: null,
        config: {},
        unitPrice: 0,
        priceWithoutTax: 0,
        taxPercent: 18,
        taxAmount: 0,
        lineTotal: 0,
        compatibility: "UNAVAILABLE",
        compatibilityMessage: "This product is inactive or no longer in the catalogue.",
        supportsRemote: false,
        requiresCompanionAccessory: false,
        availableVariants: [],
      });
      incompatibilityNotes.push(`Product #${item.productId} is unavailable.`);
      return;
    }

    const activeVariants = (prod.variants || []).filter((v) => v && v.isActive !== false);

    // Format available variants for UI picker dropdown
    const availableVariants = activeVariants.map((v) => {
      const t = getVariantTier(v);
      const f = getVariantFinish(v);
      const pricing = resolveStoredVariantPricing(v);
      return {
        id: v.id,
        label: `${formatTierLabel(t) || "Standard"} · ${formatFinishLabel(f) || "Finish"} (${pricing.price.toFixed(2)})`,
        tier: t,
        finish: f,
        price: pricing.price,
      };
    });

    // Determine target tier & finish for this specific item
    const itemTargetProtocol = override?.protocol !== undefined
      ? override.protocol
      : (effectiveTargetProtocol || item.preferredProtocol || null);

    const itemTargetFinish = override?.finish !== undefined
      ? override.finish
      : (effectiveTargetFinish || item.preferredFinish || null);

    let chosenVariant: EditorCatalogVariant | null = null;
    let compatibility: CompatibilityStatus = "EXACT_MATCH";
    let compatibilityMessage: string | undefined;

    // 1. Explicit override variant requested
    if (override?.variantId) {
      chosenVariant = activeVariants.find((v) => v.id === override.variantId) || null;
      if (chosenVariant) {
        compatibility = "LOCKED_VARIANT";
      }
    }

    // 2. Explicitly locked variant (either allowAlternativeProtocol is false, or no target protocol/finish was requested)
    if (!chosenVariant && item.variantId) {
      if (item.allowAlternativeProtocol === false || (!effectiveTargetProtocol && !effectiveTargetFinish)) {
        chosenVariant = activeVariants.find((v) => v.id === item.variantId) || null;
        if (chosenVariant) {
          compatibility = "LOCKED_VARIANT";
          compatibilityMessage = "Locked to specific variant in template configuration.";
        }
      }
    }

    // 3. Smart Matching: Match both Protocol & Finish
    if (!chosenVariant && activeVariants.length > 0) {
      const targetProtToken = normToken(itemTargetProtocol);
      const targetFinishToken = normToken(itemTargetFinish);

      // A) Exact match: both protocol and finish
      if (targetProtToken && targetFinishToken) {
        chosenVariant = activeVariants.find((v) => {
          const vTier = normToken(getVariantTier(v));
          const vFin = normToken(getVariantFinish(v));
          return vTier === targetProtToken && vFin === targetFinishToken;
        }) || null;
      }

      // B) Match protocol with first available finish
      if (!chosenVariant && targetProtToken) {
        chosenVariant = activeVariants.find((v) => {
          const vTier = normToken(getVariantTier(v));
          return vTier === targetProtToken;
        }) || null;

        if (chosenVariant) {
          compatibility = "PARTIAL_MATCH";
          const chosenFin = formatFinishLabel(getVariantFinish(chosenVariant)) || "Standard";
          compatibilityMessage = `Matched ${formatTierLabel(itemTargetProtocol)} protocol; finish adjusted to ${chosenFin}.`;
        }
      }

      // C) Match finish with first available protocol (Fallback)
      if (!chosenVariant && targetFinishToken) {
        chosenVariant = activeVariants.find((v) => {
          const vFin = normToken(getVariantFinish(v));
          return vFin === targetFinishToken;
        }) || null;

        if (chosenVariant) {
          compatibility = "FALLBACK_PROTOCOL";
          const chosenTier = formatTierLabel(getVariantTier(chosenVariant)) || "Standard";
          compatibilityMessage = `Target protocol ${formatTierLabel(itemTargetProtocol)} not available for this model; defaulted to ${chosenTier}.`;
        }
      }

      // D) Ultimate fallback: first active variant
      if (!chosenVariant && activeVariants.length > 0) {
        chosenVariant = activeVariants[0];
        compatibility = "FALLBACK_PROTOCOL";
        compatibilityMessage = `Configured protocol/finish unavailable; using catalogue standard variant.`;
      }
    }

    if (compatibility === "EXACT_MATCH") exactMatchCount++;
    else if (compatibility === "PARTIAL_MATCH") partialMatchCount++;
    else if (compatibility === "FALLBACK_PROTOCOL") fallbackCount++;

    if (compatibilityMessage) {
      incompatibilityNotes.push(`${prod.name}: ${compatibilityMessage}`);
    }

    // Resolve pricing
    let unitPrice = 0;
    let priceWithoutTax = 0;
    let taxPercent = 18;
    let taxAmount = 0;

    if (chosenVariant) {
      const p = resolveStoredVariantPricing(chosenVariant);
      unitPrice = p.price;
      priceWithoutTax = p.priceWithoutTax;
      taxPercent = p.taxPercent;
      taxAmount = p.taxAmount;
    }

    const qty = override?.quantity ?? item.defaultQuantity ?? 1;
    const lineTotal = Math.round(unitPrice * qty * 100) / 100;

    // Check RF Remote Compatibility
    const remoteCheck = checkRemoteCompatibility(prod, chosenVariant, catalogProducts);

    let companionAccessoryId: number | null = null;
    let companionAccessoryName: string | null = null;
    let requiresCompanionAccessory = false;

    if (enableRemoteControl) {
      if (remoteCheck.companionAccessory) {
        companionAccessoryId = remoteCheck.companionAccessory.id;
        companionAccessoryName = remoteCheck.companionAccessory.name;
        requiresCompanionAccessory = true;

        if (!companionAccessoriesMap.has(remoteCheck.companionAccessory.id)) {
          const accProd = remoteCheck.companionAccessory;
          const accVariants = (accProd.variants || []).filter((v) => v.isActive !== false);
          const accVar = accVariants[0] || null;
          const accPricing = accVar ? resolveStoredVariantPricing(accVar) : { price: 1500 };

          companionAccessoriesMap.set(accProd.id, {
            accessoryId: accProd.id,
            productId: accProd.id,
            name: accProd.name,
            code: accProd.code,
            variantId: accVar ? accVar.id : null,
            unitPrice: accPricing.price,
            quantity: 1, // 1 remote controller is shared across the room
            reason: `Required to operate RF Remote control for ${prod.name}`,
            selected: includeAccessories,
          });
        }
      } else if (!remoteCheck.supportsRemote) {
        incompatibilityNotes.push(
          `${prod.name} does not support RF Remote control; will operate via ${formatTierLabel(getVariantTier(chosenVariant!)) || "Zigbee"}.`
        );
      }
    }

    const vTier = chosenVariant ? getVariantTier(chosenVariant) : null;
    const vFin = chosenVariant ? getVariantFinish(chosenVariant) : null;
    const tierLbl = formatTierLabel(vTier);
    const finishLbl = formatFinishLabel(vFin);
    const variantLabel = (tierLbl || finishLbl)
      ? [tierLbl, finishLbl].filter(Boolean).join(" + ")
      : "Standard";

    const variantConfig: Record<string, string> = {
      ...((chosenVariant?.config as Record<string, string>) || {}),
    };
    if (vTier) variantConfig.series = vTier;
    if (vFin) variantConfig.finish = vFin;

    resolvedItems.push({
      itemIndex: index,
      productId: prod.id,
      productName: prod.name,
      productCode: prod.code,
      productType: prod.type,
      defaultQuantity: item.defaultQuantity || 1,
      quantity: qty,
      isRequired: Boolean(item.isRequired),
      notes: item.notes ?? null,
      variantId: chosenVariant ? chosenVariant.id : null,
      variantCode: chosenVariant?.variantCode || null,
      variantLabel,
      automationTier: vTier,
      surfaceFinish: vFin,
      config: variantConfig,
      unitPrice,
      priceWithoutTax,
      taxPercent,
      taxAmount,
      lineTotal,
      compatibility,
      compatibilityMessage,
      supportsRemote: remoteCheck.supportsRemote,
      requiresCompanionAccessory,
      companionAccessoryId,
      companionAccessoryName,
      availableVariants,
    });
  });

  // Calculate totals
  const totalDevices = resolvedItems.reduce((sum, it) => sum + it.quantity, 0);
  const subtotal = Math.round(resolvedItems.reduce((sum, it) => sum + it.lineTotal, 0) * 100) / 100;
  const subtotalWithoutTax = Math.round(resolvedItems.reduce((sum, it) => sum + it.priceWithoutTax * it.quantity, 0) * 100) / 100;
  const taxAmount = Math.round((subtotal - subtotalWithoutTax) * 100) / 100;

  return {
    templateId: template.id,
    templateName: template.name,
    roomTypeId: template.roomTypeId,
    targetProtocol: effectiveTargetProtocol,
    targetFinish: effectiveTargetFinish,
    enableRemoteControl,
    resolvedItems,
    companionAccessories: Array.from(companionAccessoriesMap.values()),
    summary: {
      totalDevices,
      totalLineItems: resolvedItems.length,
      subtotal,
      subtotalWithoutTax,
      taxAmount,
      exactMatchCount,
      partialMatchCount,
      fallbackCount,
      hasIncompatibilities: fallbackCount > 0 || incompatibilityNotes.length > 0,
      incompatibilityNotes,
    },
  };
}
