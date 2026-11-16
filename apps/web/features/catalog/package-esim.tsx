'use client';

import { useState } from 'react';
import { LiveSwitch } from '../../components/live-switch';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { api, type PackageSheet } from '../../lib/api';
import { formatShekel, parseShekel, shekelField } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';
import { paneHintClass } from './sim-fields';

/**
 * eSIM on the package page's start tab (spec 2026-11-16-package-page, P.1): a switch for «الرزمة متاحة كـ eSIM», and,
 * while it is on, the eSIM price in the same place with the price that holds now and where it comes from. The
 * switch saves at once through the details route (the other details go back as they are); the price has its own
 * save through the chain route, and an empty field means the inherited price.
 */
export function PackageEsim({ sheet, canEdit, busy, run, onInvalid }: {
  sheet: PackageSheet;
  canEdit: boolean;
  busy: boolean;
  run: (work: () => ReturnType<typeof api.setChain>, options: { note: string }) => Promise<unknown>;
  onInvalid: () => void;
}) {
  const { t } = usePrefs();
  const stored = sheet.esimPrice === null ? '' : shekelField(sheet.esimPrice);
  const [price, setPrice] = useState(stored);
  const available = sheet.esimAvailable ?? true;
  const source = sheet.esimPriceSource === 'package' ? t.esimSourcePackage : sheet.esimPriceSource === 'provider' ? t.esimSourceProvider : t.esimSourceCompany;

  const setAvailable = (next: boolean) =>
    run(() => api.setPackageDetails(sheet.code, {
      dataGb: sheet.dataGb,
      smsCount: sheet.smsCount,
      minutes: sheet.minutes,
      details: sheet.details,
      suspendAfterDays: sheet.suspendAfterDays,
      esimAvailable: next,
    }), { note: t.saved });

  async function savePrice() {
    const next = price.trim() ? parseShekel(price) : null;
    if (price.trim() && next === null) {
      onInvalid();
      return;
    }
    await run(() => api.setChain(sheet.code, { esimPrice: next }), { note: t.saved });
  }

  return (
    <div className="grid min-w-0 gap-2.5" data-testid="package-esim">
      <LiveSwitch label={t.packageEsimAvailable} checked={available} disabled={!canEdit || busy} onChange={(next) => void setAvailable(next)}>
        {t.packageEsimAvailable}
      </LiveSwitch>
      <p className={paneHintClass}>{t.packageEsimHint}</p>
      {available ? (
        <>
          {/* The field and its save on one line, the price that holds now under them. */}
          <div className="flex flex-wrap items-end gap-2 max-md:flex-col max-md:items-stretch">
            <Label tone="pane" className="min-w-0 max-w-88 grow basis-64 font-bold max-md:w-full max-md:max-w-none max-md:flex-none">
              {t.esimPrice}
              <Input
                surface="surface"
                className="text-md"
                inputMode="decimal"
                dir="ltr"
                value={price}
                disabled={!canEdit}
                placeholder={t.useInheritedPrice}
                onChange={(event) => setPrice(event.target.value)}
              />
            </Label>
            {canEdit ? <Button type="button" className="max-md:self-start" disabled={busy || price === stored} onClick={() => void savePrice()}>{t.save}</Button> : null}
          </div>
          <p className={paneHintClass}>
            {t.esimPriceFrom.replace('{price}', formatShekel(sheet.esimPriceEffective)).replace('{source}', source)}
          </p>
        </>
      ) : null}
    </div>
  );
}
