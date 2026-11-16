'use client';

import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/*
 * A strip of tabs (Tailwind migration T2.6, ADR 0022), on Radix Tabs: the strip is `role="tablist"`, each tab a
 * `role="tab"` button with `aria-selected` and `data-state="active|inactive"`. Radix moves the focus with the arrows
 * (mirrored in RTL through the app's DirectionProvider), Home and End (and PageUp/PageDown), wrapping, skipping
 * disabled tabs; a tab that takes the focus is selected (automatic activation); Tab enters the strip at the selected
 * tab and leaves it at once. `Tabs` (the Root) is drawn onto the strip itself (`asChild` on `TabsList`), so the strip
 * keeps its place in its parent as the legacy `.steps` element did. `components/tabs.tsx` composes these parts into
 * the one strip the screens use.
 *
 * The look is the legacy strip's (desk/pane.css `.steps*`, `.step-count` and graphite.css over them, then the touch
 * rules of responsive.css and graphite.css's phone block), in their cascade order:
 * - the strip: an inline row that does not grow or shrink, at the start of its column, no gap, padding or border,
 *   6px corners (`--rd-radius-sm`), no fill, an inset 1px ink line at 11%, at most as wide as its parent, scrolling
 *   sideways with no scrollbar. Under 641px every tab is in view: a grid of equal cells, three a row (two a row for
 *   two or four tabs, one for a lone tab), as wide as the column, with no sideways scroll. A strip that is a direct
 *   child of `.desk` (the Desk frame's column) stays at the start there, as the legacy `.desk > .steps` rule kept it.
 *   Its outer margins and a fixed height come from the parent's legacy rules (`[data-slot='tabs']`, graphite.css),
 *   so the strip sets neither;
 * - a tab: 36px high, 16px sides, square, no border or fill, `--rd-muted` 13px semibold on one line, 6px between its
 *   label and its count; each after the first draws a 1px ink line at 11% on its start edge; under the pointer (when
 *   enabled) ink on `--rd-surface-2`; the selected one ink bold on `--rd-surface-2` with the 2px crimson thread
 *   underneath; a disabled one dimmed (see below); at least 44px high at 720px and under, centred on as many lines
 *   as it needs, with 8px sides, under 641px;
 * - the count: an 18px-high crimson figure at least 18px wide, 5px sides, 4px corners, 11px bold tabular digits.
 * Tailwind migration T6.2: keyboard focus is the 2px `--rd-accent` outline drawn inside the tab (the focus mark of an
 * item in a strip or a list; the strip's scroll box never cuts it); a disabled tab is at the one disabled strength
 * (it was 40%) with a not-allowed pointer; a phone keeps the 44px touch height (it was 40px under 641px).
 * Handles: `data-slot="tabs"` on the strip, `data-slot="tab"` on a tab.
 */

export const Tabs = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Root>,
  Omit<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>, 'asChild'>
>((props, ref) => <TabsPrimitive.Root ref={ref} asChild {...props} />);
Tabs.displayName = 'Tabs';

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-slot="tabs"
    className={cn(
      'inline-flex max-w-full flex-none gap-0 self-start overflow-x-auto rounded-sm border-0 bg-transparent p-0',
      '[scrollbar-width:none] inset-ring inset-ring-ink/11',
      'max-sm:grid max-sm:max-w-none max-sm:grid-cols-3 max-sm:overflow-x-visible max-sm:not-[.desk>*]:self-stretch',
      'max-sm:has-[>:nth-child(2):last-child]:grid-cols-2 max-sm:has-[>:nth-child(4):last-child]:grid-cols-2',
      'max-sm:has-[>:only-child]:grid-cols-1',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    data-slot="tab"
    className={cn(
      'inline-flex h-9 flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-none border-0 bg-transparent px-4',
      'text-md font-semibold text-muted not-first:border-s not-first:border-s-ink/11',
      'not-disabled:hover:bg-surface-2 not-disabled:hover:text-ink',
      'aria-selected:bg-surface-2 aria-selected:font-bold aria-selected:text-ink aria-selected:shadow-thread',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
      'disabled:cursor-not-allowed disabled:opacity-disabled',
      'max-touch:min-h-11',
      'max-sm:justify-center max-sm:whitespace-normal max-sm:px-2 max-sm:text-center',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

/** The figure after a tab's label (an unread count, the length of a log). */
export function TabsCount({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-grid h-4.5 min-w-4.5 place-items-center rounded-xs bg-transparent px-1.25 text-xs font-bold text-accent tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
