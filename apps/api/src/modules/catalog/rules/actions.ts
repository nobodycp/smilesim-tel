// The line operations a package offers and a task carries (slice R.3: from the kernel's types). The catalog says
// which a package runs and how (`run-modes.ts`); tasks, providers and sales name them.

/** A line operation, as a task names it. */
/** `addon`: an extra operation named per package (spec 2026-11-09, 3), always a manual task. */
export type Action = 'activate' | 'charge' | 'extend' | 'reactivate' | 'disconnect' | 'freeze' | 'unfreeze' | 'switch' | 'rename' | 'sim' | 'esim' | 'refresh' | 'addon';
