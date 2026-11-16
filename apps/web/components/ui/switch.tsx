'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/*
 * An on/off switch saved on change (Tailwind migration T2.3, ADR 0022), on Radix Switch: a `role="switch"` button
 * with `aria-checked`, `data-state="checked|unchecked"` on the button and its knob. Ported from the legacy
 * `.live-switch` rules of desk/components.css and graphite.css in their cascade order:
 * - the button is the hit box: 36 × 32, no fill or border, the track centred in it; 44 × 44 at 720px and under (a
 *   finger needs 44px; the track stays small); at 45% with a not-allowed pointer when disabled; on keyboard focus no
 *   outline but the 3px `--rd-focus` ring on a pill;
 * - the track is 38 × 20 with 4px corners (graphite's square track): red (`--rd-danger`) when off, green
 *   (`--rd-success`) when on, everywhere (owner, 2026-11-08);
 * - the knob is 14px with 2px corners in `--rd-on-mark`, 3px in from the start edge, and slides 18px to the end
 *   when on (a negative shift in RTL);
 * - colour and slide ease over `--rd-dur-fast`.
 * A Radix Switch inside a `<form>` also renders a hidden checkbox after the button so form events see the change.
 */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    data-slot="switch"
    className={cn(
      'group/switch grid h-8 w-9 place-items-center border-0 bg-transparent p-0 max-[721px]:size-11',
      'disabled:cursor-not-allowed disabled:opacity-45',
      'focus-visible:rounded-pill focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus',
      className,
    )}
    {...props}
  >
    <span
      className="relative h-5 w-9.5 rounded-xs bg-danger transition-[background-color,translate] duration-fast ease-[ease] group-data-[state=checked]/switch:bg-success"
    >
      <SwitchPrimitive.Thumb className="absolute start-0.75 top-0.75 size-3.5 rounded-[2px] bg-on-mark transition-[background-color,translate] duration-fast ease-[ease] data-[state=checked]:translate-x-4.5 rtl:data-[state=checked]:-translate-x-4.5" />
    </span>
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';
