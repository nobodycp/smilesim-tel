'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { markOf, rankNames, type NameOption } from '../lib/name-match';
import { usePrefs } from '../lib/prefs';

export type { NameOption } from '../lib/name-match';

const LIMIT = 8;

/**
 * Pick a name by typing (spec 2026-11-09-admin-review, 2a), in place of a list: from the first letter up to eight
 * names under the field, closest first (`lib/name-match.ts`: Arabic-aware, typo-tolerant), the matched part in bold.
 * ↑/↓ move, Enter picks, Esc closes; a picked name shows in the field with a «×» that clears it. The field never
 * takes free text: leaving it puts the picked name back. Focused and empty, it lists the first eight, so a short
 * list can still be browsed.
 *
 * `allLabel`: a filter's «الكل» — the field's placeholder while nothing is picked; clearing goes back to it.
 * The list is drawn in a portal with a fixed position, so a filter chip's clipping or a dialog does not cut it.
 */
export function NameField({
  value,
  onChange,
  options,
  label,
  id,
  placeholder,
  allLabel,
  disabled,
  invalid,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly NameOption[];
  /** The accessible name when no `<label>` wraps the field. */
  label?: string;
  id?: string;
  placeholder?: string;
  allLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const { t } = usePrefs();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ block: number; start: number; width: number; up: boolean; name: string } | null>(null);
  const picked = options.find((option) => option.value === value) ?? null;
  const shown = useMemo(() => rankNames(query ?? '', options, LIMIT), [query, options]);

  // Under the field, or over it when the space below is short; anchored at the field's start edge.
  const reposition = useCallback(() => {
    const box = input.current?.closest('.name-field')?.getBoundingClientRect();
    if (!box) return;
    const rtl = getComputedStyle(input.current as Element).direction === 'rtl';
    const below = window.innerHeight - box.bottom;
    const up = below < 220 && box.top > below;
    setPlace({
      block: up ? window.innerHeight - box.top + 6 : box.bottom + 6,
      start: rtl ? window.innerWidth - box.right : box.left,
      width: Math.max(220, box.width),
      up,
      // The list's name: the field's own, or the wrapping label's first text (a filter chip's name).
      name: label ?? input.current?.closest('label')?.firstChild?.textContent ?? '',
    });
  }, [label]);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, shown.length, reposition]);

  useEffect(() => {
    if (!open) return;
    const follow = reposition;
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, reposition]);

  function close() {
    setOpen(false);
    setQuery(null);
    setActive(0);
  }

  function pick(option: NameOption) {
    onChange(option.value);
    close();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (shown.length ? (current + step + shown.length) % shown.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      if (open && shown[active]) {
        event.preventDefault();
        pick(shown[active]);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      // Closing the list is this key's whole work: a dialog around the field stays open.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const text = query ?? picked?.label ?? '';
  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;

  return (
    <span className={['name-field', invalid ? 'invalid' : '', className ?? ''].filter(Boolean).join(' ')}>
      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={text}
        placeholder={picked ? undefined : allLabel ?? placeholder ?? t.typeToFind}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKey}
      />
      {picked && !disabled ? (
        <button
          type="button"
          className="name-field-clear"
          aria-label={allLabel ? `${t.clearName} · ${allLabel}` : t.clearName}
          title={t.clearName}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // Inside a filter chip the label would otherwise pass the click on to the field.
            event.preventDefault();
            event.stopPropagation();
            onChange('');
            close();
            input.current?.focus();
          }}
        >
          <X size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
      {open && place && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={list}
              id={listId}
              role="listbox"
              aria-label={place.name || undefined}
              className={place.up ? 'name-pop up' : 'name-pop'}
              style={{ ...(place.up ? { bottom: place.block } : { top: place.block }), insetInlineStart: place.start, minWidth: place.width }}
              onMouseDown={(event) => event.preventDefault()}
            >
              {shown.length ? shown.map((option, index) => {
                const mark = markOf(query ?? '', option.label);
                return (
                  <div
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={[index === active ? 'on' : '', option.value === value ? 'sel' : ''].filter(Boolean).join(' ') || undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(option)}
                  >
                    <bdi className="name-pop-label">
                      {mark ? (
                        <>
                          {option.label.slice(0, mark[0])}
                          <b>{option.label.slice(mark[0], mark[1])}</b>
                          {option.label.slice(mark[1])}
                        </>
                      ) : option.label}
                    </bdi>
                    {option.hint ? <small>{option.hint}</small> : null}
                  </div>
                );
              }) : <p className="name-pop-none">{t.noNameMatch}</p>}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
