'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { usePrefs } from '../lib/prefs';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './ui/popover';

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

/*
 * The look (Tailwind migration T2.8) is graphite.css's DateField block, ported value for value:
 * - the row: inline flex, stretched, 6px apart, no minimum width; in a filter chip (`[data-slot=filter-panel] > label`) no gap,
 *   the button being the chip's value end.
 * - the text field takes the look of the place it sits in (the global field rule, the desk, the filter chip, the
 *   dialog: their legacy rules, until those slices move them); here only what the block itself set and reached:
 *   no minimum width, tabular figures, 7.5rem in a desk's filter chip, and the rest of the row in a dialog. The
 *   block's own `inline-size: 8rem` never reached it (the global field rule's `width: 100%` outranked it) and is not
 *   carried.
 * - the calendar button: a 34px-wide grid cell (40px under 641px) stretched to the field's height, a 1px
 *   `--rd-line` border, 6px corners, `--rd-surface-2`, `--rd-ink-2`, crimson under the pointer and while open; in a
 *   filter chip 30px square, no border but a 1px ink line at 11% at its start, square corners, `--rd-surface` (at
 *   every width); in a dialog 34px high; on the canvas at least 44px high at 720px and under (responsive.css's touch
 *   rule, made explicit).
 * - the month (`PopoverContent`, components/ui/popover.tsx, the same panel): 280px wide; the head a row 8px apart
 *   with 8px under it, the 13px ink month name between two 30px steps (4px corners, `--rd-ink-2`, `--rd-surface-2`
 *   under the pointer); seven equal columns 2px apart; weekday names 26px high, 11px semibold `--rd-muted`; days
 *   34px (40px under 641px), 4px corners, 12px semibold ink tabular figures, `--rd-surface-2` under the pointer,
 *   today ringed 1px in `--rd-accent`, the chosen day `--rd-accent-fill` with `--rd-on-accent` text (ringed in its
 *   own fill when it is today, no hover change); the foot 8px over a `--rd-line` hairline with 8px above it,
 *   «اليوم» and «مسح» at its two ends as 30px crimson semibold links with 10px sides, `--rd-accent-soft` under the
 *   pointer.
 */
const ROW = 'inline-flex min-w-0 items-stretch gap-1.5 [[data-slot=filter-panel]>label_&]:gap-0';
const FIELD = 'min-w-0 tabular-nums [.desk_[data-slot=filter-panel]>label_&]:w-30 [[data-slot=dialog]_&]:flex-1';
const OPEN = cn(
  'grid w-8.5 flex-none cursor-pointer place-items-center rounded-sm border border-solid border-line bg-surface-2 text-ink-2',
  'hover:text-accent aria-expanded:text-accent max-sm:w-10',
  '[[data-slot=filter-panel]>label_&]:h-7.5 [[data-slot=filter-panel]>label_&]:w-7.5 [[data-slot=filter-panel]>label_&]:rounded-none [[data-slot=filter-panel]>label_&]:border-0',
  '[[data-slot=filter-panel]>label_&]:border-s [[data-slot=filter-panel]>label_&]:border-s-ink/11 [[data-slot=filter-panel]>label_&]:bg-surface',
  '[[data-slot=dialog]_&]:h-8.5 max-[721px]:[.canvas_&]:min-h-11',
);
const STEP = 'grid size-7.5 cursor-pointer place-items-center rounded-xs border-0 bg-transparent text-ink-2 hover:bg-surface-2';
const DAY = 'h-8.5 cursor-pointer rounded-xs border-0 text-sm font-semibold tabular-nums max-sm:h-10';
const LINK = 'h-7.5 cursor-pointer rounded-xs border-0 bg-transparent px-2.5 font-semibold text-accent hover:bg-accent-soft';

/**
 * A date the system draws (owner 2026-11-11), never the browser's `type="date"`: a text field that takes
 * `YYYY-MM-DD` as the rest of the office writes dates, and a calendar button that opens a month on the system's
 * surface — weekday names in the page's language, Latin digits, today ringed, the chosen day in crimson, «مسح».
 * `onChange` gets an ISO date or ''.
 *
 * The month is a `Popover` (Radix, Tailwind migration T2.8) anchored on the whole row: under it at its reading start,
 * over it when the window has no room below, kept 8px inside the window. Radix gives the `role="dialog"` named
 * «اختيار التاريخ», `aria-expanded` / `aria-controls` on the button, the focus moved into the month on opening and
 * back to the button on closing (a picked day, Escape, the button again), and the close on a press or focus outside;
 * a press in the text field does not close it (as before). Handles: `data-slot="date-field"` on the row,
 * `"date-field-open"` on the button, `"popover"` on the month.
 */
export function DateField({ value, onChange, label, className }: {
  value: string;
  onChange: (next: string) => void;
  /** The field's name for readers, when no visible `<label>` wraps it. */
  label?: string;
  className?: string;
}) {
  const { t, locale } = usePrefs();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
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

  // Radix gives the focus back to the button as the month closes.
  function pick(date: Date | null) {
    const next = date ? iso(date) : '';
    setDraft(next);
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(new Date((chosen ?? new Date()).getFullYear(), (chosen ?? new Date()).getMonth(), 1));
        setOpen(next);
      }}
    >
      <PopoverAnchor asChild>
        <span ref={root} data-slot="date-field" className={cn(ROW, className)}>
          <input
            className={FIELD}
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
          <PopoverTrigger asChild>
            <button type="button" data-slot="date-field-open" className={OPEN} aria-label={t.pickDate}>
              <CalendarDays size={15} aria-hidden="true" />
            </button>
          </PopoverTrigger>
        </span>
      </PopoverAnchor>
      <PopoverContent
        className="w-70"
        aria-label={t.pickDate}
        // A press or focus in the text field (or on the button, which toggles) leaves the month open.
        onInteractOutside={(event) => {
          if (root.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button type="button" className={STEP} aria-label={t.previousMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronRight className="ltr:-scale-x-100" size={16} aria-hidden="true" />
          </button>
          <b className="text-md text-ink">{title}</b>
          <button type="button" className={STEP} aria-label={t.nextMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <ChevronLeft className="ltr:-scale-x-100" size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5" role="grid">
          {weekdays.map((name) => <span key={name} className="grid h-6.5 place-items-center text-xs font-semibold text-muted" role="columnheader">{name}</span>)}
          {cells.map((date, index) => {
            if (!date) return <span key={`blank-${index}`} />;
            const day = iso(date);
            const on = day === value;
            const isToday = day === today;
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                className={cn(
                  DAY,
                  on ? 'bg-accent-fill text-on-accent' : 'bg-transparent text-ink hover:bg-surface-2',
                  isToday && (on ? 'inset-ring inset-ring-accent-fill' : 'inset-ring inset-ring-accent'),
                )}
                aria-selected={on}
                onClick={() => pick(date)}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between border-t border-line pt-2">
          <button type="button" className={LINK} onClick={() => pick(new Date())}>{t.today}</button>
          <button type="button" className={LINK} onClick={() => pick(null)}>{t.clearDate}</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
