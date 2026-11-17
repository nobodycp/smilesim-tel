import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/*
 * A multi-line text field (ADR 0022), the one designed text area: full width, at least 72px, 8px top and bottom and
 * 12px sides, a 1px solid border at 70% of `--rd-field`, 6px corners, the inset `--rd-sunken` fill, ink text,
 * resized only in height; on focus the crimson thread (an `--rd-accent` border, the 3px `--rd-focus` ring, no
 * outline). The type is inherited, as with `Input`. No height is set: the content and `rows` give it, never under
 * 72px. `aria-invalid="true"` draws the same inset danger line as `Input`, and read-only and disabled are `Input`'s:
 * a dashed border, no fill and `--rd-muted` text; the one disabled strength.
 */
export const textareaVariants = cva([
  "min-h-18 w-full resize-y rounded-sm border border-solid border-field-line bg-sunken px-3 py-2 text-ink",
  "focus:border-accent focus:outline-none focus:ring-3 focus:ring-focus",
  "aria-invalid:not-focus:inset-ring aria-invalid:not-focus:inset-ring-danger",
  "read-only:not-disabled:border-dashed read-only:not-disabled:bg-transparent read-only:not-disabled:text-muted",
  "disabled:cursor-not-allowed disabled:opacity-disabled",
]);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

/** A text area. `data-slot="textarea"` is its handle; a caller's `className` comes last and wins (`cn`). */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea ref={ref} data-slot="textarea" className={cn(textareaVariants(), className)} {...props} />
));
Textarea.displayName = "Textarea";
