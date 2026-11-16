'use client';

import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/*
 * A short name shown beside a control while the pointer rests on it or the keyboard focus is on it (Tailwind
 * migration T2.6, ADR 0022), on Radix Tooltip: the content is a `role="tooltip"` the trigger is described by, in a
 * portal on `<body>`, placed by Radix beside the trigger and flipped when there is no room; Escape or a press closes
 * it. It opens at once (no delay), as the legacy flyout did; `TooltipProvider` lets a group of tooltips share one
 * delay, and `Tooltip` brings its own when none is above it.
 *
 * The look is the legacy rail flyout's (shell.css `.side-flyout`, graphite.css's width, base.css's motion), the one
 * tooltip the app draws: 10px from its trigger, 7px above and below and 12px at the sides, 6px corners
 * (`--rd-radius-sm`), `--rd-surface-2` behind ink 12.5px semibold on one line, as wide as its words up to 280px, an
 * inset 1px `--rd-line` under `--rd-shadow-pop`, on the dialog layer (`--rd-z-dialog`), letting the pointer through;
 * it drifts in sideways over 160ms (`side-flyin`, mirrored in RTL) when motion is allowed. Radix's side is physical
 * (`left` / `right`); a caller beside the rail picks the side by the reading direction. Handle:
 * `data-slot="tooltip"`.
 */

export function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root {...props} />
    </TooltipProvider>
  );
}

export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 10, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      data-slot="tooltip"
      sideOffset={sideOffset}
      className={cn(
        'pointer-events-none z-dialog w-max max-w-[280px] whitespace-nowrap rounded-sm bg-surface-2 px-3 py-1.75',
        'text-[12.5px] font-semibold text-ink shadow-pop inset-ring inset-ring-line',
        'motion-safe:animate-[side-flyin_160ms_cubic-bezier(0.32,0.72,0,1)] motion-safe:rtl:[animation-name:side-flyin-rtl]',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';
