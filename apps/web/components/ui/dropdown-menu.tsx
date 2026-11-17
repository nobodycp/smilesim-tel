'use client';

import * as React from 'react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * A menu of actions next to its button (ADR 0022), on Radix DropdownMenu: the trigger is
 * `aria-haspopup="menu"` with `aria-expanded`; the panel is a `role="menu"` of `role="menuitem"`s in a portal, placed
 * by Radix next to the trigger (flipped and kept 8px inside the window); ArrowUp/ArrowDown (wrapping), Home and End
 * move between items, Escape closes and gives the focus back to the trigger. It is not modal: a press outside closes
 * it and still reaches what was pressed, and the page keeps its scroll.
 *
 * The look:
 * - the panel: at least 13rem and as wide as its longest line (never wider than the window less 16px), 6px padding,
 *   2px between lines, a 1px `--rd-line` border, 8px corners (`--rd-radius-card`), the surface fill,
 *   `--rd-shadow-pop`, 14px type at line height 1.25, above every layer (`--rd-z-top`);
 * - an item: a 38px line (44px at 720px and under), 10px between its icon and its label, 4px above and below, 4px on
 *   the left and 8px on the right whatever the direction, 6px corners, no fill,
 *   ink 14px semibold on one line; its icon (an svg child) is a 15px glyph on a 27px `--rd-surface-2` tile with 4px
 *   corners in `--rd-ink-2`; under the pointer or on keyboard focus the line fills with `--rd-surface-2` and the tile
 *   turns `--rd-surface` and ink. `danger`: danger red, its tile `--rd-danger-soft`, the line `--rd-danger-soft` under
 *   the pointer or focus;
 * - the separator: a 1px `--rd-line-soft` rule, 4px above and below, 6px in from each side.
 * A disabled item (Radix `disabled`: skipped by the keyboard, `data-disabled` and `aria-disabled` on the line) is at
 * the one disabled strength with a not-allowed pointer and no hover fill.
 */

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof MenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 8, loop = true, ...props }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      ref={ref}
      data-slot="dropdown-menu"
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      loop={loop}
      className={cn(
        'z-top flex w-max min-w-52 max-w-[calc(100vw-16px)] flex-col items-stretch gap-0.5 p-1.5',
        'rounded-card border border-solid border-line bg-surface text-base leading-tight shadow-pop',
        className,
      )}
      {...props}
    />
  </MenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

const itemVariants = cva(
  [
    'flex min-h-9.5 w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-sm border-0 bg-transparent',
    'py-1 ps-1 pe-2 rtl:ps-2 rtl:pe-1 text-start text-base font-semibold leading-tight max-touch:min-h-11',
    'data-disabled:cursor-not-allowed data-disabled:bg-transparent data-disabled:opacity-disabled',
    '[&>svg]:box-content [&>svg]:size-3.75 [&>svg]:flex-none [&>svg]:rounded-xs [&>svg]:p-1.5',
  ],
  {
    variants: {
      danger: {
        false: [
          'text-ink [&>svg]:bg-surface-2 [&>svg]:text-ink-2',
          'hover:bg-surface-2 hover:[&>svg]:bg-surface hover:[&>svg]:text-ink',
          'focus-visible:bg-surface-2 focus-visible:[&>svg]:bg-surface focus-visible:[&>svg]:text-ink',
        ],
        true: 'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft [&>svg]:bg-danger-soft [&>svg]:text-danger',
      },
    },
    defaultVariants: { danger: false },
  },
);

export interface DropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item>,
    VariantProps<typeof itemVariants> {}

/** One action. It is a `<button>` (Radix `asChild`). */
export const DropdownMenuItem = React.forwardRef<React.ComponentRef<typeof MenuPrimitive.Item>, DropdownMenuItemProps>(
  ({ className, danger, children, ...props }, ref) => (
    <MenuPrimitive.Item ref={ref} asChild {...props}>
      <button type="button" data-slot="dropdown-menu-item" className={cn(itemVariants({ danger }), className)}>
        {children}
      </button>
    </MenuPrimitive.Item>
  ),
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof MenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenuPrimitive.Separator ref={ref} className={cn('mx-1.5 my-1 block h-px bg-line-soft', className)} {...props} />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';
