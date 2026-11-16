'use client';

import * as React from 'react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * Short messages that float over the page (Tailwind migration T2.6, ADR 0022), on Radix Toast: the viewport is a
 * `role="region"` named by its `label` holding an ordered list; each toast is a list item drawn into it through a
 * portal, wherever in the tree it is rendered; Radix keeps the Tab order through the viewport and closes a toast from
 * its close button or from Escape while it is the top layer. `components/toast.tsx` composes these parts into the
 * toasts the screens push.
 *
 * The look is the legacy toast's (dialog.css `.toast-host`, `.toast*` and responsive.css's touch rule), in their
 * cascade order:
 * - the viewport: fixed 20px from the bottom and from the reading end, above every layer (`--rd-z-top`), a column of
 *   toasts 8px apart at the reading end, letting presses through between them; under 641px it spans the width less
 *   12px at each side, 12px from the bottom, each toast as wide as it;
 * - a toast: a row, 10px between the message and the close button, at most min(420px, window less 32px) wide (no
 *   limit under 641px), 11px above and below, 14px at the reading start and 8px at the end, no border but a 3px
 *   start edge in `--rd-success` (`tone="error"`: `--rd-danger`), 6px corners, the surface fill, an inset 1px
 *   `--rd-line` under `--rd-shadow-pop`, ink; it rises in over 220ms (`rd-toast-in`, dialog.css) when motion is
 *   allowed;
 * - the message: no margin, 13px semibold;
 * - the close button: a 28px square (44px at 720px and under), no border or fill, 4px corners, `--rd-faint` 16px,
 *   ink on `--rd-surface-2` under the pointer.
 * Handles: `data-slot="toast"` (with `data-tone`).
 */

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      'pointer-events-none fixed end-5 bottom-5 z-top m-0 grid list-none justify-items-end gap-2 p-0',
      'max-sm:inset-x-3 max-sm:bottom-3 max-sm:justify-items-stretch',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = 'ToastViewport';

const toastVariants = cva(
  [
    'pointer-events-auto flex max-w-[min(420px,calc(100vw_-_32px))] items-center gap-2.5 py-2.75 ps-3.5 pe-2 max-sm:max-w-none',
    'rounded-sm border-0 border-s-3 border-solid bg-surface text-ink shadow-pop inset-ring inset-ring-line',
    'motion-safe:animate-[rd-toast-in_220ms_var(--rd-ease-out)]',
  ],
  {
    variants: {
      tone: {
        success: 'border-s-success',
        error: 'border-s-danger',
      },
    },
    defaultVariants: { tone: 'success' },
  },
);

export type ToastTone = NonNullable<VariantProps<typeof toastVariants>['tone']>;

export interface ToastProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
    VariantProps<typeof toastVariants> {}

export const Toast = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, tone, ...props }, ref) => (
    <ToastPrimitive.Root
      ref={ref}
      data-slot="toast"
      data-tone={tone ?? 'success'}
      className={cn(toastVariants({ tone }), className)}
      {...props}
    />
  ),
);
Toast.displayName = 'Toast';

/** The message. */
export function ToastText({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('m-0 text-md font-semibold', className)} {...props} />;
}

export const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      'grid size-7 flex-none cursor-pointer place-items-center rounded-xs border-0 bg-transparent text-xl text-faint',
      'hover:bg-surface-2 hover:text-ink max-[721px]:min-h-11 max-[721px]:min-w-11',
      className,
    )}
    {...props}
  />
));
ToastClose.displayName = 'ToastClose';
