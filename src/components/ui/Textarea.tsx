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
      "aria-describedby": ariaDescribedByProp,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const textareaId = id || (label ? generatedId : undefined);
    const errorId = textareaId ? `${textareaId}-error` : undefined;
    const helperId = textareaId ? `${textareaId}-helper` : undefined;

    const describedBy = [
      ariaDescribedByProp,
      error ? errorId : helperText ? helperId : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

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
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full px-3.5 py-2.5 border rounded-xl text-sm font-normal text-neutral-900 placeholder:text-neutral-400 bg-white transition-all shadow-2xs",
            "focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent",
            "disabled:bg-neutral-50 disabled:text-neutral-400 disabled:border-neutral-200 disabled:cursor-not-allowed disabled:shadow-none",
            error
              ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
              : "border-neutral-200 hover:border-neutral-300",
            className
          )}
          {...props}
        />
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-red-600 mt-1.5 font-medium">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-xs text-neutral-500 mt-1.5">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
