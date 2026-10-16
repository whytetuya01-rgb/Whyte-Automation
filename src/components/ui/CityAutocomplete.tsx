"use client";

import { useState, useRef, useEffect, useId, useCallback } from "react";
import { MapPin, X, Check } from "lucide-react";
import { searchIndianCities, IndianCity } from "@/lib/indianCities";

interface CityAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export default function CityAutocomplete({
  value,
  onChange,
  placeholder = "e.g. Ahmedabad, Gujarat",
  error,
  disabled = false,
  required = false,
  className = "",
}: CityAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Filter suggestions based on current value
  const suggestions = searchIndianCities(value, 8);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectCity = useCallback(
    (item: IndianCity) => {
      const formatted = `${item.city}, ${item.state}`;
      onChange(formatted);
      setIsOpen(false);
      setHighlightedIndex(-1);
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIsOpen(true);
        setHighlightedIndex(0);
        return;
      }
    }

    if (isOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
      } else if (e.key === "Enter") {
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          e.preventDefault();
          handleSelectCity(suggestions[highlightedIndex]);
        } else {
          setIsOpen(false);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative">
        <MapPin
          size={15}
          className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
            isOpen ? "text-[var(--color-admin-primary)]" : "text-gray-400"
          }`}
        />

        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={disabled}
          required={required}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={`w-full h-11 pl-10 pr-9 border rounded-xl text-sm focus:outline-none focus:ring-2 transition bg-white text-gray-900 ${
            error
              ? "border-red-400 focus:ring-red-500/20"
              : isOpen
              ? "border-[var(--color-admin-primary)] ring-2 ring-[var(--color-admin-primary-soft)]"
              : "border-gray-200 focus:border-[var(--color-admin-primary)] focus:ring-[var(--color-admin-primary-soft)]"
          } ${disabled ? "opacity-60 bg-gray-50 cursor-not-allowed" : ""}`}
        />

        {value && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              onChange("");
              setIsOpen(true);
              inputRef.current?.focus();
            }}
            aria-label="Clear city input"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded-md hover:bg-gray-100 transition"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Autocomplete Suggestions Dropdown */}
      {isOpen && suggestions.length > 0 && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1.5 bg-white rounded-xl border border-gray-200/90 shadow-xl max-h-60 overflow-y-auto py-1 animate-in fade-in-50 zoom-in-95 duration-100"
        >
          <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between border-b border-gray-100">
            <span>Suggested Indian Cities</span>
            <span className="text-[9px] font-normal text-gray-400">Select or type custom</span>
          </div>

          {suggestions.map((item, idx) => {
            const isHighlighted = idx === highlightedIndex;
            const fullCityStr = `${item.city}, ${item.state}`;
            const isSelected = value.trim().toLowerCase() === fullCityStr.toLowerCase() ||
                               value.trim().toLowerCase() === item.city.toLowerCase();

            return (
              <button
                key={`${item.city}-${item.state}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelectCity(item)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                  isHighlighted
                    ? "bg-[var(--color-admin-primary-soft)] text-gray-950 font-medium"
                    : isSelected
                    ? "bg-gray-50 text-gray-950 font-medium"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <MapPin
                    size={14}
                    className={`shrink-0 ${
                      isHighlighted || isSelected
                        ? "text-[var(--color-admin-primary)]"
                        : "text-gray-400"
                    }`}
                  />
                  <span className="font-semibold text-gray-900 truncate">
                    {item.city}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 font-normal shrink-0">
                    {item.state}
                  </span>
                </div>

                {isSelected && (
                  <Check size={14} className="text-[var(--color-admin-primary)] shrink-0 ml-1" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
