'use client';

import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/*
 * A dropdown: one value out of a fixed short list (ADR 0022), on Radix Select. The trigger is
 * a `role="combobox"` button named by its label; the list is a `role="listbox"` of `role="option"`s in a portal, with
 * the keyboard (arrows, Home/End, type-ahead, Enter, Escape) and `dir` from Radix. Inside a `<form>` Radix adds a
 * hidden native select, so `name`, `required` and autofill (`autoComplete`) still reach the form.
 *
 * Radix forbids an empty item value; the app's «الكل» / «—» choices are `''`. `SelectItem value=""` and
 * `value=""` on the root map to one private value inside, so callers keep `''`.
 *
 * The trigger: every place keeps the chevron (16px, `--rd-muted`: an icon on a control needs 3:1, audit 3.10-05) 12px
 * from the inline end, the box-shadow transition and, when disabled, a not-allowed cursor at the one disabled
 * strength (`opacity-disabled`) over the `--rd-surface-2` fill. `place` names where it sits:
 * - field: a field outside the desk (the sign-in screens): 36px, 6px corners, a 1px border at 70% of `--rd-field`,
 *   the sunken fill, 12px at the start and 36px at the end (the chevron's room), 14px type, `--rd-shadow-sm`;
 * - desk / dialog: the same at 34px (a field on the desk outside a pane, a field in a dialog);
 * - pane: a field inside a `.pane`: 34px, the full `--rd-field` border, the surface fill, 8px at the start, 13px type;
 * - pager: the pane look at 28px, the pager's page-size field;
 * and every place is 44px at 720px and under. Focus: an `--rd-accent` border and the 3px `--rd-focus` ring in place
 * of the shadow. `aria-invalid="true"` draws `Input`'s inset 1px `--rd-danger` line while the field is not focused.
 * The type weight is the label's (`font: inherit`).
 * Inside a `FilterBar` (SelectChipContext) the trigger is the chip's value segment instead: 30px, 10px into the chip,
 * 10px sides, a 1px ink line at 11% on its start edge and no other border or corner, the surface fill, ink 12.5px
 * semibold, as wide as its value (4.5rem to 16rem; the whole row in the phone drawer), a pointer cursor, and on focus
 * the 2px crimson thread under it. A chip that holds a value shows the FilterBar's «×» in place of the chevron.
 *
 * The list, the same for every Select: raised
 * `--rd-surface-2` with an inset 1px ink line at 11% and `--rd-shadow-pop`, 6px corners, 4px padding, 1px between
 * rows, at most min(320px, 92vw) wide and min(360px, 60vh) high with a thin scrollbar, dropping in over 140ms when
 * motion is allowed. Under a chip it opens 6px below the chip, at the chip's start, at least max(180px, the chip's
 * width) wide; elsewhere 6px below the field, at least as wide as the field. A row: 34px, 6px / 10px padding, 4px
 * corners, `--rd-ink-2` 13px medium, `--rd-surface` and ink under the pointer and on keyboard focus (with a 2px
 * crimson outline inside), the chosen one crimson and bold with a tick at the end.
 *
 * `SelectEmpty` is the list's row for nothing to choose (no rows yet, or none left): the row's size in
 * `--rd-muted`, not focusable.
 */

const EMPTY = '__select-empty__';
const toRadix = (value: string) => (value === '' ? EMPTY : value);
const fromRadix = (value: string) => (value === EMPTY ? '' : value);

/** Set by FilterBar around its chips: a Select inside is the chip's value segment. */
export type SelectChip = {
  /** The chip shows FilterBar's «×» while it holds a value, so the chevron steps aside. */
  clearable: boolean;
  /** The phone drawer is open: the value takes the rest of the chip's row. */
  drawer: boolean;
};
export const SelectChipContext = React.createContext<SelectChip | null>(null);

const field = [
  'w-full cursor-default rounded-sm border border-solid pe-9 shadow-sm focus:border-accent focus:shadow-none focus:ring-3 focus:ring-focus disabled:bg-surface-2',
  'aria-invalid:not-focus:inset-ring aria-invalid:not-focus:inset-ring-danger',
];

const triggerVariants = cva(
  'relative flex min-h-0 items-center py-0 text-start text-ink transition-shadow duration-fast ease-standard focus:outline-none disabled:cursor-not-allowed disabled:opacity-disabled',
  {
    variants: {
      place: {
        field: [field, 'h-9 border-field-line bg-sunken ps-3 text-base leading-5 max-touch:h-11'],
        desk: [field, 'h-8.5 border-field-line bg-sunken ps-3 text-base leading-5 max-touch:h-11'],
        dialog: [field, 'h-8.5 border-field-line bg-sunken ps-3 text-base leading-5 max-touch:h-11'],
        pane: [field, 'h-8.5 border-field bg-surface ps-2 text-md leading-5 max-touch:h-11'],
        pager: [field, 'h-7 border-field bg-surface ps-2 text-md max-touch:h-11'],
        chip: [
          'ms-2.5 h-7.5 w-auto min-w-18 max-w-64 flex-none cursor-pointer rounded-none px-2.5',
          'border-0 border-s border-solid border-s-line-strong bg-surface text-chip font-semibold leading-5 shadow-none',
          'focus:shadow-thread',
        ],
      },
      drawer: {
        true: 'max-md:w-full max-md:max-w-none max-md:flex-1',
        false: '',
      },
    },
    defaultVariants: { place: 'field', drawer: false },
  },
);

