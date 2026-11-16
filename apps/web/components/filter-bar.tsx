'use client';

import { ListFilter, X } from 'lucide-react';
import { Children, cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Select, SelectChipContext } from './ui/select';
import { usePrefs } from '../lib/prefs';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';

/**
 * The filter bar (`.filter-bar` > `.filter-panel`): each field is a plain `<label>` child, drawn as a Graphite chip —
 * the field's name on a raised segment, its value beside it (spec 2026-11-09-graphite-identity). A `Select` in a chip
 * is the chip's value segment (`SelectChipContext`), and its list opens under the whole chip (the options, the chosen
 * one in crimson with a tick; components/ui/select.tsx, Radix Select since Tailwind migration T2.4). Placed right
 * above a table card it joins that card's top edge. On a phone the fields move into «كل الفلاتر», a drawer.
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
        className="chip-x"
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
    <div className={['filter-bar', open ? 'drawer-open' : '', loose ? 'loose' : '', bare ? 'bare' : ''].filter(Boolean).join(' ')}>
      <button type="button" className="filter-all" aria-expanded={open} onClick={() => setOpen(true)}>
        <ListFilter size={15} strokeWidth={1.9} aria-hidden="true" />
        {t.allFilters}
      </button>
      {open ? <div className="filter-scrim" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
      <div
        className="filter-panel"
        data-testid="filter-panel"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? t.allFilters : undefined}
      >
        <div className="filter-drawer-head">
          <b>{t.allFilters}</b>
          <IconButton aria-label={t.closeMenu} onClick={() => setOpen(false)}>
            <X size={18} strokeWidth={1.9} aria-hidden="true" />
          </IconButton>
        </div>
        <SelectChipContext.Provider value={{ clearable: !bare, drawer: open }}>{chips}</SelectChipContext.Provider>
        {onClear ? (
          // The filter bar's clear: 8px sides, 11px, crimson text at rest and on hover (`.filter-clear` places and hides it).
          <Button type="button" variant="ghost" size="sm" className="filter-clear px-2 text-xs text-accent hover:text-accent" onClick={onClear}>
            {clearLabel}
          </Button>
        ) : null}
        <div className="filter-drawer-foot">
          <Button type="button" onClick={() => setOpen(false)}>{t.showResults}</Button>
        </div>
      </div>
    </div>
  );
}
