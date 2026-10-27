import type { QuotationItem } from "@/types";

/**
 * Display-only grouping for the proposal's "Product Summary & Specifications".
 *
 * Quotation items stay independent everywhere else (builder, database, APIs, saved data): every Add is its own entry
 * with its own quantity and installation location. The proposal would otherwise repeat the same product once per
 * installation location, so the rows of one ROOM that describe the same product are shown as one row. Nothing here
 * changes or merges a stored item; the entries are only read.
 *
 * Entries are grouped when everything that is printed about them (and everything that prices them) is the same:
 * product, variant (its stored configuration only for a product without a variant), module size / finish / colour /
 * tier / connectivity, SB number, unit price, custom-price flag and availability. Quantity and installation location are what differ between grouped entries.
 * Entries of different rooms are never combined because the grouping runs on one room's items at a time.
 */

export interface ProposalRowLocation {
  /** The installation location as typed, or `null` for entries without one. */
  label: string | null;
  /** Units of this row installed at that location. */
  quantity: number;
}

export interface ProposalProductRow {
  /** Stable React key: the id of the first entry. */
  key: string;
  /** The first entry: supplies the product name, image and specification chips. */
  item: QuotationItem;
  /** Every grouped entry, in their original order. */
  entries: QuotationItem[];
  /** Sum of the entries' quantities. */
  quantity: number;
  /** Sum of each entry's own quantity x unit price (never the first entry's price x the combined quantity). */
  lineTotal: number;
  /** Distinct installation locations in first-seen order, each with the units installed there. */
  locations: ProposalRowLocation[];
}

export interface ProposalGroupingOptions {
  /** The specification values the proposal prints for an item (module size, finish, colour, tier, connectivity). */
  attributesOf: (item: QuotationItem) => ReadonlyArray<string | null | undefined>;
  /** The installation location to show for an item, `null` when it has none or only a placeholder. */
  locationOf: (item: QuotationItem) => string | null;
}

const entryQuantity = (item: QuotationItem): number => Number(item.quantity) || 1;
const entryUnitPrice = (item: QuotationItem): number => Number(item.unitPrice || 0);

/** Key order does not matter for a configuration object, so it is sorted before comparing. */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function proposalGroupKey(item: QuotationItem, options: ProposalGroupingOptions): string {
  return JSON.stringify([
    Number(item.productId),
    item.productVariantId === null || item.productVariantId === undefined ? null : Number(item.productVariantId),
    // The variant fixes the configuration, and everything of it that the proposal prints is in `attributesOf`. The raw
    // stored blob can differ between entries added through different screens, so it only counts for a product
    // without a variant.
    item.productVariantId === null || item.productVariantId === undefined ? stableStringify(item.variantConfig) : "",
    options.attributesOf(item).map((value) => (value ?? "").toString().trim().toLowerCase()),
    (item.sbNumber ?? "").trim(),
    entryUnitPrice(item),
    Boolean(item.isCustomPrice),
    Boolean(item.isUnavailable),
  ]);
}

export function groupProposalItems(items: QuotationItem[], options: ProposalGroupingOptions): ProposalProductRow[] {
  const rows = new Map<string, ProposalProductRow>();

  items.forEach((item, index) => {
    const groupKey = proposalGroupKey(item, options);
    let row = rows.get(groupKey);
    if (!row) {
      row = { key: String(item.id ?? `row-${index}`), item, entries: [], quantity: 0, lineTotal: 0, locations: [] };
      rows.set(groupKey, row);
    }
    row.entries.push(item);
    row.quantity += entryQuantity(item);
    row.lineTotal += entryQuantity(item) * entryUnitPrice(item);

    const label = options.locationOf(item);
    const wanted = label === null ? "" : label.trim().toLowerCase();
    const existing = row.locations.find((location) => (location.label === null ? "" : location.label.trim().toLowerCase()) === wanted);
    if (existing) existing.quantity += entryQuantity(item);
    else row.locations.push({ label, quantity: entryQuantity(item) });
  });

  return [...rows.values()];
}
