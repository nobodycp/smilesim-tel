'use client';

import { Check, ListFilter, X } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from './ui/button';

type Pop = { select: HTMLSelectElement; top: number; start: number; minWidth: number; value: string; options: { value: string; label: string }[] };

/** Sets a React-controlled `<select>` as a person would, so its own onChange runs. */
function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * The filter bar (`.filter-bar` > `.filter-panel`): each field is a plain `<label>` child, drawn as a Graphite chip —
 * the field's name on a raised segment, its value beside it (spec 2026-11-09-graphite-identity). Pressing a chip's
 * list opens the design's own list under the chip (the options, the chosen one in crimson with a tick) instead of the
 * browser's; the `<select>` underneath stays the field, so the keyboard and assistive tech use it as before. Placed
 * right above a table card it joins that card's top edge. On a phone the fields move into «كل الفلاتر», a drawer.
 */
export function FilterBar({
  children,
  onClear,
  clearLabel,
}: {
  children: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState<Pop | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!pop) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || target === pop.select) return;
      setPop(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPop(null);
        pop.select.focus();
      }
    };
    const onScroll = () => setPop(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
    };
  }, [pop]);

  function openList(event: ReactMouseEvent<HTMLDivElement>) {
    const select = (event.target as HTMLElement).closest('select');
    if (!select || select.disabled || event.button !== 0) return;
    event.preventDefault();
    select.focus();
    if (pop?.select === select) {
      setPop(null);
      return;
    }
    const chip = (select.closest('label') ?? select).getBoundingClientRect();
    const rtl = getComputedStyle(select).direction === 'rtl';
    setPop({
      select,
      top: chip.bottom + 6,
      start: rtl ? window.innerWidth - chip.right : chip.left,
      minWidth: Math.max(180, chip.width),
      value: select.value,
      options: Array.from(select.options).map((option) => ({ value: option.value, label: option.text })),
    });
  }

  return (
    <div className={open ? 'filter-bar drawer-open' : 'filter-bar'}>
      <button type="button" className="filter-all" aria-expanded={open} onClick={() => setOpen(true)}>
        <ListFilter size={15} strokeWidth={1.9} aria-hidden="true" />
        {t.allFilters}
      </button>
      {open ? <div className="filter-scrim" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
      <div
        className="filter-panel"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? t.allFilters : undefined}
        onMouseDown={openList}
      >
        <div className="filter-drawer-head">
          <b>{t.allFilters}</b>
          <button type="button" className="icon-btn" aria-label={t.closeMenu} onClick={() => setOpen(false)}>
            <X size={18} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
        {children}
        {onClear ? (
          <Button type="button" variant="ghost" size="sm" className="filter-clear" onClick={onClear}>
            {clearLabel}
          </Button>
        ) : null}
        <div className="filter-drawer-foot">
          <Button type="button" onClick={() => setOpen(false)}>{t.showResults}</Button>
        </div>
      </div>
      {pop ? (
        <div
          ref={popRef}
          className="filter-pop"
          role="listbox"
          aria-label={pop.select.closest('label')?.firstChild?.textContent ?? ''}
          style={{ top: pop.top, insetInlineStart: pop.start, minWidth: pop.minWidth }}
        >
          {pop.options.map((option) => {
            const on = option.value === pop.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={on}
                className={on ? 'sel' : undefined}
                onClick={() => {
                  choose(pop.select, option.value);
                  setPop(null);
                }}
              >
                <span>{option.label}</span>
                {on ? <Check className="tick" size={15} strokeWidth={2} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
