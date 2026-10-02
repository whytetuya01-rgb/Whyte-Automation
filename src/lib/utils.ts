import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  Sofa,
  Bed,
  Sparkles,
  ChefHat,
  Utensils,
  Laptop,
  Flame,
  Film,
  Dumbbell,
  Leaf,
  DoorOpen,
  WashingMachine,
  Archive,
  Car,
  Home,
  Users,
  type LucideIcon
} from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string): string {
  const num = Number(amount);
  if (isNaN(num)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(date));
  } catch {
    return "—";
  }
}

/**
 * Generates a quotation number like QT-2026-001.
 * NOTE: This must be called inside a transaction (see /api/quotations/route.ts)
 * to ensure uniqueness under concurrent requests.
 */
export function generateQuotationNumber(existingCount: number): string {
  const year = new Date().getFullYear();
  return `QT-${year}-${String(existingCount + 1).padStart(3, "0")}`;
}

export function isBathroomLikeRoomName(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return (
    normalized.includes("bathroom") ||
    normalized.includes("washroom") ||
    normalized.includes("toilet")
  );
}

/**
 * Aggregates product quantities across all rooms in a quotation.
 * Returns an array of products with their total quantities across all rooms.
 */
export function getProductTotals(quotation: { rooms: Array<{ items: Array<{ product?: any; quantity: number; unitPrice: string }> }> }) {
  const productMap = new Map<number, { product: any; totalQuantity: number }>();

  quotation.rooms.forEach((room) => {
    room.items.forEach((item) => {
      if (!item.product) return;
      const existing = productMap.get(item.product.id) ?? { product: item.product, totalQuantity: 0 };
      existing.totalQuantity += item.quantity;
      productMap.set(item.product.id, existing);
    });
  });

  // Return sorted by product name for consistent display
  return Array.from(productMap.values()).sort((a, b) =>
    (a.product?.name ?? "").localeCompare(b.product?.name ?? "")
  );
}

/**
 * Builds a human-readable label from a variant config object.
 * Works for flat (empty config → null) and N-dimensional matrix variants.
 * Examples:
 *   {} → null  (flat product, no label needed)
 *   { series: "wifi", finish: "glass" } → "Wifi + Glass"
 *   { series: "zigbee" } → "Zigbee"
 */
export function buildVariantLabel(config: Record<string, string> | null | undefined): string | null {
  if (!config) return null;
  const parts = Object.values(config).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((v) => v.charAt(0).toUpperCase() + v.slice(1)).join(" + ");
}

export interface ProductTag {
  id: number;
  label: string;
  level: number;
}

/**
 * Generates product breadcrumb tags from the category chain.
 * Returns an array of ProductTag objects representing the path.
 */
export function getProductTags(product: {
  category?: {
    id: number;
    name: string;
    level: number;
    parent?: {
      id: number;
      name: string;
      level: number;
      parent?: {
        id: number;
        name: string;
        level: number;
      } | null;
    } | null;
  } | null;
}): ProductTag[] {
  const tags: ProductTag[] = [];
  const cat = product.category;
  if (!cat) return tags;

  if (cat.parent?.parent) {
    tags.push({
      id: cat.parent.parent.id,
      label: cat.parent.parent.name,
      level: cat.parent.parent.level,
    });
  }
  if (cat.parent) {
    tags.push({
      id: cat.parent.id,
      label: cat.parent.name,
      level: cat.parent.level,
    });
  }
  tags.push({
    id: cat.id,
    label: cat.name,
    level: cat.level,
  });

  return tags;
}

export function getRoomIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("living")) return Sofa;
  if (n.includes("bedroom") || n.includes("guest") || n.includes("servant") || n.includes("driver")) return Bed;
  if (n.includes("kid")) return Sparkles;
  if (n.includes("kitchen")) return ChefHat;
  if (n.includes("dining")) return Utensils;
  if (n.includes("study") || n.includes("office") || n.includes("work")) return Laptop;
  if (n.includes("puja") || n.includes("mandir")) return Flame;
  if (n.includes("theatre") || n.includes("cinema") || n.includes("media")) return Film;
  if (n.includes("gym") || n.includes("fitness")) return Dumbbell;
  if (n.includes("balcony") || n.includes("terrace") || n.includes("garden")) return Leaf;
  if (n.includes("entrance") || n.includes("foyer") || n.includes("corridor") || n.includes("passage")) return DoorOpen;
  if (n.includes("powder") || n.includes("bath") || n.includes("toilet") || n.includes("wash")) return Sparkles;
  if (n.includes("laundry") || n.includes("wash")) return WashingMachine;
  if (n.includes("store")) return Archive;
  if (n.includes("garage") || n.includes("parking")) return Car;
  if (n.includes("common")) return Users;
  return Home;
}


