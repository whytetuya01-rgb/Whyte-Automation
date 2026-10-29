/**
 * Product series: a company's top-level categories that it marks as a series (e.g. "Tactus", "Tactus Edge"), with a
 * description, an image and whether the quotation document shows it. Type groups such as "Accessories" or "Smart Locks"
 * simply stay unmarked. Nothing is migrated: products keep their category, and a product's series is the top-level
 * category its category sits under.
 *
 * Pure helpers shared by the server (validation, API), the admin screen and the quotation document.
 */

export const SERIES_LIMITS = { description: 600 } as const;

export interface CategorySeries {
  /** This top-level category is presented as a product series. */
  enabled: boolean;
  description: string | null;
  imageUrl: string | null;
  imagePublicId: string | null;
  /** Show this series on the quotation document when the quotation uses one of its products. */
  showOnPdf: boolean;
}

export const EMPTY_SERIES: Readonly<CategorySeries> = Object.freeze({ enabled: false, description: null, imageUrl: null, imagePublicId: null, showOnPdf: false });

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * A stored series block read back safely (absent on every category that was never marked). Always a fresh object:
 * callers merge edits into it, and a shared default would leak one category's series into every unmarked category.
 */
export function normalizeSeries(stored: unknown): CategorySeries {
  if (!stored || typeof stored !== "object") return { ...EMPTY_SERIES };
  const source = stored as Record<string, unknown>;
  const imageUrl = text(source.imageUrl);
  return {
    enabled: source.enabled === true,
    description: text(source.description)?.slice(0, SERIES_LIMITS.description) ?? null,
    imageUrl: imageUrl && imageUrl.startsWith("https://") ? imageUrl : null,
    imagePublicId: imageUrl ? text(source.imagePublicId) : null,
    showOnPdf: source.showOnPdf === true,
  };
}

/** One series as the quotation document shows it. */
export interface DocumentSeries {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
}

/** What GET /api/catalog/series returns for the caller's company. */
export interface CompanySeriesCatalog {
  /** Enabled series that the document may show (showOnPdf). */
  series: DocumentSeries[];
  /** Every category id of the company -> the id of its top-level category. */
  rootOf: Record<string, number>;
}

/** Category id -> top-level category id, from flat rows (any depth; cycles and unknown parents stop safely). */
export function buildCategoryRootMap(rows: ReadonlyArray<{ id: number; parentId: number | null }>): Record<string, number> {
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  const rootOf: Record<string, number> = {};
  for (const row of rows) {
    let current = row.id;
    const seen = new Set<number>();
    while (true) {
      const parent = parentOf.get(current);
      if (parent === null || parent === undefined || !parentOf.has(parent) || seen.has(parent)) break;
      seen.add(current);
      current = parent;
    }
    rootOf[String(row.id)] = current;
  }
  return rootOf;
}

/**
 * The series the document shows for these items: the ones their products belong to, enabled and marked "show on
 * PDF", each once, in the order they first appear in the quotation.
 */
export function seriesForDocument(
  items: ReadonlyArray<{ product?: { categoryId?: number | null } | null }>,
  catalog: CompanySeriesCatalog | null | undefined
): DocumentSeries[] {
  if (!catalog) return [];
  const byId = new Map(catalog.series.map((series) => [series.id, series]));
  const shown: DocumentSeries[] = [];
  const added = new Set<number>();
  for (const item of items) {
    const categoryId = item.product?.categoryId;
    if (categoryId === null || categoryId === undefined) continue;
    const root = catalog.rootOf[String(categoryId)];
    const series = root === undefined ? undefined : byId.get(root);
    if (series && !added.has(series.id)) {
      added.add(series.id);
      shown.push(series);
    }
  }
  return shown;
}

/** Series cards per document page (each card has an image and up to SERIES_LIMITS.description characters). */
export const SERIES_PER_PAGE = 3;
