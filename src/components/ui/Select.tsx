"use client";

import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  badge?: string;
  count?: number;
}

export interface SelectProps {
  label?: string;
  helperText?: string;
  error?: string;
  options?: SelectOption[];
  placeholder?: string;
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
  children?: React.ReactNode;
}

export const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  (
    {
      className,
      triggerClassName,
      label,
      helperText,
      error,
      options: optionsProp,
      placeholder = "Select an option",
      value: rawValue = "",
      onChange,
      required,
      disabled,
      name,
      id,
      icon,
      ariaLabel,
      direction = "auto",
      children,
    },
    ref
  ) => {
    const generatedId = useId();
    const selectId = id || (label ? generatedId : undefined);
    const value = String(rawValue ?? "");

    // Process options from optionsProp or parse <option> children
    const options: SelectOption[] = React.useMemo(() => {
      if (optionsProp && optionsProp.length > 0) {
        return optionsProp;
      }
      const parsed: SelectOption[] = [];
      React.Children.forEach(children, (child) => {
        if (React.isValidElement(child)) {
          // If it's an <option> or React element with value & children
          const props = child.props as any;
          if (props && (props.value !== undefined || props.children !== undefined)) {
            parsed.push({
              value: String(props.value ?? ""),
              label: typeof props.children === "string" ? props.children : String(props.value ?? ""),
              disabled: Boolean(props.disabled),
            });
          }
        }
      });
      return parsed;
    }, [optionsProp, children]);

    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [popoverPosition, setPopoverPosition] = useState<"up" | "down">("down");
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listboxRef = useRef<HTMLUListElement>(null);

    const selectedOption = options.find((opt) => String(opt.value) === value);

    // Determine popover direction
    useEffect(() => {
      if (isOpen) {
        if (direction === "up") {
          setPopoverPosition("up");
        } else if (direction === "down") {
          setPopoverPosition("down");
        } else {
          if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < 260 && rect.top > 200) {
              setPopoverPosition("up");
            } else {
              setPopoverPosition("down");
            }
          }
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
      if (isOpen) {
        document.addEventListener("mousedown", handleClickOutside);
      }
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [isOpen]);

    // Keep highlighted index synced
    useEffect(() => {
      if (isOpen) {
        const idx = options.findIndex((opt) => String(opt.value) === value);
        setHighlightedIndex(idx >= 0 ? idx : 0);
      }
    }, [isOpen, value, options]);

    const handleSelect = useCallback(
      (optionValue: string | number) => {
        const stringVal = String(optionValue);
        if (onChange) {
          onChange({
            target: {
              name,
              value: stringVal,
            },
          });
        }
        setIsOpen(false);
        triggerRef.current?.focus();
      },
      [onChange, name]
    );

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (disabled) return;

      if (!isOpen) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          triggerRef.current?.focus();
          break;

        case "Tab":
          setIsOpen(false);
          break;

        case "ArrowDown": {
          e.preventDefault();
          let next = highlightedIndex < options.length - 1 ? highlightedIndex + 1 : 0;
          while (next !== highlightedIndex && options[next]?.disabled) {
            next = next < options.length - 1 ? next + 1 : 0;
          }
          setHighlightedIndex(next);
          scrollOptionIntoView(next);
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          let prev = highlightedIndex > 0 ? highlightedIndex - 1 : options.length - 1;
          while (prev !== highlightedIndex && options[prev]?.disabled) {
            prev = prev > 0 ? prev - 1 : options.length - 1;
          }
          setHighlightedIndex(prev);
          scrollOptionIntoView(prev);
          break;
        }

        case "Enter":
        case " ":
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < options.length) {
            const targetOpt = options[highlightedIndex];
            if (!targetOpt.disabled) {
              handleSelect(targetOpt.value);
            }
          }
          break;

        case "Home":
          e.preventDefault();
          setHighlightedIndex(0);
          scrollOptionIntoView(0);
          break;

        case "End":
          e.preventDefault();
          setHighlightedIndex(options.length - 1);
          scrollOptionIntoView(options.length - 1);
          break;
      }
    };

    const scrollOptionIntoView = (index: number) => {
      if (!listboxRef.current) return;
      const el = listboxRef.current.children[index] as HTMLElement;
      if (el) {
        el.scrollIntoView({ block: "nearest" });
      }
    };

    return (
      <div className={cn("w-full text-left", className)}>
        {label && (
          <Label htmlFor={selectId} required={required}>
            {label}
          </Label>
        )}
        <div
          ref={containerRef}
          className="relative w-full"
          onKeyDown={handleKeyDown}
        >
          {/* Custom Trigger Button */}
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
              className={cn(
                "text-neutral-400 transition-transform duration-200 shrink-0",
                isOpen && "rotate-180 text-accent"
              )}
            />
          </button>

          {/* Custom Popover Dropdown Menu */}
          {isOpen && (
            <div
              className={cn(
                "absolute left-0 right-0 z-[100] min-w-[180px] bg-white border border-neutral-200 rounded-xl shadow-lg shadow-black/10 py-1.5 animate-fadeIn",
                popoverPosition === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
              )}
            >
              <ul
                ref={listboxRef}
                role="listbox"
                tabIndex={-1}
                aria-activedescendant={
                  highlightedIndex >= 0
                    ? `${selectId || "select"}-opt-${highlightedIndex}`
                    : undefined
                }
                className="max-h-60 overflow-y-auto divide-y divide-transparent focus:outline-none"
              >
                {options.map((opt, idx) => {
                  const isSelected = String(opt.value) === value;
                  const isHighlighted = idx === highlightedIndex;
                  const isDisabled = Boolean(opt.disabled);

                  return (
                    <li
                      key={`${opt.value}-${idx}`}
                      id={`${selectId || "select"}-opt-${idx}`}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={isDisabled}
                      onClick={() => !isDisabled && handleSelect(opt.value)}
                      onMouseEnter={() => !isDisabled && setHighlightedIndex(idx)}
                      className={cn(
                        "px-3.5 py-2 mx-1 rounded-lg text-sm flex items-center justify-between gap-3 transition-colors select-none",
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
                          <span className={cn("shrink-0", isSelected ? "text-accent" : "text-neutral-400")}>
                            {opt.icon}
                          </span>
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
                })}
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

Select.displayName = "Select";
export default Select;
