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

const CONTROL_TRIGGER =
  "h-9 rounded-xl text-xs font-semibold shadow-none border-neutral-200 bg-white hover:border-neutral-300 px-3";

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
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-3 shadow-xs space-y-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Search Input */}
        <div className="relative min-w-[240px] flex-1">
          <Input
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearchSubmit();
            }}
            placeholder="Search products, SKU..."
            aria-label="Search catalog"
            leftIcon={<Search className="h-3.5 w-3.5 text-neutral-400" />}
            rightIcon={
              searchInput ? (
                <button
                  type="button"
                  onClick={onClearSearch}
                  aria-label="Clear search"
                  className="rounded-lg p-0.5 text-neutral-400 hover:text-neutral-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null
            }
            className="h-9 rounded-xl border-neutral-200 bg-white pl-9 pr-9 text-xs focus:ring-pink-500/20 focus:border-neutral-900 transition-colors"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            ariaLabel="Filter by category"
            value={category}
            onChange={(event) => onFilterChange("category", event.target.value)}
            options={categorySelectOptions}
            triggerClassName={CONTROL_TRIGGER}
            className="w-[160px]"
          />
          <Select
            ariaLabel="Filter by type"
            value={type}
            onChange={(event) => onFilterChange("type", event.target.value)}
            options={typeSelectOptions}
            triggerClassName={CONTROL_TRIGGER}
            className="w-[136px]"
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
            className="w-[144px]"
          />
        </div>
      </div>

      {/* Configuration Segmented Control & Status line */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-neutral-100 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400 sm:inline-flex">
            <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
            Configuration
          </span>

          <div
            role="group"
            aria-label="Filter by configuration"
            className="inline-flex items-center gap-1 rounded-xl border border-neutral-200/80 bg-neutral-100/80 p-1"
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
                    "rounded-lg px-3 py-1 text-xs transition-all",
                    isSelected
                      ? "bg-white text-pink-600 font-bold shadow-2xs border border-pink-200/60"
                      : "text-neutral-600 hover:text-neutral-900 hover:bg-white/50 font-semibold"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-medium text-neutral-500">{resultSummary}</span>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearAll}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
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