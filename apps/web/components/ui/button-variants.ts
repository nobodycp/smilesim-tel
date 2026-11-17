import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * The look of a Button (ADR 0022). A plain module (no React), so a Playwright spec can read the classes too.
 *
 * Every variant but `link` is a box: 6px corners (ADR 0021 D19), weight 600, no browser border, a colour-only
 * transition (not the outline colour, so the focus outline does not fade in), the crimson focus ring
 * (2px of page colour, then 2px of `--rd-accent`), the one disabled strength (`opacity-disabled`, 45%) and no
 * pointer when disabled, a 0.97 press, and at least 44px high at 720px and under (the touch rule, also for a link
 * drawn as a button through `asChild`); the busy state (`aria-busy`, set by `loading`: the spinner before the label,
 * the button disabled) and the pressed state (`aria-pressed="true"`: the variant's hover look held, ADR 0021 D13 — a
 * pressed button never changes variant).
 * - primary: the crimson fill (`--rd-accent-fill`, hover `--rd-accent-fill-hover`, white text), no shadow; every
 *   primary is crimson (ADR 0021 D2);
 * - secondary: the soft track (`--rd-surface-2`, an inset 1px ink line at 11%, hover `--rd-surface-3`); the line
 *   gives way to the ring on focus;
 * - ghost: no fill, `--rd-ink-2`, hover `--rd-surface-3` and ink;
 * - danger: the danger outline (border at 45%, text in `--rd-danger`, hover `--rd-danger-soft`), never a red fill;
 * - link: a button that reads as text: no box, the text's own colour and font, underline
 *   on hover. It takes no size.
 * Sizes: sm 32px, md 34px (the pane control height, the default), lg 40px (the sign-in-sized screens).
 */
const box = [
  'inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm',
  'border-0 border-solid border-transparent font-semibold',
  'transition-[color,background-color,border-color,text-decoration-color,fill,stroke] duration-fast ease-standard',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
  'disabled:pointer-events-none disabled:opacity-disabled not-disabled:active:scale-97 max-touch:min-h-11',
];

export const buttonVariants = cva('', {
  variants: {
    variant: {
      primary: [
        box,
        'bg-accent-fill text-on-accent shadow-none not-disabled:hover:bg-accent-fill-hover aria-pressed:bg-accent-fill-hover',
      ],
      secondary: [
        box,
        'border border-transparent bg-surface-2 text-ink inset-ring inset-ring-line-strong hover:bg-surface-3 aria-pressed:bg-surface-3',
        'focus-visible:inset-ring-0',
      ],
      ghost: [box, 'bg-transparent text-ink-2 hover:bg-surface-3 hover:text-ink aria-pressed:bg-surface-3 aria-pressed:text-ink'],
      danger: [box, 'border border-danger/45 bg-transparent text-danger hover:bg-danger-soft aria-pressed:bg-danger-soft'],
      link: [
        'cursor-pointer border-0 bg-transparent p-0 text-start text-inherit hover:underline',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
        'disabled:pointer-events-none disabled:opacity-disabled',
      ],
    },
    size: {
      sm: 'h-8 gap-1.5 px-3 text-md',
      md: 'h-8.5 gap-2 px-4 text-base leading-5',
      lg: 'h-10 gap-2 px-5 text-base leading-5',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

type Variants = VariantProps<typeof buttonVariants>;
export type ButtonVariant = NonNullable<Variants['variant']>;
export type ButtonSize = NonNullable<Variants['size']>;

/**
 * The classes of a Button, for an element that must look like one and cannot take `<Button asChild>` (a trigger that
 * only accepts a class name). A caller's `className` comes last and wins (`cn`).
 */
export function buttonClass({ variant = 'primary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(buttonVariants({ variant, size: variant === 'link' ? null : size }), className);
}
