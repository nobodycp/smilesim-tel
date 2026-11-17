'use client';

import * as React from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/*
 * The box a choice is ticked in, and the round dot of one-of-many (ADR 0022; spec 2026-11-11-ui-consistency-pass,
 * D5): an 18px box on `--rd-surface` with a 1.5px border of `--rd-field` (3:1 on the surface in both themes, audit
 * 3.10-08; the base `input[type=checkbox]` rule in app/tailwind.css matches) and 4px corners; when on, the box fills
 * with `--rd-accent-fill` (border too) and its light mark (`--rd-on-accent`) grows in; under the pointer, an empty
 * box that is not disabled takes the `--rd-accent` border; on keyboard focus a 2px `--rd-accent` outline 2px out;
 * when disabled, the one disabled strength (`opacity-disabled`, 45%) with a not-allowed pointer. Fill, border and mark
 * ease over `--rd-dur-fast`. `aria-invalid="true"` draws the border in `--rd-danger` while the box is empty;
 * a checkbox can be `checked="indeterminate"` (some of a group): the fill with a short light bar instead of the tick.
 * Shared with radio-group.tsx.
 */
export const choiceBoxClass = cn(
  'inline-grid size-4.5 max-h-4.5 min-h-4.5 max-w-4.5 min-w-4.5 flex-none cursor-pointer place-content-center self-center align-middle',
  'm-0 border-[1.5px] border-solid border-field bg-surface p-0',
  'transition-[background-color,border-color] duration-fast ease-standard',
  'data-[state=checked]:border-accent-fill data-[state=checked]:bg-accent-fill',
  'data-[state=indeterminate]:border-accent-fill data-[state=indeterminate]:bg-accent-fill',
  'aria-invalid:data-[state=unchecked]:border-danger',
  'not-disabled:data-[state=unchecked]:hover:border-accent',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  'disabled:cursor-not-allowed disabled:opacity-disabled',
);

/** The mark inside the box: it is always there, scaled to nothing while unticked, so it grows in. */
export const choiceMarkClass =
  'bg-on-accent scale-0 transition-transform duration-fast ease-standard data-[state=checked]:scale-100 data-[state=indeterminate]:scale-100';

/**
 * A checkbox on Radix Checkbox: a `role="checkbox"` button with `aria-checked` (`"mixed"` when indeterminate) and
 * `data-state="checked|unchecked|indeterminate"`. It takes its name from a wrapping `<label>`, `aria-label` or
 * `aria-labelledby`. `data-slot="checkbox"` is its handle.
 */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root ref={ref} data-slot="checkbox" className={cn(choiceBoxClass, 'rounded-xs', className)} {...props}>
    <CheckboxPrimitive.Indicator
      forceMount
      className={cn(
        choiceMarkClass,
        'size-2.5 [clip-path:polygon(14%_44%,0_65%,50%_100%,100%_16%,80%_0%,43%_62%)]',
        'data-[state=indeterminate]:h-0.5 data-[state=indeterminate]:rounded-pill data-[state=indeterminate]:[clip-path:none]',
      )}
    />
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';
