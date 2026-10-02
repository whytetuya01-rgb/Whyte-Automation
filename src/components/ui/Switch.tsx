import React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  size?: "sm" | "md";
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
  id,
  size = "md",
}) => {
  const generatedId = React.useId();
  const switchId = id || (label ? generatedId : undefined);

  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      {label && (
        <div className="flex flex-col select-none">
          <label
            htmlFor={switchId}
            className={cn(
              "text-sm font-medium text-neutral-800 cursor-pointer",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {label}
          </label>
          {description && (
            <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
          )}
        </div>
      )}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-900/15 cursor-pointer",
          size === "sm" ? "h-5 w-9" : "h-6 w-11",
          checked ? "bg-black" : "bg-neutral-200 hover:bg-neutral-300",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "inline-block transform rounded-full bg-white shadow-xs transition-transform",
            size === "sm"
              ? cn("h-3.5 w-3.5", checked ? "translate-x-4.5" : "translate-x-0.5")
              : cn("h-4 w-4", checked ? "translate-x-6" : "translate-x-1")
          )}
        />
      </button>
    </div>
  );
};

Switch.displayName = "Switch";
