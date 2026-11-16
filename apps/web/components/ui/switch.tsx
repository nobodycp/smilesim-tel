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
 * Tailwind migration T6.2: disabled is the one disabled strength (`opacity-disabled`, the same 45%); `pending` is the
 * state of a switch whose change is being saved: `aria-busy="true"`, a progress pointer, and the track at the
 * disabled strength with its colour kept (the knob stays where it was pressed). It changes no behaviour: the caller
 * still decides whether a press is taken while it saves.
 */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
    /** The change is being saved: the busy look (see above). */
    pending?: boolean;
  }
>(({ className, pending = false, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    data-slot="switch"
    aria-busy={pending || undefined}
    className={cn(
      'group/switch grid h-8 w-9 place-items-center border-0 bg-transparent p-0 max-touch:size-11',
      'disabled:cursor-not-allowed disabled:opacity-disabled aria-busy:cursor-progress',
      'focus-visible:rounded-pill focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus',
      className,
    )}
    {...props}
  >
    <span
      className="relative h-5 w-9.5 rounded-xs bg-danger transition-[background-color,translate,opacity] duration-fast ease-[ease] group-data-[state=checked]/switch:bg-success group-aria-busy/switch:opacity-disabled"
    >
      <SwitchPrimitive.Thumb className="absolute start-0.75 top-0.75 size-3.5 rounded-[2px] bg-on-mark transition-[background-color,translate] duration-fast ease-[ease] data-[state=checked]:translate-x-4.5 rtl:data-[state=checked]:-translate-x-4.5" />
    </span>
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';
