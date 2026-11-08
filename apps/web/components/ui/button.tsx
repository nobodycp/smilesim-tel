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
        className={["ui-btn", `ui-btn-${variant}`, sizeClasses[size], className].filter(Boolean).join(" ")}
        {...props}
      >
        {loading && <Spinner size={16} />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
