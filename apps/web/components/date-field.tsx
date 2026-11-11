'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLayoutEffect, useMemo, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { usePopover } from '../lib/use-popover';
import { usePrefs } from '../lib/prefs';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(value: string): Date | null {
  const match = ISO.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getMonth() === Number(match[2]) - 1 ? date : null;
}

function iso(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A date the system draws (owner 2026-11-11), never the browser's `type="date"`: a text field that takes
 * `YYYY-MM-DD` as the rest of the office writes dates, and a calendar button that opens a month on the system's
 * surface — weekday names in the page's language, Latin digits, today ringed, the chosen day in crimson, «مسح».
 * `onChange` gets an ISO date or ''.
 */
export function DateField({ value, onChange, label, className }: {
  value: string;
  onChange: (next: string) => void;
  /** The field's name for readers, when no visible `<label>` wraps it. */
  label?: string;
  className?: string;
}) {
  const { t, locale } = usePrefs();
  const { open, setOpen, toggle, root, panel, trigger } = usePopover();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const chosen = parse(value);
  const [month, setMonth] = useState(() => {
    const base = chosen ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const box = root.current.getBoundingClientRect();
    const width = 280;
    const rtl = getComputedStyle(root.current).direction === 'rtl';
    const left = Math.min(Math.max(8, rtl ? box.right - width : box.left), window.innerWidth - width - 8);
    const below = box.bottom + 6 + 320 < window.innerHeight;
    setPlace({ top: below ? box.bottom + 6 : Math.max(8, box.top - 326), left });
  }, [open, root]);

  const tag = `${locale}-u-nu-latn`;
  const title = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' }).format(month);
  const weekdays = useMemo(() => {
    // Arabic and Hebrew short names do not fit a 36px column; their one-letter form does.
    const format = new Intl.DateTimeFormat(tag, { weekday: locale === 'en' ? 'short' : 'narrow' });
    // Sunday first, as the week runs here.
    return Array.from({ length: 7 }, (_, index) => format.format(new Date(2026, 10, 1 + index)));
  }, [tag, locale]);
  const today = iso(new Date());
  const lead = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1))];

  function pick(date: Date | null) {
    const next = date ? iso(date) : '';
    setDraft(next);
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <span ref={root as unknown as Ref<HTMLSpanElement>} className={className ? `date-field ${className}` : 'date-field'}>
      <input
        value={draft}
        dir="ltr"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (next === '') onChange('');
          else if (parse(next)) onChange(next);
        }}
      />
      <button ref={trigger} type="button" className="date-field-open" aria-label={t.pickDate} aria-expanded={open} onClick={() => {
        if (!open) setMonth(new Date((chosen ?? new Date()).getFullYear(), (chosen ?? new Date()).getMonth(), 1));
        toggle();
      }}>
        <CalendarDays size={15} aria-hidden="true" />
      </button>
      {open && place && typeof document !== 'undefined' ? createPortal(
        <div ref={panel} className="date-pop" role="dialog" aria-label={t.pickDate} style={{ top: place.top, left: place.left }}>
          <div className="date-pop-head">
            <button type="button" className="date-pop-step" aria-label={t.previousMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <ChevronRight className="flip-ltr" size={16} aria-hidden="true" />
            </button>
            <b>{title}</b>
            <button type="button" className="date-pop-step" aria-label={t.nextMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <ChevronLeft className="flip-ltr" size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="date-pop-grid" role="grid">
            {weekdays.map((name) => <span key={name} className="date-pop-weekday" role="columnheader">{name}</span>)}
            {cells.map((date, index) => date ? (
              <button
                key={iso(date)}
                type="button"
                role="gridcell"
                className={['date-pop-day', iso(date) === today ? 'today' : '', iso(date) === value ? 'on' : ''].filter(Boolean).join(' ')}
                aria-selected={iso(date) === value}
                onClick={() => pick(date)}
              >
                {date.getDate()}
              </button>
            ) : <span key={`blank-${index}`} />)}
          </div>
          <div className="date-pop-foot">
            <button type="button" className="date-pop-link" onClick={() => pick(new Date())}>{t.today}</button>
            <button type="button" className="date-pop-link" onClick={() => pick(null)}>{t.clearDate}</button>
          </div>
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
