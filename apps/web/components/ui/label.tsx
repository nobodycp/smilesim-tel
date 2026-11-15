import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/*
 * A field's label (Tailwind migration T2.2, ADR 0022), ported from the legacy label rules: a one-column grid, its
 * text at the reading start. It may wrap its control (the legacy pattern: the text, then the field) or name one by
 * `htmlFor` (`Field`). Tones, one per legacy context:
 * - page: forms.css `label` — 6px gap, 13px (`--rd-text-md`) semibold `--rd-ink-2`;
 * - pane: pane.css `.pane label` — 4px gap, 11px (`--rd-text-xs`) semibold `--rd-muted`;
 * - dialog: dialog.css `.dialog-body label:not(.check)` — 4px gap, 11px bold `--rd-muted`.
 */
export const labelVariants = cva("grid text-start", {
  variants: {
    tone: {
      page: "gap-1.5 text-md font-semibold text-ink-2",
      pane: "gap-1 text-xs font-semibold text-muted",
      dialog: "gap-1 text-xs font-bold text-muted",
    },
  },
  defaultVariants: { tone: "page" },
});

export type LabelTone = NonNullable<VariantProps<typeof labelVariants>["tone"]>;

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement>, VariantProps<typeof labelVariants> {}

/** A label. `data-slot="label"` is its handle; a caller's `className` comes last and wins (`cn`). */
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(({ className, tone, ...props }, ref) => (
  <label ref={ref} data-slot="label" className={cn(labelVariants({ tone }), className)} {...props} />
));
Label.displayName = "Label";
