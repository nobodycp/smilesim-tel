'use client';

import { LiveSwitch } from '../../components/live-switch';
import { Segmented, SegmentedItem } from '../../components/ui/segmented';
import { api, type ActivationKindMode, type PackageSheet } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { paneHintClass } from './sim-fields';

/**
 * Porting and card-to-bill on the package page's start tab (spec 2026-11-16-package-page, P.5): each is a switch,
 * off for every package until the branch turns it on, and, while on, the choice of where a request goes: a branch
 * task, or directly to the provider. Turning one on starts it as a branch task. Each change saves at once.
 */
export function PackageActivationKinds({ sheet, canEdit, busy, run }: {
  sheet: PackageSheet;
  canEdit: boolean;
  busy: boolean;
  run: (work: () => ReturnType<typeof api.setPackageMode>, options: { note: string }) => Promise<unknown>;
}) {
  const { t } = usePrefs();
  const rows = [
    { key: 'portMode', label: t.activationPort, mode: sheet.portMode ?? 'off' },
    { key: 'convertMode', label: t.activationConvert, mode: sheet.convertMode ?? 'off' },
  ] as const;
  const save = (key: 'portMode' | 'convertMode', mode: ActivationKindMode) => run(() => api.setPackageMode(sheet.code, { [key]: mode }), { note: t.saved });

  return (
    <div className="grid min-w-0 gap-2.5" data-testid="package-activation-kinds">
      <h3 className="m-0 text-lg font-bold text-ink">{t.activationKindsTitle}</h3>
      <p className={paneHintClass}>{t.activationKindsHint}</p>
      {rows.map((row) => (
        <div key={row.key} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft pb-2" data-testid={`kind-${row.key}`}>
          <LiveSwitch label={row.label} checked={row.mode !== 'off'} disabled={!canEdit || busy} onChange={(next) => void save(row.key, next ? 'manual' : 'off')}>
            {row.label}
          </LiveSwitch>
          {row.mode !== 'off' ? (
            <Segmented value={row.mode} disabled={!canEdit || busy} aria-label={`${t.kindModeLabel} · ${row.label}`} onValueChange={(next) => void save(row.key, next === 'auto' ? 'auto' : 'manual')}>
              <SegmentedItem value="manual">{t.kindModeManual}</SegmentedItem>
              <SegmentedItem value="auto">{t.kindModeAuto}</SegmentedItem>
            </Segmented>
          ) : null}
        </div>
      ))}
    </div>
  );
}
