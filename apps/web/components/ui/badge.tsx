import * as React from "react";
import { cn } from "../../lib/utils";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted" | "info" | "violet";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-[var(--rd-primary-soft)] text-[var(--rd-primary-bg)] ring-[var(--rd-primary-bg)]/15",
  success: "bg-[var(--rd-success-soft)] text-[var(--rd-success)] ring-[var(--rd-success)]/15",
  warning: "bg-[var(--rd-warning-soft)] text-[var(--rd-warning)] ring-[var(--rd-warning)]/15",
  danger: "bg-[var(--rd-danger-soft)] text-[var(--rd-danger)] ring-[var(--rd-danger)]/15",
  info: "bg-[var(--info-bg)] text-[var(--info)] ring-[var(--info)]/15",
  violet: "bg-[var(--violet-bg)] text-[var(--violet)] ring-[var(--violet)]/15",
  muted: "bg-[var(--rd-surface-2)] text-[var(--rd-muted)] ring-[var(--rd-line)]",
};

export function Badge({
  className,
  variant = "default",
  dot = false,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
