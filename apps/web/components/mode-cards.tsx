'use client';

import { Zap } from 'lucide-react';
import { usePrefs } from '../lib/prefs';

export type RunMode = 'auto' | 'manual' | 'off';

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
    <div className="mode-grid">
      {actions.map((action) => {
        const mode = (modes[action] ?? 'manual') as RunMode;
        return (
          <section key={action} className={mode === 'off' ? 'mode-card off' : 'mode-card'}>
            <span className="mode-mark" aria-hidden="true"><Zap size={18} strokeWidth={1.9} /></span>
            <b>{names[action]}</b>
            {inherited ? (
              inherited.includes(action) ? (
                <span className="mode-source inherited">{t.inheritedFromProvider}</span>
              ) : (
                <span className="mode-source own">
                  {t.ownMode}
                  {onInherit ? (
                    <button type="button" className="link-btn" disabled={disabled} onClick={() => onInherit(action)}>{t.backToInherited}</button>
                  ) : null}
                </span>
              )
            ) : null}
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
