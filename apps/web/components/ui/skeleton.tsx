import * as React from 'react';
import { cn } from '../../lib/cn';

/*
 * A loading placeholder bar (Tailwind migration T2.7, ADR 0022), ported from the legacy desk/components.css
 * `.skeleton` rules: a block with 6px corners on `--rd-surface-3`, clipped, with a band of the surface colour at 55%
 * sweeping across it every 1.6s (`@keyframes shimmer`). Tailwind migration T6.2 (audit 3.8-09): the band sweeps in
 * the reading direction (from the reading start: the band is mirrored in RTL, so its `translateX` runs right to left)
 * and only when motion is allowed (`motion-safe:`); under reduced motion the bar is still, the band out of sight.
 * The caller gives the size.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="skeleton"
      className={cn(
        'relative block overflow-hidden rounded-sm bg-surface-3',
        'after:absolute after:inset-0 after:[transform:translateX(-100%)] motion-safe:after:animate-[shimmer_1.6s_infinite]',
        'rtl:after:-scale-x-100',
        'after:bg-linear-to-r after:from-transparent after:via-surface/55 after:to-transparent',
        className,
      )}
      {...props}
    />
  );
}
