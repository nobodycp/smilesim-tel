import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/*
 * A square button that holds one icon (Tailwind migration T2.1, ADR 0022), ported from the legacy `.icon-btn` rules
 * (base.css, and its dialog and line-details takes in dialog.css and desk/numbers.css). No fill and no border at
 * rest, 6px corners, the ink focus outline (2px, 1px outside the box) that every keyboard-reached icon control shares.
 * Sizes: md 34px (the default); lg 36px (a dialog's close); sm 28px with 4px corners (a copy button beside a value).
 * Tones: muted (`--rd-muted`, hover `--rd-surface-3`); faint (`--rd-muted` at rest, hover `--rd-surface-2`);
 * faint-to-ink (the same, ink under the pointer); danger (`--rd-danger`, hover `--rd-danger-soft`: an icon that
 * deletes).
 * States (Tailwind migration T6.2): at least 44 × 44 at 720px and under, every size (the touch rule; `sm` was 40px
 * under 641px and the others kept their size); disabled at the one disabled strength (`opacity-disabled`) with no
 * pointer; pressed (`aria-pressed="true"`) holds the hover fill in ink (`danger`: its soft fill). The faint tones
 * draw their icon in `--rd-muted`, not `--rd-faint`: an icon that acts is a control and needs 3:1 (audit 3.10-05;
 * `--rd-faint` is for decoration and what cannot be used).
 */
export const iconButtonVariants = cva(
  [
    "inline-flex items-center justify-center rounded-sm border-0 bg-transparent",
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
    "disabled:pointer-events-none disabled:opacity-disabled max-touch:min-h-11 max-touch:min-w-11",
  ],
  {
    variants: {
      size: {
        sm: "size-7 rounded-xs",
        md: "size-8.5",
        lg: "size-9",
      },
      tone: {
        muted: "text-muted hover:bg-surface-3 aria-pressed:bg-surface-3 aria-pressed:text-ink",
        faint: "text-muted hover:bg-surface-2 aria-pressed:bg-surface-2 aria-pressed:text-ink",
        "faint-to-ink": "text-muted hover:bg-surface-2 hover:text-ink aria-pressed:bg-surface-2 aria-pressed:text-ink",
        danger: "text-danger hover:bg-danger-soft aria-pressed:bg-danger-soft",
      },
    },
    defaultVariants: { size: "md", tone: "muted" },
  }
);

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">,
    VariantProps<typeof iconButtonVariants> {
  /** The button's accessible name: an icon has no text of its own. */
  "aria-label": string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size, tone, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="icon-button"
      className={cn(iconButtonVariants({ size, tone }), className)}
      {...props}
    />
  )
);
IconButton.displayName = "IconButton";
