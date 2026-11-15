import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * The one class-joining helper (ADR 0022, Tailwind migration T1.2): `clsx` builds the list (strings, arrays,
 * `{ class: condition }`), `tailwind-merge` drops the earlier of two utilities that set the same thing, so a caller's
 * `className` wins over a component's default (`cn('px-3 text-ink', className)` with `px-4` gives `px-4 text-ink`).
 *
 * tailwind-merge only merges names it knows. The token names in app/tailwind.css `@theme` that its default scales do
 * not cover are listed here; keep this list in step with that block when a token is added or renamed:
 * - the t-shirt names it already reads: text sizes 2xs…2xl and base, radii 2xs…lg, shadow sm;
 * - colours are read as "any other value" after the sizes, so `text-ink-2` is a colour and `text-md` a size;
 * - `--spacing` is one step, so `p-2.5` is a number it already reads.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['card', 'tile', 'panel', 'pill'],
      shadow: ['card', 'frame', 'pop'],
      ease: ['standard'],
    },
    classGroups: {
      z: [{ z: ['raised', 'topbar', 'popover', 'overlay', 'drawer', 'shell-toast', 'dialog', 'top'] }],
      duration: [{ duration: ['fast', 'base'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
