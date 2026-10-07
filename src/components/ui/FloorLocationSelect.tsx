"use client";

import { useState, useEffect } from "react";
import { Select } from "./Select";

export const DEFAULT_FLOOR_OPTIONS = [
  "Ground Floor",
  "First Floor",
  "Second Floor",
  "Third Floor",
  "Basement",
  "Terrace",
  "Outdoor",
  "Other",
] as const;

const FLOOR_SELECT_OPTIONS = DEFAULT_FLOOR_OPTIONS.map((opt) => ({ value: opt, label: opt }));

export type FloorOption =typeof DEFAULT_FLOOR_OPTIONS[number];

interface Props {
  value: string | null | undefined;
  onChange: (val: string | null) => void;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  showLabel?: boolean;
}

export default function FloorLocationSelect({
  value,
  onChange,
  className = "",
  disabled = false,
  size = "md",
  showLabel = true,
}: Props) {
  const normalizedValue = value?.trim() || "";

  // Check if current value matches one of the standard floor options (excluding "Other")
  const isStandardOption = Boolean(
    normalizedValue &&
      (DEFAULT_FLOOR_OPTIONS as readonly string[]).includes(normalizedValue) &&
      normalizedValue !== "Other"
  );

  // Selected option in dropdown
  const selectedDropdownValue = isStandardOption
    ? normalizedValue
    : normalizedValue
    ? "Other"
    : "Ground Floor";

  const [customText, setCustomText] = useState(() =>
    !isStandardOption && normalizedValue && normalizedValue !== "Other"
      ? normalizedValue
      : ""
  );

  useEffect(() => {
    if (!isStandardOption && normalizedValue && normalizedValue !== "Other") {
      setCustomText(normalizedValue);
    }
  }, [normalizedValue, isStandardOption]);

  const handleSelectChange = (e: { target: { value: string } }) => {
    const val = e.target.value;
    if (val === "Other") {
      onChange(customText.trim() || "Other");
    } else {
      onChange(val || null);
    }
  };

  const handleCustomTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setCustomText(text);
    onChange(text.trim() || "Other");
  };

  const handleCustomBlur = () => {
    const trimmed = customText.trim();
    onChange(trimmed || "Other");
  };

  const heightClass = size === "sm" ? "h-8 text-xs px-2.5" : "h-9 text-xs px-3";

  return (
    <div className={`space-y-1.5 ${className}`}>
      {showLabel && (
        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          Floor / Location
        </label>
      )}
      <Select
        value={selectedDropdownValue}
        onChange={handleSelectChange}
        disabled={disabled}
        ariaLabel="Floor / Location"
        options={FLOOR_SELECT_OPTIONS}
        triggerClassName={size === "sm" ? "h-8 text-xs px-2.5" : "h-9 text-xs px-3"}
      />

      {selectedDropdownValue === "Other" && (
        <div className="pt-1 space-y-1">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">
            Custom Location
          </label>
          <input
            type="text"
            value={customText}
            onChange={handleCustomTextChange}
            onBlur={handleCustomBlur}
            placeholder="Enter location"
            disabled={disabled}
            className={`w-full ${heightClass} bg-white border border-gray-300 rounded-xl font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-950 focus:border-transparent disabled:opacity-50 shadow-2xs transition-colors`}
          />
        </div>
      )}
    </div>
  );
}
