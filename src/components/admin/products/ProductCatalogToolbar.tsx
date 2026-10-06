import { Search, X, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, Select, type SelectOption } from "@/components/ui";
import type { CatalogFilterOption } from "./catalogPresentation";

export type CatalogFilterKey = "category" | "type" | "status" | "sort" | "hasVariants";

interface ProductCatalogToolbarProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onClearSearch: () => void;

  category: string;
  type: string;
  status: string;
  sort: string;
  hasVariants: string;
  onFilterChange: (key: CatalogFilterKey, value: string) => void;

  categoryOptions: Array<{ id: number; name: string }>;
  typeOptions: CatalogFilterOption[];

  onClearAll: () => void;
  hasActiveFilters: boolean;
  resultSummary: string;
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active only" },
  { value: "inactive", label: "Inactive only" },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: "sortOrder_asc", label: "Catalog order" },
  { value: "name_asc", label: "Name: A → Z" },
  { value: "name_desc", label: "Name: Z → A" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

const CONFIGURATION_TABS: CatalogFilterOption[] = [
  { value: "all", label: "All products" },
  { value: "yes", label: "With variants" },
  { value: "no", label: "No variants" },
];

/** Compact, consistent control height across the whole toolbar. */
const CONTROL_TRIGGER =
  "h-9 rounded-lg text-xs font-medium shadow-none border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 px-2.5";

/**
 * Catalog toolbar: one wide search, four compact filters and a segmented
 * control for the configuration filter. All filters stay controlled by the page
 * (URL state) — this component only renders and reports intent.
 */
export default function ProductCatalogToolbar({
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  onClearSearch,
  category,
  type,
  status,
  sort,
  hasVariants,
  onFilterChange,
  categoryOptions,
  typeOptions,
  onClearAll,
  hasActiveFilters,
  resultSummary,
}: ProductCatalogToolbarProps) {
  const categorySelectOptions: SelectOption[] = [
    { value: "all", label: "All categories" },
    ...categoryOptions.map((option) => ({ value: String(option.id), label: option.name })),
  ];

  const typeSelectOptions: SelectOption[] = [
    { value: "all", label: "All types" },
    ...typeOptions.map((option) => ({ value: option.value, label: option.label })),
  ];

  return (
    <section className="rounded-xl border border-neutral-200/80 bg-white shadow-2xs">
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        {/* Search — the widest control, so it anchors the toolbar. */}
        <div className="relative min-w-[240px] flex-1">
          <Input
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearchSubmit();
            }}
            placeholder="Search products, codes or variant SKU..."
            aria-label="Search catalog"
            leftIcon={<Search className="h-3.5 w-3.5" />}
            rightIcon={
              searchInput ? (
                <button
                  type="button"
                  onClick={onClearSearch}
                  aria-label="Clear search"
                  className="rounded p-0.5 text-neutral-400 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null
            }
            className="h-9 rounded-lg border-neutral-200 bg-neutral-50/60 pl-9 pr-9 text-xs shadow-none hover:border-neutral-300 focus:bg-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            ariaLabel="Filter by category"
            value={category}
            onChange={(event) => onFilterChange("category", event.target.value)}
            options={categorySelectOptions}
            triggerClassName={CONTROL_TRIGGER}
            className="w-[168px]"
          />
          <Select
            ariaLabel="Filter by type"
            value={type}
            onChange={(event) => onFilterChange("type", event.target.value)}
            options={typeSelectOptions}
            triggerClassName={CONTROL_TRIGGER}
            className="w-[140px]"
          />
          <Select
            ariaLabel="Filter by status"
            value={status}
            onChange={(event) => onFilterChange("status", event.target.value)}
            options={STATUS_OPTIONS}
            triggerClassName={CONTROL_TRIGGER}
            className="w-[136px]"
          />
          <Select
            ariaLabel="Sort products"
            value={sort}
            onChange={(event) => onFilterChange("sort", event.target.value)}
            options={SORT_OPTIONS}
            triggerClassName={CONTROL_TRIGGER}
            className="w-[148px]"
          />
        </div>
      </div>

      {/* Secondary line: configuration segmented control + result summary + reset. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-neutral-100 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-400 sm:inline-flex">
            <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
            Configuration
          </span>

          <div
            role="group"
            aria-label="Filter by configuration"
            className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-100/70 p-0.5"
          >
            {CONFIGURATION_TABS.map((tab) => {
              const isSelected = hasVariants === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => onFilterChange("hasVariants", tab.value)}
                  aria-pressed={isSelected}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-[background-color,color,box-shadow] duration-150",
                    isSelected
                      ? "bg-white font-semibold text-admin-primary-foreground shadow-2xs ring-1 ring-inset ring-admin-primary-border"
                      : "text-neutral-500 hover:bg-white/70 hover:text-neutral-800"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400 tabular-nums">{resultSummary}</span>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearAll}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-neutral-400 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear filters
            </button>
          )}
        </div>
      </div>
    </section>
  );
}