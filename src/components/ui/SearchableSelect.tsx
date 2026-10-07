"use client";

import React, { useState, useRef, useEffect, useCallback, useId, useMemo } from "react";
import { ChevronDown, Check, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";
import type { SelectOption } from "./Select";

export type { SelectOption } from "./Select";

export interface SearchableSelectProps {
  label?: string;
  helperText?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  /** Shown in the search input; defaults to "Search …". */
  searchPlaceholder?: string;
  /** Shown when no option matches the current search text. */
  emptyText?: string;
  value?: string | number;
  onChange?: (e: { target: { name?: string; value: string } }) => void;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  triggerClassName?: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
  direction?: "up" | "down" | "auto";
}

/**
 * Same look and keyboard model as `Select`, plus a search box inside the
 * popover that filters by label (case-insensitive, substring match). Meant for
 * option lists long enough that scanning them is slower than typing — dealers,
 * products, and similar "pick one of many named things" lists.
 */
export const SearchableSelect = React.forwardRef<HTMLDivElement, SearchableSelectProps>(
  (
    {
      className,
      triggerClassName,
      label,
      helperText,
      error,
      options,
      placeholder = "Select an option",
      searchPlaceholder = "Search...",
      emptyText = "No matches found",
      value: rawValue = "",
      onChange,
      required,
      disabled,
      name,
      id,
      icon,
      ariaLabel,
      direction = "auto",
    },
    forwardedRef
  ) => {
    const generatedId = useId();
    const selectId = id || (label ? generatedId : undefined);
    const value = String(rawValue ?? "");

    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [popoverPosition, setPopoverPosition] = useState<"up" | "down">("down");
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listboxRef = useRef<HTMLUListElement>(null);

    const selectedOption = options.find((opt) => String(opt.value) === value);

    const filteredOptions = useMemo(() => {
      const needle = query.trim().toLowerCase();
      if (!needle) return options;
      return options.filter((opt) => opt.label.toLowerCase().includes(needle));
    }, [options, query]);

    // Determine popover direction
    useEffect(() => {
      if (isOpen) {
        if (direction === "up") {
          setPopoverPosition("up");
        } else if (direction === "down") {
          setPopoverPosition("down");
        } else if (triggerRef.current) {
          const rect = triggerRef.current.getBoundingClientRect();
          const spaceBelow = window.innerHeight - rect.bottom;
          setPopoverPosition(spaceBelow < 320 && rect.top > 260 ? "up" : "down");
        }
      }
    }, [isOpen, direction]);

    // Close on outside click
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsOpen(false);
        }
      };
      if (isOpen) document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    // Reset search and focus it, and seed the highlight from the current value, on open.
    useEffect(() => {
      if (!isOpen) return;
      setQuery("");
      const frame = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }, [isOpen]);

    // Keep highlighted index inside the filtered list.
    useEffect(() => {
      if (!isOpen) return;
      const idx = filteredOptions.findIndex((opt) => String(opt.value) === value);
      setHighlightedIndex(idx >= 0 ? idx : filteredOptions.length > 0 ? 0 : -1);
    }, [isOpen, value, filteredOptions]);

    const close = useCallback((focusTrigger: boolean) => {
      setIsOpen(false);
      if (focusTrigger) triggerRef.current?.focus();
    }, []);

    const handleSelect = useCallback(
      (optionValue: string | number) => {
        const stringVal = String(optionValue);
        onChange?.({ target: { name, value: stringVal } });
        close(true);
      },
      [onChange, name, close]
    );

    const scrollOptionIntoView = (index: number) => {
      const el = listboxRef.current?.children[index] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    };

    const moveHighlight = (delta: number) => {
      if (filteredOptions.length === 0) return;
      setHighlightedIndex((prev) => {
        const base = prev < 0 ? (delta > 0 ? -1 : 0) : prev;
        const next = (base + delta + filteredOptions.length) % filteredOptions.length;
        scrollOptionIntoView(next);
        return next;
      });
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          close(true);
          break;
        case "ArrowDown":
          e.preventDefault();
          moveHighlight(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveHighlight(-1);
          break;
        case "Enter":
          e.preventDefault();
          if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
            handleSelect(filteredOptions[highlightedIndex].value);
          }
          break;
        case "Tab":
          close(false);
          break;
      }
    };

    const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (!isOpen && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
        e.preventDefault();
        setIsOpen(true);
      } else if (isOpen && e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };

    return (
      <div ref={forwardedRef} className={cn("w-full text-left", className)}>
        {label && (
          <Label htmlFor={selectId} required={required}>
            {label}
          </Label>
        )}
        <div ref={containerRef} className="relative w-full" onKeyDown={handleTriggerKeyDown}>
          <button
            ref={triggerRef}
            type="button"
            id={selectId}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={ariaLabel || label || placeholder}
            onClick={() => !disabled && setIsOpen((prev) => !prev)}
            className={cn(
              "w-full h-10 px-3.5 border rounded-xl text-sm font-medium transition-all flex items-center justify-between gap-2.5 select-none bg-white shadow-2xs",
              disabled
                ? "bg-neutral-50 text-neutral-400 border-neutral-200 cursor-not-allowed"
                : isOpen
                  ? "border-accent ring-2 ring-accent/15 text-neutral-950 cursor-pointer"
                  : error
                    ? "border-red-300 text-neutral-900 hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/15 focus:border-red-500 cursor-pointer"
                    : "border-neutral-200 text-neutral-900 hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent cursor-pointer",
              triggerClassName
            )}
          >
            <div className="flex items-center gap-2 truncate">
              {icon && <span className="text-neutral-400 shrink-0">{icon}</span>}
              <span className={cn("truncate", !selectedOption && "text-neutral-400")}>
                {selectedOption ? selectedOption.label : placeholder}
              </span>
            </div>
            <ChevronDown
              size={15}
              className={cn("text-neutral-400 transition-transform duration-200 shrink-0", isOpen && "rotate-180 text-accent")}
            />
          </button>

          {isOpen && (
            <div
              className={cn(
                "absolute left-0 right-0 z-50 w-full min-w-[220px] bg-white border border-neutral-200 rounded-xl shadow-lg shadow-black/10 animate-fadeIn overflow-hidden",
                popoverPosition === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
              )}
            >
              <div className="relative border-b border-neutral-100 p-1.5">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={searchPlaceholder}
                  role="combobox"
                  aria-expanded={isOpen}
                  aria-controls={`${selectId || "searchable-select"}-listbox`}
                  aria-activedescendant={
                    highlightedIndex >= 0 ? `${selectId || "searchable-select"}-opt-${highlightedIndex}` : undefined
                  }
                  className="w-full h-8 pl-7 pr-7 rounded-lg text-sm bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/15 border border-transparent focus:border-accent transition-colors"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <ul
                id={`${selectId || "searchable-select"}-listbox`}
                ref={listboxRef}
                role="listbox"
                tabIndex={-1}
                className="max-h-60 overflow-y-auto p-1.5 focus:outline-none"
              >
                {filteredOptions.length === 0 ? (
                  <li className="px-3.5 py-6 text-center text-xs text-neutral-400">{emptyText}</li>
                ) : (
                  filteredOptions.map((opt, idx) => {
                    const isSelected = String(opt.value) === value;
                    const isHighlighted = idx === highlightedIndex;
                    const isDisabled = Boolean(opt.disabled);

                    return (
                      <li
                        key={`${opt.value}-${idx}`}
                        id={`${selectId || "searchable-select"}-opt-${idx}`}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={isDisabled}
                        onClick={() => !isDisabled && handleSelect(opt.value)}
                        onMouseEnter={() => !isDisabled && setHighlightedIndex(idx)}
                        className={cn(
                          "px-3.5 py-2 mx-0 rounded-lg text-sm flex items-center justify-between gap-3 transition-colors select-none",
                          isDisabled
                            ? "opacity-50 cursor-not-allowed text-neutral-400"
                            : isSelected
                              ? "bg-accent-light text-accent-foreground font-semibold cursor-pointer border border-accent-border/60"
                              : isHighlighted
                                ? "bg-accent-light/40 text-neutral-950 cursor-pointer"
                                : "text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                        )}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {opt.icon && (
                            <span className={cn("shrink-0", isSelected ? "text-accent" : "text-neutral-400")}>{opt.icon}</span>
                          )}
                          <span className="truncate">{opt.label}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {opt.badge && (
                            <span
                              className={cn(
                                "text-[10px] font-semibold px-2 py-0.5 rounded-md",
                                isSelected ? "bg-accent/15 text-accent-foreground" : "bg-neutral-100 text-neutral-600"
                              )}
                            >
                              {opt.badge}
                            </span>
                          )}
                          {isSelected && <Check size={14} className="text-accent stroke-[2.5]" />}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}
        </div>
        {error ? (
          <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-neutral-400 mt-1">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

SearchableSelect.displayName = "SearchableSelect";
export default SearchableSelect;
