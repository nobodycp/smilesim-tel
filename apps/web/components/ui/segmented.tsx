'use client';

import * as React from 'react';
import { ToggleGroup } from 'radix-ui';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * A segmented control: one choice out of a few, side by side (ADR 0022), on Radix
 * ToggleGroup `type="single"`: the group is `role="radiogroup"`, each segment a `role="radio"` button with
 * `aria-checked` and `data-state="on|off"`; arrow keys move between segments (mirrored in RTL), Tab enters at the
 * chosen one. Picking the chosen segment again keeps it (the group never goes empty). The look:
 * - the group: no padding, gap or border, 6px corners, no fill, an inset 1px ink line at 11%, clipped to its corners;
 *   `fill` makes it a full-width grid of equal segments;
 * - a segment: 32px high, 10px sides, square, no border or fill, `--rd-muted` 12px bold; each after the first draws a
 *   1px ink line at 11% on its start edge; the chosen one sits on `--rd-surface-2` in ink with the 2px crimson thread
 *   underneath; at least 44px high at 720px and under (the touch rule). With `fill` a long label stays on one line
 *   and ends in an ellipsis.
 * States: under the pointer an
 * unchosen, usable segment turns ink on `--rd-surface-2` (as a tab does); keyboard focus is the 2px `--rd-accent`
 * outline drawn inside the segment (the focus mark of an item in a strip or a list: tabs, segments, periods, page
 * numbers, list rows), so the group's clipping never cuts it; a disabled segment (or a disabled group) is at the one
 * disabled strength with a not-allowed pointer.
 *
 * `SegmentedToggle` / `SegmentedToggleItem` are the toggle form, the period switch of features/reports/report-kit.tsx
 * and features/wallets/wallet-head.tsx: a `role="group"` row of plain buttons, each `aria-pressed`, every one in the
 * Tab order (no roving), the caller keeping the choice. The row keeps its width, 4px corners, a 1px inset `--rd-line` edge, clipped; the
 * whole row under 768px, its buttons sharing it with 6px sides. A button: 34px (44px at 720px and under), 12px
 * sides, no border or fill, `--rd-muted` 12.5px semibold on one line, ink under the pointer; each after the first
 * draws a 1px `--rd-line` on its start edge; the pressed one sits on `--rd-surface-2` in ink over the crimson thread;
 * the focus mark is the strip's (2px `--rd-accent` inside).
 */
const segmentedVariants = cva('gap-0 overflow-hidden rounded-sm border-0 bg-transparent p-0 inset-ring inset-ring-line-strong', {
  variants: {
    fill: {
      false: 'inline-flex',
      true: 'grid w-full auto-cols-fr grid-flow-col',
    },
  },
  defaultVariants: { fill: false },
});

const segmentVariants = cva(
  [
    'h-8 rounded-none border-0 bg-transparent px-2.5 py-0 text-sm font-bold text-muted max-touch:min-h-11',
    'not-first:border-s not-first:border-s-line-strong',
    'not-disabled:data-[state=off]:hover:bg-surface-2 not-disabled:data-[state=off]:hover:text-ink',
    'data-[state=on]:bg-surface-2 data-[state=on]:text-ink data-[state=on]:shadow-thread',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-not-allowed disabled:opacity-disabled',
  ],
  {
    variants: {
      fill: {
        false: '',
        true: 'truncate',
      },
    },
    defaultVariants: { fill: false },
  },
);

const SegmentedFill = React.createContext(false);

export interface SegmentedProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ToggleGroup.Root>, 'type' | 'value' | 'defaultValue' | 'onValueChange'> {
  value: string;
  onValueChange: (value: string) => void;
  fill?: boolean;
}

/** The group. `value` is the chosen segment; `onValueChange` runs only for a different one. */
export const Segmented = React.forwardRef<React.ComponentRef<typeof ToggleGroup.Root>, SegmentedProps>(
  ({ className, fill = false, value, onValueChange, ...props }, ref) => (
    <SegmentedFill.Provider value={fill}>
      <ToggleGroup.Root
        ref={ref}
        type="single"
        data-slot="segmented"
        value={value}
        onValueChange={(next) => {
          if (next && next !== value) onValueChange(next);
        }}
        className={cn(segmentedVariants({ fill }), className)}
        {...props}
      />
    </SegmentedFill.Provider>
  ),
);
Segmented.displayName = 'Segmented';

/** One segment. A caller's `className` comes last and wins (`cn`). */
export const SegmentedItem = React.forwardRef<
  React.ComponentRef<typeof ToggleGroup.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroup.Item>
>(({ className, ...props }, ref) => {
  const fill = React.useContext(SegmentedFill);
  return <ToggleGroup.Item ref={ref} data-slot="segmented-item" className={cn(segmentVariants({ fill }), className)} {...props} />;
});
SegmentedItem.displayName = 'SegmentedItem';

/** The toggle form's row (see above). Name it with `aria-label`. */
export function SegmentedToggle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      data-slot="segmented-toggle"
      className={cn('inline-flex flex-none overflow-hidden rounded-xs inset-ring inset-ring-line max-md:w-full', className)}
      {...props}
    />
  );
}

export interface SegmentedToggleItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  /** This button is the chosen one. */
  pressed: boolean;
}

/** One button of the toggle form: `aria-pressed` from `pressed`. A caller's `className` comes last and wins (`cn`). */
export const SegmentedToggleItem = React.forwardRef<HTMLButtonElement, SegmentedToggleItemProps>(
  ({ className, pressed, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      data-slot="segmented-toggle-item"
      className={cn(
        'h-8.5 cursor-pointer whitespace-nowrap border-0 bg-transparent px-3 text-chip font-semibold text-muted hover:text-ink',
        'not-first:border-s not-first:border-s-line max-md:flex-1 max-md:px-1.5 max-touch:min-h-11',
        'aria-pressed:bg-surface-2 aria-pressed:text-ink aria-pressed:shadow-thread',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-disabled',
        className,
      )}
      {...props}
    />
  ),
);
SegmentedToggleItem.displayName = 'SegmentedToggleItem';
