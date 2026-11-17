'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/*
 * A panel that opens next to its button (Tailwind migration T2.6, ADR 0022), on Radix Popover: the trigger carries
 * `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`; the panel is a `role="dialog"` in a portal on
 * `<body>`, placed by Radix next to the trigger (or a `PopoverAnchor`), flipped to the other side when there is no
 * room and kept 8px inside the window; the focus moves into it on opening; a press outside or Escape closes it and
 * Escape gives the focus back to the trigger. It is not modal: the page keeps its pointer and its scroll.
 *
 * The look is the legacy calendar panel's (graphite.css `.date-pop`, gone since the date field moved here, T2.8):
 * 6px below its anchor and lined up with its reading start by default, 10px padding, 6px corners (`--rd-radius-sm`),
 * the surface fill, an inset 1px `--rd-line` under `--rd-shadow-pop`, three steps above the dialog layer
 * (`--rd-z-dialog-popover`, the dialog layer + 3) so it opens over a dialog that holds its button and under the toasts. Its width is the
 * caller's (the calendar is 280px). Handle: `data-slot="popover"`.
 */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      data-slot="popover"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        'z-dialog-popover rounded-sm bg-surface p-2.5 shadow-pop inset-ring inset-ring-line outline-none',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';
