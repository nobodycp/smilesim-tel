import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/*
 * A square button that holds one icon (Tailwind migration T2.1, ADR 0022), ported from the legacy `.icon-btn` rules
 * (base.css, and its dialog and line-details takes in dialog.css and desk/numbers.css). No fill and no border at
 * rest, 6px corners, the ink focus outline (2px, 1px outside the box) that every keyboard-reached control shares.
 * Sizes: md 34px (the default); lg 36px (a dialog's close); sm 28px with 4px corners, 40px on phones (a copy button
 * beside a value). Tones: muted (`--rd-muted`, hover `--rd-surface-3`); faint (`--rd-faint`, hover `--rd-surface-2`);
 * faint-to-ink (faint, hover `--rd-surface-2` and ink).
 */
export const iconButtonVariants = cva(
  [
    "inline-flex items-center justify-center rounded-sm border-0 bg-transparent",
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
  ],
  {
    variants: {
      size: {
        sm: "size-7 rounded-xs max-sm:size-10",
        md: "size-8.5",
        lg: "size-9",
      },
      tone: {
        muted: "text-muted hover:bg-surface-3",
        faint: "text-faint hover:bg-surface-2",
        "faint-to-ink": "text-faint hover:bg-surface-2 hover:text-ink",
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
