'use client';

import { useBranding } from '../lib/branding';
import { cn } from '../lib/cn';
import { DataImage } from './data-image';

/**
 * The saved logo as its two copies; the theme shows one: the
 * light copy by default and the dark one under `.dark`, each a block no wider than its box, contained. `onInk` is for
 * an ink panel (the sign-in art), where the copies swap the other way. `className` sizes both copies. Renders nothing
 * when no logo is saved.
 */
export function BrandLogo({ className, onInk }: { className?: string; onInk?: boolean }) {
  const { logo, logoDark, name } = useBranding();
  if (!logo) return null;
  const shown = onInk ? 'hidden dark:block' : 'block dark:hidden';
  const swapped = onInk ? 'block dark:hidden' : 'hidden dark:block';
  const light = <DataImage src={logo} alt={name} className={cn('max-w-full object-contain', shown, className)} />;
  const dark = <DataImage src={logoDark || logo} alt="" className={cn('max-w-full object-contain', swapped, className)} />;
  if (!onInk) {
    return (
      <>
        {light}
        {dark}
      </>
    );
  }
  return (
    <span>
      {light}
      {dark}
    </span>
  );
}
