'use client';

import { ListFilter, X } from 'lucide-react';
import { Children, cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Select, SelectChipContext } from './ui/select';
import { usePrefs } from '../lib/prefs';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { cn } from '../lib/cn';

/**
 * The filter bar (`data-slot` `filter-bar` > `filter-panel`): each field is a plain `<label>` child, drawn as a
 * Graphite chip — the field's name on a raised segment, its value beside it (spec 2026-11-09-graphite-identity). A
 * `Select` in a chip is the chip's value segment (`SelectChipContext`), and its list opens under the whole chip (the
 * options, the chosen one in crimson with a tick; components/ui/select.tsx, Radix Select since Tailwind migration
 * T2.4). Placed right above a table card it joins that card's top edge. On a phone the fields move into «كل الفلاتر»,
 * a drawer.
 *
 * Its own parts are utilities since Tailwind migration T2.9, ported from desk/filters.css and graphite.css in their
 * cascade order:
 * - the bar: a row, 6px apart (8px on a phone), 12px / 16px padding, 6px corners, the surface fill and a 1px inset
 *   `--rd-line` ring; its bottom corners square when a pane follows it. `loose`: no padding, fill or ring.
 * - the panel: one wrapping row, 8px apart, nothing of its own. On a phone (under 768px) it is hidden until
 *   «كل الفلاتر» opens it (a bare loose bar keeps it in place); open, it is the drawer: the full height at the reading
 *   end, min(380px, 92vw) wide, the surface fill, `--rd-shadow-pop`, 18px at the sides and bottom, a column 12px apart,
 *   scrolling, sliding in over 220ms when motion is allowed, over a `--rd-scrim` scrim one step under it.
 * - «كل الفلاتر» (phones only, not on a bare bar): 36px, 12px at the sides, 6px corners, `--rd-surface-2` with a 1px
 *   inset ink line at 11%, semibold `--rd-ink-2`, its 15px icon 6px before the words.
 * - the drawer's head (60px, its rule under it, edge to edge) and foot (its rule above it, at the bottom).
 * - the clear: at the row's end (at the start of its own line in the drawer), shown only once a chip holds a value.
 * - a chip's «×»: 26px, a 1px ink line at 11% at its start, `--rd-muted`, crimson on `--rd-accent-soft` under the
 *   pointer.
 * The chips themselves (labels, their fields, the search chip, the toggle chip) are still the legacy rules that read
 * `[data-slot='filter-panel'] > label` (graphite.css, filters.css) until the screens move (T4).
 * Handles: `data-slot` `filter-bar` (with `data-open`, `data-loose`, `data-bare`), `filter-panel`, `chip-clear`;
 * `data-testid="filter-panel"`.
 */
