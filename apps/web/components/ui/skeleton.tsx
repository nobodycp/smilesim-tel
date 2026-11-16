import * as React from 'react';
import { cn } from '../../lib/cn';

/*
 * A loading placeholder bar (Tailwind migration T2.7, ADR 0022), ported from the legacy desk/components.css
 * `.skeleton` rules: a block with 6px corners on `--rd-surface-3`, clipped, with a band of the surface colour at 55%
 * sweeping across it from left to right (in both directions, as before) every 1.6s (`@keyframes shimmer`, desk/components.css).
 * The legacy rule ran the sweep whatever the motion preference (desk/components.css sets it outside the
 * reduced-motion guard of base.css); that is ported as it is (T6). The caller gives the size.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="skeleton"
      className={cn(
        'relative block overflow-hidden rounded-sm bg-surface-3',
        'after:absolute after:inset-0 after:[transform:translateX(-100%)] after:animate-[shimmer_1.6s_infinite]',
        'after:bg-linear-to-r after:from-transparent after:via-surface/55 after:to-transparent',
        className,
      )}
      {...props}
    />
  );
}
