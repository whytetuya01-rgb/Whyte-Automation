import { getProductTags, ProductTag } from "@/lib/utils";
import { Product } from "@/types";

type DisplayMode =
  /** Full chain, no hiding — used in ItemRow and PDF preview */
  | "full"
  /**
   * Context-aware — used in the ProductCard grid.
   * Tags matching an active filter ID are hidden.
   * When no filter is active ('All Products'), only 2 tags max are shown,
   * with deeper levels collapsed into a single condensed tag.
   */
  | "card";

interface Props {
  product: Product;
  /**
   * IDs of currently active category filters. Tags whose id matches will be
   * hidden in "card" mode because they are already implied by the filter UI.
   */
  activeFilterIds?: number[];
  mode?: DisplayMode;
  className?: string;
}

// Level-based pill colour: level 1 (series) gets the boldest treatment, deeper levels get quieter.
const levelStyle: Record<number, string> = {
  1: "bg-blue-50 text-blue-700 border-blue-200 font-semibold",
  2: "bg-slate-100 text-slate-600 border-slate-200",
  3: "bg-slate-50 text-slate-500 border-slate-200",
};
const defaultLevelStyle = "bg-slate-50 text-slate-500 border-slate-200";

function Tag({ tag }: { tag: ProductTag & { condensed?: boolean } }) {
  const style = tag.condensed ? defaultLevelStyle : (levelStyle[tag.level] ?? defaultLevelStyle);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] leading-none whitespace-nowrap ${style}`}
    >
      {tag.label}
    </span>
  );
}

export default function ProductTags({ product, activeFilterIds = [], mode = "card", className = "" }: Props) {
  const allTags = getProductTags(product);
  if (allTags.length === 0) return null;

  let visibleTags: (ProductTag & { condensed?: boolean })[];

  if (mode === "full") {
    // Show every tag, no filtering, no condensation
    visibleTags = allTags;
  } else {
    // --- card mode ---
    const activeSet = new Set(activeFilterIds.filter(Boolean));

    // Remove tags that are implied by active filters
    const remaining = allTags.filter((t) => !activeSet.has(t.id));

    if (activeSet.size > 0) {
      // Filter is active — show whichever tags survived, up to 3
      visibleTags = remaining.slice(0, 3);
    } else {
      // 'All Products' view — show max 2 tags with smart condensation
      if (remaining.length <= 2) {
        visibleTags = remaining;
      } else {
        // Keep the root/series tag (level 1) and collapse the rest
        const [root, ...rest] = remaining;
        const condensedLabel = rest.map((t) => t.label).join(" / ");
        visibleTags = [
          root,
          { label: condensedLabel, level: 99, id: -1, condensed: true },
        ];
      }
    }
  }

  if (visibleTags.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {visibleTags.map((tag, i) => (
        <Tag key={tag.id === -1 ? `condensed-${i}` : tag.id} tag={tag} />
      ))}
    </div>
  );
}
