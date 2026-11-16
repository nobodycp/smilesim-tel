'use client';

import { Zap } from 'lucide-react';
import { cn } from '../lib/cn';
import { usePrefs } from '../lib/prefs';
import { Segmented, SegmentedItem } from './ui/segmented';

export type RunMode = 'auto' | 'manual' | 'off';

/** Where a mode comes from: a small muted line (in crimson when it is the package's own). */
const sourceClass = 'inline-flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted max-sm:col-span-full';

/**
 * How each operation runs, as cards (Graphite «طريقة التنفيذ», from design/night-desk-family): a crimson mark, the
 * operation's name and a three-way segmented control — automatic, a branch task, stopped. A stopped operation's card
 * dims. `onChange` saves at once.
 *
 * With `inherited` (a package; spec 2026-11-09-admin-review, 3): each card says where its mode comes from — «موروث
 * من المزود» when it follows the provider, «مخصص» with «رجوع للموروث» (`onInherit`) when it is the package's own.
 */
export function ModeCards<K extends string>({
  actions,
  names,
  modes,
  disabled,
  onChange,
  inherited,
  onInherit,
}: {
  actions: readonly K[];
  names: Record<K, string>;
  modes: Partial<Record<K, string>>;
  disabled?: boolean;
  onChange: (action: K, mode: RunMode) => void;
  inherited?: readonly string[];
  onInherit?: (action: K) => void;
}) {
  const { t } = usePrefs();
  const choices: { key: RunMode; label: string }[] = [
    { key: 'auto', label: t.automatic },
    { key: 'manual', label: t.manual },
    { key: 'off', label: t.stopped },
  ];
  return (
    <div data-slot="mode-grid" className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
      {actions.map((action) => {
        const mode = (modes[action] ?? 'manual') as RunMode;
        return (
          <section
            key={action}
            className={cn(
              'relative grid justify-items-start gap-2.5 rounded-sm bg-surface p-4.5 inset-ring inset-ring-line',
              '[clip-path:polygon(0_0,calc(100%_-_var(--rd-cut))_0,100%_var(--rd-cut),100%_100%,0_100%)]',
              'rtl:[clip-path:polygon(var(--rd-cut)_0,100%_0,100%_100%,0_100%,0_var(--rd-cut))]',
              'max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:items-center max-sm:gap-x-2.5 max-sm:p-3.5',
              'motion-safe:animate-[rd-rise_420ms_var(--rd-ease-out)_both] motion-safe:nth-2:[animation-delay:40ms]',
              'motion-safe:nth-3:[animation-delay:80ms] motion-safe:nth-[n+4]:[animation-delay:120ms]',
              mode === 'off' && 'opacity-55',
            )}
            data-testid="mode-card"
          >
            <span className="grid size-9 place-items-center rounded-sm bg-accent-soft text-accent max-sm:size-7.5" aria-hidden="true">
              <Zap size={18} strokeWidth={1.9} />
            </span>
            <b className="text-[14.5px] font-bold">{names[action]}</b>
            {inherited ? (
              inherited.includes(action) ? (
                <span className={sourceClass} data-testid="mode-source">{t.inheritedFromProvider}</span>
              ) : (
                <span className={cn(sourceClass, 'text-accent')} data-testid="mode-source">
                  {t.ownMode}
                  {onInherit ? (
                    <button
                      type="button"
                      className="border-0 bg-transparent p-0 text-start text-inherit text-xs hover:underline"
                      disabled={disabled}
                      onClick={() => onInherit(action)}
                    >
                      {t.backToInherited}
                    </button>
                  ) : null}
                </span>
              )
            ) : null}
            <Segmented
              fill
              className="max-sm:col-span-full"
              aria-label={`${t.runTab} ${names[action]}`}
              value={mode}
              disabled={disabled}
              onValueChange={(next) => onChange(action, next as RunMode)}
            >
              {choices.map((choice) => (
                <SegmentedItem key={choice.key} value={choice.key} className="px-1.5 max-sm:h-10">
                  {choice.label}
                </SegmentedItem>
              ))}
            </Segmented>
          </section>
        );
      })}
    </div>
  );
}
