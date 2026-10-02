import React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      helperText,
      error,
      rows = 3,
      required,
      id,
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const textareaId = id || (label ? generatedId : undefined);

    return (
      <div className="w-full">
        {label && (
          <Label htmlFor={textareaId} required={required}>
            {label}
          </Label>
        )}
        <textarea
          id={textareaId}
          ref={ref}
          rows={rows}
          disabled={disabled}
          required={required}
          className={cn(
            "w-full px-3.5 py-2.5 border rounded-xl text-sm text-neutral-900 placeholder:text-neutral-400 bg-white transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900",
            "disabled:bg-neutral-50 disabled:text-neutral-400 disabled:cursor-not-allowed",
            error
              ? "border-red-300 focus:border-red-500 focus:ring-red-500/15"
              : "border-neutral-200 hover:border-neutral-300",
            className
          )}
          {...props}
        />
        {error ? (
          <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-neutral-400 mt-1">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
