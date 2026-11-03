/**
 * Suggested accessories (#3, batch 6): a product can list other products that usually go with it (a switch plate with its
 * frame, a motor with its remote). They are only ever SUGGESTED to the person building a quotation, who adds one with a click.
 * Nothing here, or anywhere, adds an accessory to a quotation by itself. Pure (no database), shared by server and screens.
 */

export const MAX_ACCESSORIES = 20;

/** Cleans a list of ids from a request or a stored value: whole positive numbers, no repeats, in order. */
export function cleanAccessoryIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const entry of value) {
    const id = typeof entry === "number" ? entry : typeof entry === "string" && /^\d+$/.test(entry.trim()) ? Number(entry) : NaN;
    if (Number.isSafeInteger(id) && id > 0) seen.add(id);
  }
  return [...seen];
}

interface SuggestSource {
  id: number;
  isActive?: boolean;
  accessoryIds?: number[] | null;
}

/**
 * The accessories to suggest for a room: the accessories of the products in it, one entry each, in the order the products
 * appear, leaving out anything already in the room, anything that is not in the catalogue (removed, or another company's)
 * and anything inactive.
 */
export function suggestAccessories(roomProductIds: ReadonlyArray<number>, catalog: ReadonlyArray<SuggestSource>): number[] {
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const inRoom = new Set(roomProductIds);
  const suggested: number[] = [];
  for (const productId of [...new Set(roomProductIds)]) {
    for (const accessoryId of byId.get(productId)?.accessoryIds ?? []) {
      const accessory = byId.get(accessoryId);
      if (!accessory || accessory.isActive === false || inRoom.has(accessoryId) || suggested.includes(accessoryId)) continue;
      suggested.push(accessoryId);
    }
  }
  return suggested;
}
