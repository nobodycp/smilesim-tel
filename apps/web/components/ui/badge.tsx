import * as React from "react";
import { cn } from "../../lib/utils";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted" | "info" | "violet";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-[var(--accent-soft)] text-[var(--accent)] ring-[var(--accent)]/15",
  success: "bg-[var(--good-bg)] text-[var(--good)] ring-[var(--good)]/15",
  warning: "bg-[var(--warn-bg)] text-[var(--warn)] ring-[var(--warn)]/15",
  danger: "bg-[var(--bad-bg)] text-[var(--bad)] ring-[var(--bad)]/15",
  info: "bg-[var(--info-bg)] text-[var(--info)] ring-[var(--info)]/15",
  violet: "bg-[var(--violet-bg)] text-[var(--violet)] ring-[var(--violet)]/15",
  muted: "bg-[var(--surface-2)] text-[var(--ink-3)] ring-[var(--line)]",
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
