'use client';

import { ListFilter, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from './ui/button';

/**
 * The filter bar (`.filter-bar` > `.filter-panel`): each field is a plain `<label>` child, drawn as a Graphite chip —
 * the label's name on a raised segment, the field beside it (spec 2026-11-09-graphite-identity). Placed right above
 * a table card it joins that card's top edge. On a phone the fields move into «كل الفلاتر», a drawer from the
 * reading side, opened from the bar; they apply as they change, and «عرض النتائج» closes it.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={open ? 'filter-bar drawer-open' : 'filter-bar'}>
      <button type="button" className="filter-all" aria-expanded={open} onClick={() => setOpen(true)}>
        <ListFilter size={15} strokeWidth={1.9} aria-hidden="true" />
        {t.allFilters}
      </button>
      {open ? <div className="filter-scrim" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
      <div className="filter-panel" role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} aria-label={open ? t.allFilters : undefined}>
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
    </div>
  );
}
