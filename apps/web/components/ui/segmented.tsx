'use client';

import * as React from 'react';
import { ToggleGroup } from 'radix-ui';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * A segmented control: one choice out of a few, side by side (Tailwind migration T2.3, ADR 0022), on Radix
 * ToggleGroup `type="single"`: the group is `role="radiogroup"`, each segment a `role="radio"` button with
 * `aria-checked` and `data-state="on|off"`; arrow keys move between segments (mirrored in RTL), Tab enters at the
 * chosen one. Picking the chosen segment again keeps it (the group never goes empty). Ported from the legacy `.seg`
 * rules of desk/pane.css and graphite.css in their cascade order:
 * - the group: no padding, gap or border, 6px corners, no fill, an inset 1px ink line at 11%, clipped to its corners;
 *   `fill` makes it a full-width grid of equal segments (the legacy `.mode-card .seg` / `.role-seg`);
 * - a segment: 32px high, 10px sides, square, no border or fill, `--rd-muted` 12px bold; each after the first draws a
 *   1px ink line at 11% on its start edge; the chosen one sits on `--rd-surface-2` in ink with the 2px crimson thread
 *   underneath; at least 44px high at 720px and under (the touch rule of responsive.css). With `fill` a long label
 *   stays on one line and ends in an ellipsis.
 * Not carried, because no legacy rule outside a dialog reaches a segment with it: a disabled look and a focus mark
 * (the browser's own focus ring stays).
 */
const segmentedVariants = cva('gap-0 overflow-hidden rounded-sm border-0 bg-transparent p-0 inset-ring inset-ring-ink/11', {
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
    'h-8 rounded-none border-0 bg-transparent px-2.5 py-0 text-sm font-bold text-muted max-[721px]:min-h-11',
    'not-first:border-s not-first:border-s-ink/11',
    'data-[state=on]:bg-surface-2 data-[state=on]:text-ink data-[state=on]:shadow-[inset_0_-2px_0_var(--rd-accent)]',
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
