'use client';

import { Segmented, SegmentedItem } from './ui/segmented';
import type { ActivationKind } from '../lib/api';
import { usePrefs } from '../lib/prefs';

/** How a number is activated: a new one, or one of the two the package may offer. */
export type ActivationChoice = 'new' | ActivationKind;

/** The kind a package can take: the one picked if the package offers it, else none (an ordinary activation). */
export function offeredKind(choice: ActivationChoice, pkg: { canPort?: boolean; canConvert?: boolean } | null | undefined): ActivationKind | null {
  if (choice === 'port' && pkg?.canPort) return 'port';
  if (choice === 'convert' && pkg?.canConvert) return 'convert';
  return null;
}

/**
 * The choice between a new number, a porting and a card-to-bill conversion in an activation form (spec
 * 2026-11-16-package-page, P.5). Shown only for a package that offers one of the two; a kind takes the number and
 * the serial, so the form asks for both and offers no eSIM.
 */
export function ActivationKindChoice({ value, onChange, pkg }: {
  value: ActivationChoice;
  onChange: (next: ActivationChoice) => void;
  pkg: { canPort?: boolean; canConvert?: boolean };
}) {
  const { t } = usePrefs();
  if (!pkg.canPort && !pkg.canConvert) return null;
  return (
    <Segmented fill value={offeredKind(value, pkg) ?? 'new'} onValueChange={(next) => onChange(next as ActivationChoice)} aria-label={t.activationKind} data-testid="activation-kind">
      <SegmentedItem value="new">{t.activationNew}</SegmentedItem>
      {pkg.canPort ? <SegmentedItem value="port">{t.activationPort}</SegmentedItem> : null}
      {pkg.canConvert ? <SegmentedItem value="convert">{t.activationConvert}</SegmentedItem> : null}
    </Segmented>
  );
}
