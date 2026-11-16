import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/*
 * A one-line text field (Tailwind migration T2.2, ADR 0022), ported from the legacy element rules for
 * `input:not([type=checkbox|radio|file])` in their cascade order:
 * - forms.css: full width, a 1px solid border, 6px corners (`--rd-radius-sm`), 12px sides, ink text;
 * - graphite.css "Fields": the border at 70% of `--rd-field`, the inset `--rd-sunken` fill, and on focus the crimson
 *   thread — an `--rd-accent` border, the 3px `--rd-focus` ring, no outline;
 * - graphite.css's invalid rule: `aria-invalid="true"` draws an inset 1px `--rd-danger` line while the field is not
 *   focused (the focus ring takes its place). The rule's red border lost to the fields rule by specificity, so the
 *   border keeps the field colour, as today.
 * The type is inherited (`font: inherit`, base.css): a field takes its label's size and weight unless the caller sets
 * one, as every legacy field does.
 * Sizes: md 34px (the default: the desk, pane and dialog control height), lg 42px (forms.css outside the desk); both
 * 44px at 720px and under (the touch rule of responsive.css, frame.css and dialog.css).
 * Surfaces: sunken (the default, graphite's inset field), surface (a field inside a `.pane`, where pane.css's own
 * `--rd-surface` fill outranks graphite's).
 * States no legacy rule reached (Tailwind migration T6.2, from the system's own parts):
 * - read-only: the look forms.css wrote for `input[readonly]` (and lost to the field rule on every property): a
 *   dashed border, no fill, `--rd-muted` text; the focus ring stays, so a keyboard user still sees where they are;
 * - disabled: the one disabled strength (`opacity-disabled`) and a not-allowed pointer, as every control.
 * The border is `--rd-field-line` (`--rd-field` at 70%, the token of the same value). Number fields without spin
 * arrows are the global `input[type=number]` rule in app/tailwind.css.
 */
export const inputVariants = cva(
  [
    "w-full rounded-sm border border-solid border-field-line text-ink max-touch:h-11",
    "focus:border-accent focus:outline-none focus:ring-3 focus:ring-focus",
    "aria-invalid:not-focus:inset-ring aria-invalid:not-focus:inset-ring-danger",
    "read-only:not-disabled:border-dashed read-only:not-disabled:bg-transparent read-only:not-disabled:text-muted",
    "disabled:cursor-not-allowed disabled:opacity-disabled",
  ],
  {
    variants: {
      size: {
        md: "h-8.5 px-3",
        lg: "h-10.5 px-3",
      },
      surface: {
        sunken: "bg-sunken",
        surface: "bg-surface",
      },
    },
    defaultVariants: { size: "md", surface: "sunken" },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

/** A text field. `data-slot="input"` is its handle; a caller's `className` comes last and wins (`cn`). */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, size, surface, ...props }, ref) => (
  <input ref={ref} data-slot="input" className={cn(inputVariants({ size, surface }), className)} {...props} />
));
Input.displayName = "Input";
