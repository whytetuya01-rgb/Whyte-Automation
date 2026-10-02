import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "outline" | "ghost" | "link" | "accent";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      children,
      variant = "primary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      type = "button",
      ...props
    },
    ref
  ) => {
    const variants = {
      primary:
        "bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[0.98] border border-neutral-900 shadow-xs",
      secondary:
        "bg-neutral-100 text-neutral-800 hover:bg-neutral-200 border border-neutral-200 active:scale-[0.98]",
      danger:
        "bg-red-600 text-white hover:bg-red-700 active:scale-[0.98] shadow-xs border border-transparent",
      outline:
        "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 shadow-2xs active:scale-[0.98]",
      ghost:
        "text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100 border border-transparent active:scale-[0.98]",
      link:
        "text-neutral-900 underline-offset-4 hover:underline border border-transparent !h-auto !px-0 !py-0 shadow-none font-medium",
      accent:
        "bg-admin-primary text-white hover:bg-admin-primary-hover active:scale-[0.98] shadow-xs border border-transparent",
    };

    const sizes = {
      sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
      md: "h-10 px-4 py-2 text-sm rounded-xl gap-2",
      lg: "h-12 px-6 py-2.5 text-base rounded-xl gap-2.5",
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-semibold transition-all select-none cursor-pointer",
          "focus:outline-none focus:ring-2 focus:ring-neutral-900/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
          variants[variant],
          variant !== "link" && sizes[size],
          fullWidth && "w-full",
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2
            className={cn("animate-spin", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")}
          />
        ) : (
          leftIcon
        )}
        {children !== undefined && children !== null && (
          typeof children === "string" || typeof children === "number" ? (
            <span>{children}</span>
          ) : (
            children
          )
        )}
        {!loading && rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";
