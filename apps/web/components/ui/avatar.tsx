import * as React from 'react';
import { cn } from '../../lib/cn';

/*
 * An account's initial in a tile (ADR 0022), the one avatar the app draws (the sidebar's account): a 36px tile that
 * does not shrink, the initial centred in it, 6px corners, the crimson fill (`--rd-accent-fill`) with
 * `--rd-on-accent` text, 14px bold. It is decoration: the caller names the account in text beside it.
 */
export function Avatar({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="avatar"
      aria-hidden="true"
      className={cn(
        'grid size-9 flex-none place-items-center rounded-sm bg-accent-fill text-base font-bold text-on-accent',
        className,
      )}
      {...props}
    />
  );
}
