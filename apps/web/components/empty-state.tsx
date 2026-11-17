import type { ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { Icon, type IconName } from './icon';

/*
 * The empty state (ADR 0022): a grid centred on both axes, its items centred, 6px apart, at least as tall as its parent (not inside a
 * table's sheet, `[data-slot=table-sheet]`, where it takes its own height), 14px padding, centred 13px
 * `--rd-muted` text; the mark a 32px round tile on `--rd-surface-2` with a 16px `--rd-muted` glyph; the title 0.92rem
 * bold ink; the line under it 13px `--rd-muted`; `actions` one wrapping row, centred, 8px apart, 6px below.
 * `tone="danger"` (a load or a page that failed) draws the mark on `--rd-danger-soft` in `--rd-danger` and sets every
 * button inside 6px lower, centred in its column.
 */
const emptyStateVariants = cva(
  'm-0 grid min-h-full content-center justify-items-center gap-1.5 p-3.5 text-center text-md text-muted [[data-slot=table-sheet]>&]:min-h-auto',
  {
    variants: {
      tone: {
        default: '',
        danger: '[&_[data-slot=button]]:mt-1.5 [&_[data-slot=button]]:justify-self-center',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

const markVariants = cva('grid size-8 place-items-center rounded-pill [&_svg]:size-4', {
  variants: {
    tone: {
      default: 'bg-surface-2 text-muted',
      danger: 'bg-danger-soft text-danger',
    },
  },
  defaultVariants: { tone: 'default' },
});

export type EmptyStateProps = {
  /** The title line. */
  children: ReactNode;
  /** The line under the title. */
  text?: ReactNode;
  icon?: IconName;
  tone?: 'default' | 'danger';
  /** The ways out (the error and not-found screens), one centred row under the text. */
  actions?: ReactNode;
  role?: 'status' | 'alert';
  /** The root's test handle; `null` draws none. */
  testId?: string | null;
  /** A test handle on the line under the title. */
  textTestId?: string;
  /** Children of the grid after the text (the load failure's retry). */
  footer?: ReactNode;
  className?: string;
};

export function EmptyState({
  children,
  text,
  icon = 'tasks',
  tone = 'default',
  actions,
  role,
  testId = 'empty-state',
  textTestId,
  footer,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(emptyStateVariants({ tone }), className)} data-testid={testId ?? undefined} role={role}>
      <span className={markVariants({ tone })} aria-hidden="true">
        <Icon name={icon} />
      </span>
      <p className="m-0 text-item font-bold text-ink">{children}</p>
      {text ? <p className="m-0 text-md text-muted" data-testid={textTestId}>{text}</p> : null}
      {footer}
      {actions ? <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
