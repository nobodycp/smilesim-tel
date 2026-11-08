'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export type TabItem<K extends string> = { key: K; label: ReactNode; count?: number | null; disabled?: boolean };

/**
 * The one tab strip (spec 2026-11-08-inner-pages-refresh, §2): a segmented control on a soft track, the selected tab
 * on the surface. A tab may carry a `count`. Keys follow WAI-ARIA tabs: ArrowLeft/Right (mirrored in RTL), Home, End
 * move and select; only the selected tab is in the Tab order.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (next: K) => void;
  label?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const enabled = items.filter((item) => !item.disabled);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = enabled.findIndex((item) => item.key === value);
    if (at < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
    let next = -1;
    if (step) next = (at + step + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = enabled[next];
    onChange(target.key);
    strip.current?.querySelector<HTMLButtonElement>(`[data-tab="${target.key}"]`)?.focus();
  }

  return (
    <div ref={strip} className="steps" role="tablist" aria-label={label} onKeyDown={onKey}>
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            data-tab={item.key}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
          >
            {item.label}
            {item.count ? <span className="step-count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
