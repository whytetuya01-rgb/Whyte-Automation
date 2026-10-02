import React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  prefixText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = "text",
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      prefixText,
      required,
      id,
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const inputId = id || (label ? generatedId : undefined);

    return (
      <div className="w-full">
        {label && (
          <Label htmlFor={inputId} required={required}>
            {label}
          </Label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3.5 flex items-center pointer-events-none text-neutral-400 shrink-0">
              {leftIcon}
            </div>
          )}
          {prefixText && (
            <span className="absolute left-3.5 text-neutral-400 text-sm font-medium pointer-events-none select-none">
              {prefixText}
            </span>
          )}
          <input
            id={inputId}
            type={type}
            ref={ref}
            disabled={disabled}
            required={required}
            className={cn(
              "w-full px-3.5 py-2.5 border rounded-xl text-sm text-neutral-900 placeholder:text-neutral-400 bg-white transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900",
              "disabled:bg-neutral-50 disabled:text-neutral-400 disabled:cursor-not-allowed",
              error
                ? "border-red-300 focus:border-red-500 focus:ring-red-500/15"
                : "border-neutral-200 hover:border-neutral-300",
              leftIcon && "pl-10",
              prefixText && "pl-8",
              rightIcon && "pr-10",
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3.5 flex items-center text-neutral-400">
              {rightIcon}
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

Input.displayName = "Input";
