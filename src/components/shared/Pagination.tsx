"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import CustomDropdown from "./CustomDropdown";

export interface PaginationProps {
  page?: number;
  currentPage?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  entityName?: string;
  isLoading?: boolean;
  className?: string;
}

export default function Pagination({
  page,
  currentPage,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 25, 50, 100],
  entityName = "items",
  isLoading = false,
  className = "",
}: PaginationProps) {
  // Safe numeric extraction — prevents NaN and undefined issues
  const rawPage = page ?? currentPage ?? 1;
  const safePage = Number.isFinite(Number(rawPage)) ? Math.max(1, Math.floor(Number(rawPage))) : 1;
  
  const rawPageSize = pageSize ?? 10;
  const safePageSize = Number.isFinite(Number(rawPageSize)) ? Math.max(1, Math.floor(Number(rawPageSize))) : 10;
  
  const rawTotal = total ?? 0;
  const safeTotal = Number.isFinite(Number(rawTotal)) ? Math.max(0, Math.floor(Number(rawTotal))) : 0;
  
  const calculatedTotalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const rawTotalPages = totalPages ?? calculatedTotalPages;
  const safeTotalPages = Number.isFinite(Number(rawTotalPages))
    ? Math.max(1, Math.floor(Number(rawTotalPages)))
    : calculatedTotalPages;

  // Compute display range (e.g., "1–10 of 287")
  const startItem = safeTotal === 0 ? 0 : (safePage - 1) * safePageSize + 1;
  const endItem = safeTotal === 0 ? 0 : Math.min(safePage * safePageSize, safeTotal);

  // Generate page numbers with ellipsis for large ranges
  const pageNumbers = useMemo(() => {
    if (safeTotalPages <= 7) {
      return Array.from({ length: safeTotalPages }, (_, i) => i + 1);
    }

    const pages: (number | "ellipsis")[] = [];

    if (safePage <= 4) {
      // Near start: 1, 2, 3, 4, 5, ..., totalPages
      for (let i = 1; i <= 5; i++) {
        pages.push(i);
      }
      pages.push("ellipsis");
      pages.push(safeTotalPages);
    } else if (safePage >= safeTotalPages - 3) {
      // Near end: 1, ..., totalPages-4, totalPages-3, totalPages-2, totalPages-1, totalPages
      pages.push(1);
      pages.push("ellipsis");
      for (let i = safeTotalPages - 4; i <= safeTotalPages; i++) {
        pages.push(i);
      }
    } else {
      // In middle: 1, ..., page-1, page, page+1, ..., totalPages
      pages.push(1);
      pages.push("ellipsis");
      pages.push(safePage - 1);
      pages.push(safePage);
      pages.push(safePage + 1);
      pages.push("ellipsis");
      pages.push(safeTotalPages);
    }

    return pages;
  }, [safePage, safeTotalPages]);

  if (safeTotal === 0) {
    return null;
  }

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-4 py-3.5 px-3 sm:px-4 bg-white border-t border-neutral-100 rounded-b-2xl ${className}`}
    >
      {/* Left: Item Counter & Page Size Selector */}
      <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-neutral-500 w-full sm:w-auto justify-between sm:justify-start">
        <div>
          Showing{" "}
          <span className="font-semibold text-neutral-900">{startItem}</span>–
          <span className="font-semibold text-neutral-900">{endItem}</span> of{" "}
          <span className="font-semibold text-neutral-900">{safeTotal}</span> {entityName}
        </div>

        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 text-xs">Rows:</span>
            <CustomDropdown
              value={String(safePageSize)}
              onChange={(val) => onPageSizeChange(Number(val))}
              options={pageSizeOptions.map((opt) => ({ value: String(opt), label: String(opt) }))}
              ariaLabel="Rows per page"
            />
          </div>
        )}
      </div>

      {/* Right: Page Navigation Controls with Readable Text */}
      <div className="flex items-center gap-1.5 w-full sm:w-auto justify-center sm:justify-end overflow-x-auto max-w-full pb-1 sm:pb-0">
        {/* First Page Button */}
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={safePage <= 1 || isLoading}
          className="hidden sm:inline-flex w-8 h-8 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white items-center justify-center transition-all active:scale-95 shadow-2xs shrink-0 cursor-pointer"
          aria-label="First page"
          title="First page"
        >
          <ChevronsLeft size={15} />
        </button>

        {/* Previous Page Button with Label */}
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1 || isLoading}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white transition-all active:scale-95 shadow-2xs shrink-0 cursor-pointer"
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={14} />
          <span>Previous</span>
        </button>

        {/* Numbered Page Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {pageNumbers.map((p, idx) => {
            if (p === "ellipsis") {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  className="w-6 sm:w-7 text-center text-neutral-400 font-medium text-xs select-none"
                >
                  …
                </span>
              );
            }

            const isActive = p === safePage;

            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                disabled={isLoading}
                aria-current={isActive ? "page" : undefined}
                aria-label={`Page ${p}`}
                className={`min-w-8 h-8 px-2 rounded-lg text-xs font-semibold transition-all select-none cursor-pointer ${
                  isActive
                    ? "bg-neutral-900 text-white shadow-2xs ring-1 ring-neutral-900"
                    : "text-neutral-700 bg-white hover:bg-neutral-100 border border-neutral-200 active:scale-95"
                } disabled:opacity-50`}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Next Page Button with Label */}
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= safeTotalPages || isLoading}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white transition-all active:scale-95 shadow-2xs shrink-0 cursor-pointer"
          aria-label="Next page"
          title="Next page"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>

        {/* Last Page Button */}
        <button
          type="button"
          onClick={() => onPageChange(safeTotalPages)}
          disabled={safePage >= safeTotalPages || isLoading}
          className="hidden sm:inline-flex w-8 h-8 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white items-center justify-center transition-all active:scale-95 shadow-2xs shrink-0 cursor-pointer"
          aria-label="Last page"
          title="Last page"
        >
          <ChevronsRight size={15} />
        </button>
      </div>
    </div>
  );
}
