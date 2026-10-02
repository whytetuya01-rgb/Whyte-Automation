import React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./Label";

export interface FormFieldProps {
  label?: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  required,
  error,
  helperText,
  htmlFor,
  className,
  children,
}) => {
  return (
    <div className={cn("w-full", className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-gray-400 mt-1">{helperText}</p>
      ) : null}
    </div>
  );
};

FormField.displayName = "FormField";
