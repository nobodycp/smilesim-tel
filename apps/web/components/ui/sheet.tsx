'use client';

import * as React from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * A panel that slides in from the reading start of the window (Tailwind migration T2.5, ADR 0022), on Radix Dialog,
 * modal: the page behind it is hidden from assistive technology and does not scroll, the focus stays inside it,
 * Escape and a press outside close it (through `onOpenChange`), and the focus goes back where it was. The panel is
 * `role="dialog"`, named by a `SheetTitle` (or `aria-label`). One side, `start`, the shell drawer
 * (components/app-shell.tsx; the filter bar keeps its own panel, components/filter-bar.tsx): the full height at the
 * reading start, min(300px, 86vw) wide, the page colour (`--rd-bg`), a 1px `--rd-line` rule at its inline end,
 * `--rd-shadow-pop`, 14px on top and 12px at the sides and bottom, a column; the overlay is `--rd-scrim-strong` with
 * a 2px backdrop blur; drawer layer (`--rd-z-drawer`) over the overlay layer (`--rd-z-overlay`). When motion is
 * allowed it slides in from 105% beyond the reading start over 340ms and back out the same way (`rd-sheet-in` /
 * `rd-sheet-out`, app/tailwind.css); the overlay comes and goes at once.
 * Handles: `data-slot="sheet"` (with `data-side`) and `"sheet-overlay"`.
 */

export const Sheet = SheetPrimitive.Root;
export const SheetTitle = SheetPrimitive.Title;

const overlayVariants = cva('fixed inset-0', {
  variants: {
    side: {
      start: 'z-overlay bg-scrim-strong backdrop-blur-[2px]',
    },
  },
  defaultVariants: { side: 'start' },
});

const sheetVariants = cva('fixed flex flex-col shadow-pop', {
  variants: {
    side: {
      start: [
        'inset-y-0 start-0 z-drawer w-[min(300px,86vw)] border-e border-line bg-bg px-3 pt-3.5 pb-3',
        '[--sheet-off:-105%] rtl:[--sheet-off:105%]',
        'motion-safe:data-[state=open]:animate-[rd-sheet-in_340ms_var(--rd-ease-sheet)]',
        'motion-safe:data-[state=closed]:animate-[rd-sheet-out_340ms_var(--rd-ease-sheet)_forwards]',
      ],
    },
  },
  defaultVariants: { side: 'start' },
});

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Extra classes on the overlay. */
  overlayClassName?: string;
}

/** The overlay and the panel, in a portal. */
export const SheetContent = React.forwardRef<React.ComponentRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ className, overlayClassName, side, ...props }, ref) => (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay data-slot="sheet-overlay" className={cn(overlayVariants({ side }), overlayClassName)} />
      <SheetPrimitive.Content
        ref={ref}
        data-slot="sheet"
        data-side={side ?? 'start'}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      />
    </SheetPrimitive.Portal>
  ),
);
SheetContent.displayName = 'SheetContent';
