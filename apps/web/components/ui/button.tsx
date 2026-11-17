import * as React from "react";
import { Slot } from "radix-ui";
import { Spinner } from "../loading";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button-variants";

export { buttonClass, buttonVariants, type ButtonSize, type ButtonVariant } from "./button-variants";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /**
   * Draw the one child element (a `Link`, an `<a>`, a file `<label>`) as the button, through Radix `Slot`: it takes
   * the classes and `data-slot`, keeps its own tag and props. `disabled` and `loading` are not passed to it.
   */
  asChild?: boolean;
}

/**
 * The action button (look in `button-variants.ts`). `data-slot="button"` is the handle the base rules of
 * app/tailwind.css read (`form > [data-slot='button']`, the dialog's touch height).
 * A pressed state is `aria-pressed`, passed through as given. `loading` is the busy state:
 * the spinner before the label, the button disabled and `aria-busy="true"`, so a screen that waits on a request uses
 * it instead of a bare `disabled`.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading = false, asChild = false, disabled, children, ...props }, ref) => {
    const classes = buttonClass({ variant, size, className });
    if (asChild) {
      return (
        <Slot.Root ref={ref} data-slot="button" className={classes} {...props}>
          {children}
        </Slot.Root>
      );
    }
    return (
      <button
        ref={ref}
        data-slot="button"
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={classes}
        {...props}
      >
        {loading && <Spinner size={16} />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
