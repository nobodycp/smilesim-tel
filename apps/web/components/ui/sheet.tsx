'use client';

import * as React from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * A panel that slides in from a side of the window (Tailwind migration T2.5, ADR 0022), on Radix Dialog, modal: the
 * page behind it is hidden from assistive technology and does not scroll, the focus stays inside it, Escape and a
 * press outside close it (through `onOpenChange`), and the focus goes back where it was. The panel is
 * `role="dialog"`, named by a `SheetTitle` (or `aria-label`). Two sides, each the look of the legacy panel it
 * replaces (the shell drawer is on it since T3.1, components/app-shell.tsx; the filter bar keeps its own panel, which
 * becomes the same drawer in place on a phone, components/filter-bar.tsx since T2.9):
 * - start: the shell drawer (the former shell.css `.drawer` and `.backdrop`): the full height at the reading start,
 *   min(300px, 86vw) wide, the page colour (`--rd-bg`), a 1px `--rd-line` rule at its inline end,
 *   `--rd-shadow-pop`, 14px on top and 12px at the sides and bottom, a column; the overlay is `--rd-scrim-strong`
 *   with a 2px backdrop blur; drawer layer (`--rd-z-drawer`) over the overlay layer (`--rd-z-overlay`). When motion
 *   is allowed it slides in from 105% beyond the reading start over 340ms and back out the same way (`rd-sheet-in` /
 *   `rd-sheet-out`, app/tailwind.css; base.css's `.drawer` transition did both ways); the overlay comes and goes at once;
 * - end: the look of the filter bar's phone drawer (components/filter-bar.tsx, the former graphite.css drawer rules):
 *   the full height at the reading end, min(380px, 92vw) wide, the surface fill, `--rd-shadow-pop`, 18px at the
 *   sides and bottom and none on top, a column 12px apart, scrolling; it slides in over 220ms (`filter-slide`,
 *   graphite.css) when motion is allowed; the overlay is `--rd-scrim`; one step over the dialog layer
 *   (`--rd-z-dialog-drawer`);
 * - bottom (Tailwind migration T6.2, built from the end sheet's parts, no legacy panel to port): the full width at the
 *   bottom of the window, at most 85% of the dynamic viewport high, the surface fill, `--rd-shadow-pop`, a 1px
 *   `--rd-line` rule on top and the stand-alone surface's 10px corners (`--rd-radius-panel`) on its two top
 *   corners, 16px at the sides and 18px at the bottom (none on top: its head sets it), a column 12px apart,
 *   scrolling; it rises in (`rd-rise`, 220ms, `--rd-ease-out`) when motion is allowed; the overlay is `--rd-scrim`;
 *   the end sheet's layer.
 * Handles: `data-slot="sheet"` (with `data-side`) and `"sheet-overlay"`.
 */

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetTitle = SheetPrimitive.Title;
export const SheetDescription = SheetPrimitive.Description;

const overlayVariants = cva('fixed inset-0', {
  variants: {
    side: {
      start: 'z-overlay bg-scrim-strong backdrop-blur-[2px]',
      end: 'z-dialog bg-scrim',
      bottom: 'z-dialog bg-scrim',
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
      end: [
        'inset-y-0 end-0 z-dialog-drawer w-drawer flex-nowrap items-stretch gap-3 overflow-y-auto',
        'bg-surface px-4.5 pt-0 pb-4.5 motion-safe:animate-drawer',
      ],
      bottom: [
        'inset-x-0 bottom-0 z-dialog-drawer max-h-[85dvh] flex-nowrap items-stretch gap-3 overflow-y-auto',
        'rounded-t-panel border-t border-line bg-surface px-4 pt-0 pb-4.5',
        'motion-safe:animate-[rd-rise_220ms_var(--rd-ease-out)]',
      ],
    },
  },
  defaultVariants: { side: 'start' },
});

export type SheetSide = NonNullable<VariantProps<typeof sheetVariants>['side']>;

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
