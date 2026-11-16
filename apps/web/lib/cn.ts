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
 * Tailwind migration T6.2 added the named text sizes (`text-caption` … `text-figure-lead`: without them a size would
 * read as a colour and drop the text colour beside it), the line heights and letter spacing, the line shadows, the
 * disabled opacity and the layers over the dialog.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['card', 'tile', 'panel', 'pill'],
      shadow: ['card', 'frame', 'pop', 'thread', 'glow', 'glow-accent'],
      ease: ['standard'],
      text: ['caption', 'chip', 'block', 'item', 'page', 'figure-sm', 'figure', 'figure-lead-sm', 'figure-lead'],
      leading: ['1-1', '1-15', '1-2', '1-3', '1-35', '1-4', '1-45', '1-55', '1-6'],
      tracking: ['title', 'figure', 'head', 'number', 'code', 'caps'],
    },
    classGroups: {
      z: [
        {
          z: [
            'raised', 'topbar', 'sidebar', 'popover', 'overlay', 'drawer', 'shell-toast', 'dialog', 'dialog-drawer',
            'dialog-list', 'dialog-popover', 'top',
          ],
        },
      ],
      duration: [{ duration: ['fast', 'base'] }],
      opacity: [{ opacity: ['disabled'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
