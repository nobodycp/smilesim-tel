'use client';

import * as React from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

/*
 * One choice out of a few, each drawn as a card (Tailwind migration T6.2, ADR 0022), on Radix RadioGroup: the group
 * is `role="radiogroup"` (named by `aria-label` or `aria-labelledby`), each card a `role="radio"` button with
 * `aria-checked` and `data-state="checked|unchecked"`; Tab enters the group at the chosen card (or the first) and
 * leaves it, the arrow keys move between the cards and choose (mirrored in RTL through the app's DirectionProvider),
 * skipping a disabled one (audit 3.6-10, 3.10-31). The group sets no layout of its own: the caller lays the cards out
 * (a grid of them). Inside a `<form>` Radix adds a hidden radio input per card, so `name` and `required` reach it.
 *
 * The look is the hand-built pick cards' (features/catalog/add-steps.ts `pickCardClass` until T6.3, the two-step method cards
 * of features/auth/sign-in-methods.tsx; both draw this since T6.3), with the system's states:
 * - a card: a grid of rows 4px apart at the start, 12px by 14px inside, a 1px `--rd-line` border with 6px corners on
 *   `--rd-surface-2`, ink text; under the pointer (usable, not chosen) the border is `--rd-accent` at 45%;
 * - chosen: an `--rd-accent` border on `--rd-accent-soft`, and the 16px crimson tick 10px in from the top inline-end
 *   corner (`RadioCard` draws it; the caller keeps that corner clear);
 * - keyboard focus: the 2px `--rd-accent` outline 2px outside (the focus mark of a choice: checkbox, radio, card);
 * - disabled: the one disabled strength with a not-allowed pointer;
 * - `aria-invalid="true"` on the group (nothing chosen when it must be): every unchosen card's border in
 *   `--rd-danger`.
 * Handles: `data-slot="radio-cards"` on the group, `data-slot="radio-card"` on a card.
 */

export const RadioCardGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} data-slot="radio-cards" className={cn('group/radio-cards', className)} {...props} />
));
RadioCardGroup.displayName = 'RadioCardGroup';

/** One card. Its children are the card's rows (a name, a hint line, a badge). */
export const RadioCard = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    data-slot="radio-card"
    className={cn(
      'relative grid cursor-pointer content-start justify-items-start gap-1 rounded-sm border border-solid border-line',
      'bg-surface-2 px-3.5 py-3 text-start text-ink transition-[background-color,border-color] duration-fast ease-standard',
      'not-disabled:data-[state=unchecked]:hover:border-accent/45',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft',
      'group-aria-invalid/radio-cards:data-[state=unchecked]:border-danger',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      'disabled:cursor-not-allowed disabled:opacity-disabled max-touch:min-h-11',
      className,
    )}
    {...props}
  >
    {children}
    <RadioGroupPrimitive.Indicator className="absolute end-2.5 top-2.5 text-accent">
      <Check size={16} aria-hidden="true" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioCard.displayName = 'RadioCard';
