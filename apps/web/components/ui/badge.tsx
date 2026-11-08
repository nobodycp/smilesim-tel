import * as React from "react";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted" | "info" | "violet";

/** A status pill. Styles live in app/styles/ui.css (.ui-badge*). */
export function Badge({
  className,
  variant = "default",
  dot = false,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant; dot?: boolean }) {
  return (
    <span className={["ui-badge", `ui-badge-${variant}`, className].filter(Boolean).join(" ")} {...props}>
      {dot && <span className="ui-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
