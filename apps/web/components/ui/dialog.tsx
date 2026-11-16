'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * A dialog over the page (Tailwind migration T2.5, ADR 0022), on Radix Dialog: the panel is `role="dialog"` named by
 * its title (`aria-labelledby`) and described by its lede when it has one (`aria-describedby`); it lives in a portal
 * on `<body>`; Tab and Shift+Tab wrap inside it (Radix FocusScope `loop`); Radix keeps the layers in order, so an
 * open list or menu inside it takes Escape and outside presses first. `components/dialog.tsx` composes these parts
 * into the one dialog the screens use.
 *
 * The look is the legacy dialog's (dialog.css `.dialog-scrim`, `.dialog*`, and graphite.css "Dialog: the crimson
 * thread on top", its motion line and `.dialog-mark`), in their cascade order:
 * - the scrim: fixed over the whole window above every layer but the toasts (`--rd-z-dialog`), `--rd-scrim` with an
 *   8px backdrop blur, the panel centred in it with 16px around;
 * - the panel: a column, min(560px, 100%) wide (confirm 460px, wide 760px), at most min(720px, window less 48px)
 *   tall (the dynamic viewport height, so a phone's browser bars never hide its foot: Tailwind migration T6.2,
 *   audit 3.2-10), clipped, no border (graphite's `border: 0` over dialog.css's line), 6px corners (`--rd-radius-sm`), the
 *   surface fill, an inset 1px ink line at 11% under `--rd-shadow-pop`, and a 2px `--rd-accent` thread across its
 *   top (graphite `::before`); it drops in over 200ms (`rd-drop`, graphite.css) when motion is allowed;
 * - the head: a row, 12px between its parts, 16px on top and the sides and 14px below, a 1px `--rd-line` rule under
 *   it; the title is 16px bold at the reading start with no margin; the lede under it is 13px medium `--rd-muted`
 *   at line height 1.45, 4px below the title;
 * - the mark: a 40px tile with 6px corners and the tag's cut corner at the reading end (8px), `--rd-accent-soft`
 *   behind an `--rd-accent` 18px glyph (danger and success take their soft fill and colour); `lg` is the activation
 *   result's 56px tile with a 28px glyph;
 * - the body: takes the room left and scrolls, 16px padding;
 * - the foot: a wrapping row of buttons at the reading end, 8px apart, 12px above and below and 16px at the sides,
 *   a 1px `--rd-line` rule above it, on `--rd-surface-2`.
 * Handles: `data-slot="dialog-scrim"`, `"dialog"` (with `data-size`), `"dialog-mark"`, `"dialog-body"`. The legacy
 * rules for the content of dialogs not yet ported (their fields, labels and touch heights) read the two last until
 * their screens move (T4) and the sheets go (T5).
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const panelVariants = cva(
  [
    'relative flex max-h-[min(720px,calc(100dvh_-_48px))] flex-col overflow-hidden p-0',
    'rounded-sm border-0 bg-surface shadow-pop inset-ring inset-ring-ink/11',
    "before:block before:h-0.5 before:flex-none before:bg-accent before:content-['']",
    'motion-safe:animate-[rd-drop_200ms_var(--rd-ease-out)]',
  ],
  {
    variants: {
      size: {
        confirm: 'w-[min(460px,100%)]',
        form: 'w-[min(560px,100%)]',
        wide: 'w-[min(760px,100%)]',
      },
    },
    defaultVariants: { size: 'form' },
  },
);

export type DialogSize = NonNullable<VariantProps<typeof panelVariants>['size']>;

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof panelVariants> {
  /** A click on the scrim (outside the panel). */
  onScrimClick?: () => void;
}

/**
 * The scrim and the panel, in a portal. A click inside the panel stops there: it neither reaches the scrim nor a
 * React ancestor of the dialog (a clickable row or card that opened it), as the legacy panel did.
 */
export const DialogContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, size, onScrimClick, onClick, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <div
        data-slot="dialog-scrim"
        className="fixed inset-0 z-dialog grid place-items-center bg-scrim p-4 backdrop-blur-sm"
        onClick={onScrimClick}
      >
        <DialogPrimitive.Content
          ref={ref}
          data-slot="dialog"
          data-size={size ?? 'form'}
          className={cn(panelVariants({ size }), className)}
          onClick={(event) => {
            onClick?.(event);
            event.stopPropagation();
          }}
          {...props}
        />
      </div>
    </DialogPrimitive.Portal>
  ),
);
DialogContent.displayName = 'DialogContent';

/** The head: the mark, the title and lede, the close button, in a row. */
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <header className={cn('m-0 flex flex-none items-start gap-3 border-b border-line px-4 pt-4 pb-3.5', className)} {...props} />;
}

/** The title and the lede, taking the room the mark and the close button leave. */
export function DialogHeading({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 flex-1', className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('m-0 text-start text-xl font-bold', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('mt-1 mb-0 text-md font-medium leading-[1.45] text-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

const markVariants = cva(
  [
    'inline-flex flex-none items-center justify-center rounded-sm',
    '[clip-path:polygon(0_0,calc(100%_-_8px)_0,100%_8px,100%_100%,0_100%)]',
    'rtl:[clip-path:polygon(8px_0,100%_0,100%_100%,0_100%,0_8px)]',
  ],
  {
    variants: {
      tone: {
        neutral: 'bg-accent-soft text-accent',
        danger: 'bg-danger-soft text-danger',
        success: 'bg-success-soft text-success',
      },
      size: {
        md: 'size-10 [&>svg]:size-4.5',
        lg: 'size-14 [&>svg]:size-7',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export type DialogMarkTone = NonNullable<VariantProps<typeof markVariants>['tone']>;
export type DialogMarkSize = NonNullable<VariantProps<typeof markVariants>['size']>;

/** The tile beside the title that holds the dialog's glyph (an svg child). */
export function DialogMark({
  className,
  tone,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof markVariants>) {
  return <span data-slot="dialog-mark" className={cn(markVariants({ tone, size }), className)} {...props} />;
}

/** The content: takes the room the head and the foot leave, and scrolls. */
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-body" className={cn('min-h-0 flex-auto overflow-auto p-4', className)} {...props} />;
}

/** The buttons, at the reading end. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <footer
      className={cn('flex flex-none flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-4 py-3', className)}
      {...props}
    />
  );
}
