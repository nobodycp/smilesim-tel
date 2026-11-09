'use client';

import { Zap } from 'lucide-react';
import { usePrefs } from '../lib/prefs';

export type RunMode = 'auto' | 'manual' | 'off';

/**
 * How each operation runs, as cards (Graphite «طريقة التنفيذ», from design/night-desk-family): a crimson mark, the
 * operation's name and a three-way segmented control — automatic, a branch task, stopped. A stopped operation's card
 * dims. `onChange` saves at once.
 */
export function ModeCards<K extends string>({
  actions,
  names,
  modes,
  disabled,
  onChange,
}: {
  actions: readonly K[];
  names: Record<K, string>;
  modes: Partial<Record<K, string>>;
  disabled?: boolean;
  onChange: (action: K, mode: RunMode) => void;
}) {
  const { t } = usePrefs();
  const choices: { key: RunMode; label: string }[] = [
    { key: 'auto', label: t.automatic },
    { key: 'manual', label: t.manual },
    { key: 'off', label: t.stopped },
  ];
  return (
    <div className="mode-grid">
      {actions.map((action) => {
        const mode = (modes[action] ?? 'manual') as RunMode;
        return (
          <section key={action} className={mode === 'off' ? 'mode-card off' : 'mode-card'}>
            <span className="mode-mark" aria-hidden="true"><Zap size={18} strokeWidth={1.9} /></span>
            <b>{names[action]}</b>
            <div className="seg" role="radiogroup" aria-label={`${t.runTab} ${names[action]}`}>
              {choices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  role="radio"
                  aria-checked={mode === choice.key}
                  disabled={disabled}
                  onClick={() => mode !== choice.key && onChange(action, choice.key)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
