'use client';

import { ModeCards, type RunMode } from '../../components/mode-cards';
import { cn } from '../../lib/cn';
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

/*
 * The fold's look (ADR 0022): a 1px `--rd-line` box
 * with 6px corners on `--rd-surface`. Its summary is one wrapping row, 6px by 12px apart, 12px by 14px inside, with no
 * browser marker: the title 13px ink, the count 12px `--rd-muted`, and at the end an 8px chevron drawn by two 2px
 * `--rd-muted` sides, pointing down while closed and up while open. The body is a grid 12px apart, 14px inside at the
 * sides and foot; its note (in a pane on every caller) is 12px `--rd-muted` with no margin.
 */
const SUMMARY = cn(
  'flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1.5 px-3.5 py-3 [&::-webkit-details-marker]:hidden',
  "after:ms-auto after:size-2 after:self-center after:rotate-45 after:border-e-2 after:border-b-2 after:border-muted after:content-['']",
  '[[open]>&]:after:rotate-225',
);

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
    <details className="rounded-sm border border-line bg-surface" data-testid="inherit-fold" open={own > 0 ? true : undefined}>
      <summary className={SUMMARY}>
        <b className="text-md text-ink">{t.howItRuns}</b>
        <span className="text-sm text-muted">{t.modesSummary.replace('{inherited}', String(following)).replace('{own}', String(own))}</span>
      </summary>
      <div className="grid gap-3 px-3.5 pb-3.5">
        <p className="m-0 text-sm text-muted">{t.modesInheritHint}</p>
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
