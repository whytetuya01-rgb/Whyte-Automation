"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
  count?: number;
}

interface CustomDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  id?: string;
  ariaLabel?: string;
  className?: string;
  direction?: "up" | "down" | "auto";
  disabled?: boolean;
}

export default function CustomDropdown({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  icon,
  id,
  ariaLabel,
  className,
  direction = "auto",
  disabled = false,
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [popoverPosition, setPopoverPosition] = useState<"up" | "down">("down");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

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

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
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

  // Keep highlighted index in sync when opening
  useEffect(() => {
    if (isOpen) {
      const idx = options.findIndex((opt) => opt.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, value, options]);

  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [onChange]
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
        const nextIndex =
          highlightedIndex < options.length - 1 ? highlightedIndex + 1 : 0;
        setHighlightedIndex(nextIndex);
        scrollOptionIntoView(nextIndex);
        break;
      }

      case "ArrowUp": {
        e.preventDefault();
        const prevIndex =
          highlightedIndex > 0 ? highlightedIndex - 1 : options.length - 1;
        setHighlightedIndex(prevIndex);
        scrollOptionIntoView(prevIndex);
        break;
      }

      case "Enter":
      case " ":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          handleSelect(options[highlightedIndex].value);
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
    const optionElement = listboxRef.current.children[index] as HTMLElement;
    if (optionElement) {
      optionElement.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block text-left", className)}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || placeholder}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        className={cn(
          "h-10 px-3.5 border rounded-xl text-sm font-medium transition-all inline-flex items-center justify-between gap-2.5 select-none bg-white shadow-2xs",
          disabled
            ? "opacity-50 cursor-not-allowed bg-neutral-100/60 text-neutral-400 border-neutral-200 shadow-none pointer-events-none"
            : isOpen
              ? "border-accent ring-2 ring-accent/15 text-neutral-950 cursor-pointer"
              : "border-neutral-200 text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent cursor-pointer"
        )}
      >
        <div className="flex items-center gap-2 truncate">
          {icon && <span className="text-neutral-400 shrink-0">{icon}</span>}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "text-neutral-400 transition-transform duration-200 shrink-0",
            isOpen && "rotate-180 text-accent"
          )}
        />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          className={cn(
            "absolute left-0 z-50 min-w-[200px] w-max max-w-xs bg-white border border-neutral-200 rounded-xl shadow-lg shadow-black/10 py-1.5 animate-fadeIn",
            popoverPosition === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          )}
        >
          <ul
            ref={listboxRef}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={
              highlightedIndex >= 0
                ? `${id || "dropdown"}-opt-${highlightedIndex}`
                : undefined
            }
            className="max-h-64 overflow-y-auto divide-y divide-transparent focus:outline-none"
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightedIndex;

              return (
                <li
                  key={opt.value}
                  id={`${id || "dropdown"}-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={cn(
                    "px-3 py-2 mx-1 rounded-lg text-sm flex items-center justify-between gap-3 cursor-pointer transition-colors select-none",
                    isSelected
                      ? "bg-accent-light text-accent-foreground font-semibold border border-accent-border/60"
                      : isHighlighted
                        ? "bg-accent-light/40 text-neutral-950"
                        : "text-neutral-700 hover:bg-accent-light/30"
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
                      <span className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-md",
                        isSelected ? "bg-accent-border/50 text-accent-foreground" : "bg-neutral-100 text-neutral-600"
                      )}>
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && (
                      <Check size={14} className="text-accent stroke-[2.5]" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