type Place = 'field' | 'desk' | 'dialog' | 'pane' | 'pager';

export interface SelectProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'defaultValue' | 'onChange' | 'children' | 'dir' | 'type'> {
  /** The chosen value; `''` is a choice like any other (the «الكل» row). */
  value: string;
  /** Runs when a different value is picked. */
  onValueChange: (value: string) => void;
  /** `SelectItem`s. */
  children: React.ReactNode;
  /** Where the field sits (see above); a Select inside a FilterBar is a chip whatever this says. */
  place?: Place;
  name?: string;
  autoComplete?: string;
  required?: boolean;
}

/** The field and its list. `className` lands on the trigger (layout: width, grid place) and wins (`cn`). */
export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ value, onValueChange, children, place = 'field', name, autoComplete, required, disabled, className, ...trigger }, ref) => {
    const chip = React.useContext(SelectChipContext);
    const own = React.useRef<HTMLButtonElement | null>(null);
    const [anchor, setAnchor] = React.useState<{ align: number; side: number; width: number } | null>(null);
    const setRef = React.useCallback(
      (node: HTMLButtonElement | null) => {
        own.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    // Under a chip the list hangs from the whole chip (its label), not from the value segment: it starts at the
    // chip's start edge, 6px under it, and is at least as wide as the chip.
    const measure = () => {
      const node = own.current;
      const label = node?.closest('label');
      if (!node || !label) {
        setAnchor(null);
        return;
      }
      const box = node.getBoundingClientRect();
      const frame = label.getBoundingClientRect();
      const rtl = getComputedStyle(node).direction === 'rtl';
      setAnchor({
        align: -(rtl ? frame.right - box.right : box.left - frame.left),
        side: frame.bottom - box.bottom + 6,
        width: Math.max(180, frame.width),
      });
    };

    const hanging = chip ? anchor : null;
    return (
      <SelectPrimitive.Root
        value={toRadix(value)}
        onValueChange={(next) => onValueChange(fromRadix(next))}
        onOpenChange={(open) => {
          if (open && chip) measure();
        }}
        name={name}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          ref={setRef}
          data-slot="select-trigger"
          data-value={value}
          className={cn(triggerVariants({ place: chip ? 'chip' : place, drawer: Boolean(chip?.drawer) }), className)}
          {...trigger}
        >
          <SelectPrimitive.Value className="block min-w-0 truncate" />
          {chip?.clearable && value !== '' ? null : (
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-3 my-auto size-4 text-muted" />
          )}
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            side="bottom"
            align="start"
            sideOffset={hanging ? hanging.side : 6}
            alignOffset={hanging ? hanging.align : 0}
            collisionPadding={8}
            className={cn(
              'z-dialog-list max-h-[min(360px,60vh)] max-w-[min(320px,92vw)] overflow-hidden rounded-sm',
              'bg-surface-2 shadow-pop inset-ring inset-ring-line-strong origin-top motion-safe:animate-pop-in',
              !hanging && 'min-w-(--radix-select-trigger-width)',
            )}
            style={hanging ? { minWidth: hanging.width } : undefined}
          >
            {/* Radix hides the list's scrollbar with an unlayered rule; the list keeps a thin one. */}
            <SelectPrimitive.Viewport className="grid gap-px p-1 [scrollbar-width:thin]!">{children}</SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );
  },
);
Select.displayName = 'Select';

export interface SelectItemProps extends Omit<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>, 'value'> {
  /** The value this row picks; `''` is allowed. */
  value: string;
}

/** One row of the list. `data-value` carries the caller's value (an e2e handle that does not depend on the copy). */
export const SelectItem = React.forwardRef<React.ComponentRef<typeof SelectPrimitive.Item>, SelectItemProps>(
  ({ value, className, children, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      value={toRadix(value)}
      data-value={value}
      data-slot="select-item"
      className={cn(
        'flex min-h-8.5 cursor-pointer select-none items-center gap-2 rounded-xs border-0 bg-transparent px-2.5 py-1.5',
        'text-start text-md font-medium text-ink-2',
        'hover:bg-surface hover:text-ink',
        'focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        'data-[state=checked]:font-bold data-[state=checked]:text-accent',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="ms-auto flex-none">
        <Check size={15} strokeWidth={2} aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = 'SelectItem';

/** The list's row for nothing to choose: the caller gives the words (no rows yet, or none left). Not a choice. */
export function SelectEmpty({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="presentation"
      data-slot="select-empty"
      className={cn('flex min-h-8.5 select-none items-center px-2.5 py-1.5 text-start text-md font-medium text-muted', className)}
      {...props}
    />
  );
}
