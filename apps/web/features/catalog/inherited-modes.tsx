'use client';

import { ModeCards, type RunMode } from '../../components/mode-cards';
import { usePrefs } from '../../lib/prefs';

export const PACKAGE_ACTIONS = ['activate', 'charge', 'extend', 'disconnect', 'freeze', 'switch', 'rename', 'sim', 'companySwitch'] as const;
export type PackageAction = (typeof PACKAGE_ACTIONS)[number];

/** Each operation's name, as the provider page names them. */
export function useActionNames(): Record<PackageAction, string> {
  const { t } = usePrefs();
  return {
    activate: t.actActivate,
    charge: t.actCharge,
    extend: t.extend,
    disconnect: t.actDisconnect,
    freeze: `${t.freeze} / ${t.unfreeze}`,
    switch: t.actSwitch,
    rename: t.changeNumber,
    sim: t.swapSim,
    companySwitch: t.actCompanySwitch,
  };
}

/**
 * A package's run modes, folded (spec 2026-11-09-admin-review, 3): the summary says how many follow the provider and
 * how many are the package's own; opened, one card per operation with its source and «رجوع للموروث». Closed until
 * opened, unless some mode is the package's own — then the owner sees what differs from the provider at once.
 */
export function InheritedModes({ modes, inherited, disabled, onChange }: {
  modes: Partial<Record<string, string>>;
  inherited: readonly string[];
  disabled?: boolean;
  onChange: (action: PackageAction, mode: RunMode | 'inherit') => void;
}) {
  const { t } = usePrefs();
  const names = useActionNames();
  const following = PACKAGE_ACTIONS.filter((action) => inherited.includes(action)).length;
  const own = PACKAGE_ACTIONS.length - following;
  return (
    <details className="inherit-fold" open={own > 0 ? true : undefined}>
      <summary>
        <b>{t.howItRuns}</b>
        <span>{t.modesSummary.replace('{inherited}', String(following)).replace('{own}', String(own))}</span>
      </summary>
      <div className="inherit-body">
        <p className="hint">{t.modesInheritHint}</p>
        <ModeCards
          actions={PACKAGE_ACTIONS}
          names={names}
          modes={modes}
          disabled={disabled}
          inherited={inherited}
          onChange={(action, mode) => onChange(action, mode)}
          onInherit={(action) => onChange(action, 'inherit')}
        />
      </div>
    </details>
  );
}
