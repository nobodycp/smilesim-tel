import * as React from 'react';
import { cn } from '../../lib/cn';

/*
 * An account's initial in a tile (Tailwind migration T2.7, ADR 0022), ported from the legacy shell.css `.avatar` rule
 * as the sidebar's account (`.side-user .avatar`) overrode it — the one avatar the app draws: a 36px tile that does
 * not shrink, the initial centred in it, 6px corners, the crimson fill (`--rd-accent-fill`) with `--rd-on-accent`
 * text, 14px bold. The base rule's 40px ink circle was drawn only inside the topbar's `.avatar-btn`, which no screen
 * renders any more. It is decoration: the caller names the account in text beside it.
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
