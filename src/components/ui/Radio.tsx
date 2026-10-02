import React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  label?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  error?: string;
  helperText?: string;
  className?: string;
  orientation?: "horizontal" | "vertical";
  required?: boolean;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({
  label,
  name,
  value,
  onChange,
  options,
  error,
  helperText,
  className,
  orientation = "vertical",
  required,
}) => {
  const generatedName = React.useId();
  const groupName = name || generatedName;

  return (
    <div className={cn("w-full", className)}>
      {label && <Label required={required}>{label}</Label>}
      <div
        className={cn(
          "gap-2.5",
          orientation === "horizontal" ? "flex flex-wrap items-center" : "flex flex-col"
        )}
      >
        {options.map((opt) => {
          const isSelected = opt.value === value;
          const optId = `${groupName}-${opt.value}`;

          return (
            <label
              key={opt.value}
              htmlFor={optId}
              className={cn(
                "flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all cursor-pointer select-none",
                isSelected
                  ? "border-black bg-neutral-50 text-neutral-950 font-medium shadow-2xs"
                  : "border-neutral-200 hover:bg-neutral-50/80 text-neutral-700",
                opt.disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <input
                id={optId}
                type="radio"
                name={groupName}
                value={opt.value}
                checked={isSelected}
                disabled={opt.disabled}
                onChange={() => onChange(opt.value)}
                className="w-4 h-4 text-black border-neutral-300 focus:ring-2 focus:ring-neutral-900/15 cursor-pointer accent-black mt-0.5"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium leading-none">{opt.label}</span>
                {opt.description && (
                  <span className="text-xs text-neutral-400 mt-1">{opt.description}</span>
                )}
              </div>
            </label>
          );
        })}
      </div>
      {error ? (
        <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-neutral-400 mt-1">{helperText}</p>
      ) : null}
    </div>
  );
};

RadioGroup.displayName = "RadioGroup";
