import * as React from "react";
import { Spinner } from "../loading";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "default" | "lg" | "icon" | "iconSm";

// Styles live in app/styles/ui.css (.ui-btn*).
const sizeClasses: Record<ButtonSize, string> = {
  sm: "ui-btn-sm",
  default: "ui-btn-md",
  lg: "ui-btn-lg",
  icon: "ui-btn-icon",
  iconSm: "ui-btn-icon-sm",
};

/** The classes of a Button, for an element that must look like one but is not a <button> (a Link). */
export function buttonClass({ variant = "primary", size = "default" }: { variant?: ButtonVariant; size?: ButtonSize } = {}) {
  return `ui-btn ui-btn-${variant} ${sizeClasses[size]}`;
}

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
        className={className ? `${buttonClass({ variant, size })} ${className}` : buttonClass({ variant, size })}
        {...props}
      >
        {loading && <Spinner size={16} />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
