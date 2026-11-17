'use client';

import * as React from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';
import { choiceBoxClass, choiceMarkClass } from './checkbox';

/**
 * One choice out of a list, on Radix RadioGroup: the group is `role="radiogroup"`, each
 * item a `role="radio"` button with `aria-checked`; arrow keys move and choose (mirrored in RTL). The group sets no
 * layout of its own; the caller lays the items out. `data-slot="radio-group"` / `"radio"` are the handles.
 */
export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => <RadioGroupPrimitive.Root ref={ref} data-slot="radio-group" className={className} {...props} />);
RadioGroup.displayName = 'RadioGroup';

/**
 * A round box (the checkbox's look, see checkbox.tsx) with an 8px dot when chosen; `aria-invalid="true"` draws an
 * empty one's border in `--rd-danger`. A choice drawn as a card is `RadioCard`
 * (radio-card.tsx).
 */
export const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item ref={ref} data-slot="radio" className={cn(choiceBoxClass, 'rounded-pill', className)} {...props}>
    <RadioGroupPrimitive.Indicator forceMount className={cn(choiceMarkClass, 'size-2 rounded-pill')} />
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = 'RadioGroupItem';
