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
 * The look (owner, 2026-11-17: the messages were small, at the bottom, and easy to miss on a phone):
 * - the viewport: fixed under the top bar at the reading end (72px from the top, 20px from the end), above every
 *   layer (`--rd-z-top`), a column of toasts 8px apart, letting presses through between them; under 641px it spans
 *   the width less 12px at each side, each toast as wide as it. While the bell's live card is on screen
 *   (`data-slot="notice-toast"`, components/app-shell.tsx) the column starts under that card;
 * - a toast: a row — the tone's icon, the message, the close button — at least 48px high, at most
 *   min(440px, window less 32px) wide (no limit under 641px), 6px corners, a 3px start edge in the tone's colour over
 *   the tone's soft wash laid on the opaque surface (two layers of one background: the merge of class names would
 *   drop a separate surface fill) (`success`, `error` → `--rd-danger`, `warning`, `info`), an inset 1px
 *   `--rd-line` under `--rd-shadow-pop`, ink; it drops in from above over 240ms (`notice-toast-in`) when motion is
 *   allowed;
 * - the icon: 20px, in the tone's colour;
 * - the message: no margin, 14px semibold, wrapping;
 * - the close button: a 28px square (44px at 720px and under), no border or fill, 4px corners, `--rd-muted` 16px, ink
 *   on `--rd-surface-2` under the pointer.
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
      'pointer-events-none fixed end-5 top-18 z-top m-0 grid list-none justify-items-end gap-2 p-0',
      'max-sm:inset-x-3 max-sm:justify-items-stretch',
      // Under the bell's live card while it is on screen, not over it.
      '[body:has([data-slot=notice-toast])_&]:top-36',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = 'ToastViewport';

const toastVariants = cva(
  [
    'pointer-events-auto flex min-h-12 max-w-[min(440px,calc(100vw_-_32px))] items-center gap-2.5 py-2 ps-3.5 pe-2 max-sm:max-w-none',
    'rounded-sm border-0 border-s-3 border-solid text-ink shadow-pop inset-ring inset-ring-line',
    'motion-safe:animate-[notice-toast-in_240ms_var(--rd-ease-out)]',
  ],
  {
    variants: {
      tone: {
        success: 'border-s-success bg-[linear-gradient(var(--rd-success-soft),var(--rd-success-soft)),linear-gradient(var(--rd-surface),var(--rd-surface))] [&>[data-slot=toast-icon]]:text-success',
        error: 'border-s-danger bg-[linear-gradient(var(--rd-danger-soft),var(--rd-danger-soft)),linear-gradient(var(--rd-surface),var(--rd-surface))] [&>[data-slot=toast-icon]]:text-danger',
        warning: 'border-s-warning bg-[linear-gradient(var(--rd-warning-soft),var(--rd-warning-soft)),linear-gradient(var(--rd-surface),var(--rd-surface))] [&>[data-slot=toast-icon]]:text-warning',
        info: 'border-s-info bg-[linear-gradient(var(--rd-info-soft),var(--rd-info-soft)),linear-gradient(var(--rd-surface),var(--rd-surface))] [&>[data-slot=toast-icon]]:text-info',
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

/** The tone's icon, before the message: the caller passes the glyph. */
export function ToastIcon({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span data-slot="toast-icon" aria-hidden="true" className={cn('grid flex-none place-items-center', className)} {...props} />;
}

/** The message. */
export function ToastText({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('m-0 min-w-0 flex-1 text-base font-semibold wrap-break-word', className)} {...props} />;
}

export const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      'grid size-7 flex-none cursor-pointer place-items-center rounded-xs border-0 bg-transparent text-xl text-muted',
      'hover:bg-surface-2 hover:text-ink max-touch:min-h-11 max-touch:min-w-11',
      className,
    )}
    {...props}
  />
));
ToastClose.displayName = 'ToastClose';
