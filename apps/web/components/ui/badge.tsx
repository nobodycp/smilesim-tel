import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/cn";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted" | "info" | "violet";

/*
 * A status pill (Tailwind migration T2.7, ADR 0022), ported from the legacy `.ui-badge*` rules of ui.css and the
 * graphite.css overrides over them, in their cascade order:
 * - the pill: an inline row as wide as its content, items centred, 6px between them, on one line, 4px corners
 *   (graphite), 2px / 8px padding, 11.5px semibold, the tone's soft fill and text, and an inset 1px ring of the text
 *   colour at 15% (`muted`: `--rd-line`);
 * - with `dot` (graphite's diamond status mark): no fill, no ring, no side padding, 7px between the mark and the
 *   words, 12.5px; the mark is a 7px square turned 45deg with 1px corners in the text colour, glowing 8px in it
 *   (`muted` does not glow).
 * `info` and `violet` have their own tokens since Tailwind migration T6.2 (`--rd-info`, `--rd-violet` and their soft
 * fills, both themes, text ≥4.5:1 on the soft fill): the pill and the mark draw them as every other tone (before,
 * their tokens did not exist and they drew no fill, no ring and the surrounding text colour).
 * Handles: `data-slot="badge"` (the legacy placement rules read it), `data-testid="badge"` (a caller's own wins).
 */
const badgeVariants = cva("inline-flex w-fit items-center whitespace-nowrap rounded-xs py-0.5 font-semibold", {
  variants: {
    variant: {
      default: "text-primary-bg",
      success: "text-success",
      warning: "text-warning",
      danger: "text-danger",
      muted: "text-muted",
      info: "text-info",
      violet: "text-violet",
    },
    dot: {
      false: "gap-1.5 px-2 text-caption",
      true: "gap-1.75 bg-transparent px-0 text-chip",
    },
  },
  compoundVariants: [
    { dot: false, variant: "default", className: "bg-primary-soft inset-ring inset-ring-primary-bg/15" },
    { dot: false, variant: "success", className: "bg-success-soft inset-ring inset-ring-success/15" },
    { dot: false, variant: "warning", className: "bg-warning-soft inset-ring inset-ring-warning/15" },
    { dot: false, variant: "danger", className: "bg-danger-soft inset-ring inset-ring-danger/15" },
    { dot: false, variant: "muted", className: "bg-surface-2 inset-ring inset-ring-line" },
    { dot: false, variant: "info", className: "bg-info-soft inset-ring inset-ring-info/15" },
    { dot: false, variant: "violet", className: "bg-violet-soft inset-ring inset-ring-violet/15" },
  ],
  defaultVariants: { variant: "default", dot: false },
});

export function Badge({
  className,
  variant = "default",
  dot = false,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant; dot?: boolean }) {
  return (
    <span data-testid="badge" data-slot="badge" className={cn(badgeVariants({ variant, dot }), className)} {...props}>
      {dot && (
        <span
          className={cn(
            "size-1.75 shrink-0 rotate-45 rounded-[1px] bg-current",
            variant === "muted" ? "shadow-none" : "shadow-glow",
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
