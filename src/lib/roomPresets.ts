import type { EditorCatalogProduct, EditorCatalogVariant } from "@/types";

export interface RoomPresetPackage {
  id: string;
  name: string;
  description: string;
  badge: string;
  icon: string;
  items: Array<{
    keywords: string[];
    quantity: number;
    label: string;
  }>;
}

export const ROOM_PRESET_PACKAGES: RoomPresetPackage[] = [
  {
    id: "essential",
    name: "Essential Automation",
    badge: "Basic 3 Devices",
    description: "Main 4-touch switchboard with fan regulation & 6A socket",
    icon: "🥉",
    items: [
      { keywords: ["Touch 4 Switch 1 Socket", "Touch 4 Switch", "Touch 4", "Touch 6 Switch", "Tactus", "Touch", "Switch"], quantity: 1, label: "Main Touch Switchboard" },
      { keywords: ["Fan Regulator", "Touch Fan", "Fan", "Dimmer"], quantity: 1, label: "Smart Fan Control" },
      { keywords: ["Socket", "2 Socket", "Power", "Module"], quantity: 1, label: "Power Socket Module" },
    ],
  },
  {
    id: "standard",
    name: "Standard Comfort Suite",
    badge: "Popular 5 Devices",
    description: "Main 6-touch switchboard, smart fan, bedside controls & sockets",
    icon: "🥈",
    items: [
      { keywords: ["Touch 6 Switch", "Touch 6 Switch 1 Fan", "Touch 6", "Touch 4 Switch", "Touch", "Switch"], quantity: 1, label: "Main Switchboard" },
      { keywords: ["Fan Regulator", "Touch Fan", "Fan", "Dimmer"], quantity: 1, label: "Smart Fan Regulator" },
      { keywords: ["Touch 2 Switch", "Color Touch 2 Switch", "Touch 2", "Touch"], quantity: 2, label: "Dual Bedside Switches" },
      { keywords: ["Socket", "Touch 4 Switch 2 Socket", "Power"], quantity: 1, label: "Utility Sockets" },
    ],
  },
  {
    id: "luxury",
    name: "Luxury Smart Suite",
    badge: "Full Automation (7 Devices)",
    description: "Complete room luxury: 8-touch, motorized curtain switch, bedside & AC controls",
    icon: "🥇",
    items: [
      { keywords: ["Touch 8 Switch", "Color Touch 8 Switch", "Touch 8", "Touch 6 Switch", "Touch"], quantity: 1, label: "Master 8-Touch Panel" },
      { keywords: ["Curtain", "Touch Curtain", "Touch Dual Curtain", "Motor", "Shade"], quantity: 1, label: "Motorized Curtain Controller" },
      { keywords: ["Fan Regulator", "Touch Fan", "Fan", "Dimmer"], quantity: 1, label: "Smart Fan Regulator" },
      { keywords: ["Touch 2 Switch", "Color Touch 2 Switch", "Touch 2"], quantity: 2, label: "Bedside Touch Controllers" },
      { keywords: ["16A", "Heavy", "Power", "Socket"], quantity: 1, label: "Heavy Appliance / AC Power" },
      { keywords: ["Socket", "6A", "Plug"], quantity: 1, label: "Convenience Sockets" },
    ],
  },
];

/**
 * Resolves product and variant for a preset line item matching the current protocol & finish
 */
export function resolvePresetProduct(
  itemSpec: RoomPresetPackage["items"][0],
  products: EditorCatalogProduct[],
  targetTier?: string,
  targetFinish?: string
): { product: EditorCatalogProduct; variant?: EditorCatalogVariant } | null {
  for (const kw of itemSpec.keywords) {
    const kwLower = kw.toLowerCase();
    const matchedProduct = products.find((p) => {
      if (!p.isActive) return false;
      const name = p.name.toLowerCase();
      const code = (p.code || "").toLowerCase();
      return name.includes(kwLower) || code.includes(kwLower);
    });

    if (matchedProduct) {
      const variants = (matchedProduct.variants || []).filter((v) => v.isActive !== false);

      // Try to find variant matching both tier & finish
      if (variants.length > 0) {
        const cleanTier = targetTier && targetTier !== "all" ? targetTier.toLowerCase().trim() : null;
        const cleanFinish = targetFinish && targetFinish !== "all" ? targetFinish.toLowerCase().trim() : null;

        let bestVariant = variants.find((v) => {
          const vTier = (v.automationTier || v.config?.series || "").toLowerCase();
          const vFinish = (v.surfaceFinish || v.config?.finish || "").toLowerCase();
          const matchesTier = cleanTier ? vTier.includes(cleanTier) : true;
          const matchesFinish = cleanFinish ? vFinish.includes(cleanFinish) : true;
          return matchesTier && matchesFinish;
        });

        // Fallback: match tier only
        if (!bestVariant && cleanTier) {
          bestVariant = variants.find((v) => {
            const vTier = (v.automationTier || v.config?.series || "").toLowerCase();
            return vTier.includes(cleanTier);
          });
        }

        // Fallback: first active variant
        if (!bestVariant) {
          bestVariant = variants[0];
        }

        return { product: matchedProduct, variant: bestVariant };
      }

      return { product: matchedProduct };
    }
  }

  return null;
}
