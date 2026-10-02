import React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
  description?: string;
  error?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, error, id, disabled, ...props }, ref) => {
    const generatedId = React.useId();
    const checkboxId = id || (label ? generatedId : undefined);

    return (
      <div className="flex flex-col">
        <div className="flex items-start gap-2.5">
          <input
            id={checkboxId}
            type="checkbox"
            ref={ref}
            disabled={disabled}
            className={cn(
              "w-4 h-4 rounded text-black border-neutral-300 focus:ring-2 focus:ring-neutral-900/15 cursor-pointer accent-black mt-0.5",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              className
            )}
            {...props}
          />
          {label && (
            <div className="flex flex-col select-none">
              <label
                htmlFor={checkboxId}
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
        </div>
        {error && <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>}
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";