export function FilterBar({
  children,
  onClear,
  clearLabel,
  loose = false,
  bare = false,
}: {
  children: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
  /** Chips standing on the page above the list (packages), not on the top edge of its card. */
  loose?: boolean;
  /** Only the chips and their lists: no «كل الفلاتر» drawer, no «×» on a chip — a single chosen value outside a filter bar. */
  bare?: boolean;
}) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // An open chip list takes its own Escape first (Radix marks it handled); the drawer stays.
      if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // A chip that holds a value gets a «×» that sets it back to all, as in the design.
  const chips = Children.map(children, (child) => {
    if (bare || !isValidElement(child) || child.type !== 'label') return child;
    const parts = Children.toArray((child.props as { children?: ReactNode }).children);
    const field = parts.find((part) => isValidElement(part) && part.type === Select) as ReactElement<{ value?: string; onValueChange?: (value: string) => void }> | undefined;
    if (!field?.props.value) return child;
    const name = parts.find((part) => typeof part === 'string') as string | undefined;
    return cloneElement(
      child as ReactElement<{ children?: ReactNode }>,
      {},
      ...parts,
      <button
        key="clear"
        type="button"
        data-slot="chip-clear"
        className="grid w-6.5 flex-none place-items-center border-0 border-s border-s-ink/11 bg-transparent p-0 text-muted hover:bg-accent-soft hover:text-accent"
        // A pointer shortcut: the field's own «الكل» does the same from the keyboard, and the «×» stays out of the
        // field's name.
        aria-hidden="true"
        tabIndex={-1}
        title={t.clearChip.replace('{name}', name ?? '')}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          field.props.onValueChange?.('');
        }}
      >
        <X size={13} strokeWidth={2} aria-hidden="true" />
      </button>,
    );
  });

  return (
    <div
      data-slot="filter-bar"
      data-open={open ? '' : undefined}
      data-loose={loose ? '' : undefined}
      data-bare={bare ? '' : undefined}
      className={cn(
        'relative flex flex-nowrap items-center gap-1.5 rounded-sm border-0 max-md:gap-2',
        'has-[+.pane]:rounded-es-none has-[+.pane]:rounded-ee-none has-[+section]:rounded-es-none has-[+section]:rounded-ee-none',
        loose ? 'bg-transparent p-0' : 'bg-surface px-4 py-3 inset-ring inset-ring-line',
      )}
    >
      <button
        type="button"
        className={cn(
          'hidden h-9 items-center gap-1.5 rounded-sm border-0 bg-surface-2 px-3 font-semibold text-ink-2 inset-ring inset-ring-ink/11',
          !bare && 'max-md:inline-flex',
        )}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <ListFilter size={15} strokeWidth={1.9} aria-hidden="true" />
        {t.allFilters}
      </button>
      {open ? <div className="fixed inset-0 z-dialog hidden bg-scrim max-md:block" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
      <div
        data-slot="filter-panel"
        className={cn(
          'flex w-full flex-wrap items-center gap-2 overflow-visible border-0 bg-transparent p-0',
          open
            ? [
              'max-md:fixed max-md:inset-y-0 max-md:end-0 max-md:z-[calc(var(--rd-z-dialog)+1)] max-md:w-[min(380px,92vw)]',
              'max-md:flex-col max-md:flex-nowrap max-md:items-stretch max-md:gap-3 max-md:overflow-y-auto',
              'max-md:bg-surface max-md:px-4.5 max-md:pt-0 max-md:pb-4.5 max-md:shadow-pop',
              'max-md:motion-safe:animate-[filter-slide_220ms_var(--rd-ease-out)]',
            ]
            : !(bare && loose) && 'max-md:hidden',
        )}
        data-testid="filter-panel"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? t.allFilters : undefined}
      >
        <div className={cn('-mx-4.5 hidden h-15 items-center justify-between border-b border-line px-4.5', open && 'max-md:flex')}>
          <b>{t.allFilters}</b>
          <IconButton aria-label={t.closeMenu} onClick={() => setOpen(false)}>
            <X size={18} strokeWidth={1.9} aria-hidden="true" />
          </IconButton>
        </div>
        <SelectChipContext.Provider value={{ clearable: !bare, drawer: open }}>{chips}</SelectChipContext.Provider>
        {onClear ? (
          // The filter bar's clear: 8px sides, 11px, crimson text at rest and on hover, at the row's end; hidden until a
          // chip holds a value (a «×», a filled field or a ticked toggle).
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'ms-auto px-2 text-xs text-accent hover:text-accent',
              "[[data-slot=filter-panel]:not(:has(>label_:is([data-slot=chip-clear],input:not([type=checkbox]):not([value=''])),>label_input[type=checkbox]:checked))_&]:hidden",
              open && 'max-md:ms-0 max-md:self-start',
            )}
            onClick={onClear}
          >
            {clearLabel}
          </Button>
        ) : null}
        <div className={cn('mt-auto hidden border-t border-line pt-3', open && 'max-md:grid')}>
          <Button type="button" onClick={() => setOpen(false)}>{t.showResults}</Button>
        </div>
      </div>
    </div>
  );
}
