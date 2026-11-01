import * as React from "react";
import { cn } from "../../lib/utils";
import { Spinner } from "../loading";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "default" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm hover:bg-[var(--accent-2)] active:bg-[var(--accent-2)]",
  secondary:
    "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] shadow-sm hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
  outline:
    "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] shadow-sm hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
  ghost: "bg-transparent text-[var(--ink-2)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]",
  danger:
    "bg-[var(--bad)] text-white shadow-sm hover:bg-[color-mix(in_srgb,var(--bad)_85%,black)]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  default: "h-9 gap-2 px-4 text-sm",
  lg: "h-10 gap-2 px-5 text-sm",
  icon: "h-9 w-9",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", loading = false, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
          "disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading && <Spinner size={16} />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
