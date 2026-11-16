'use client';

import { useState } from 'react';
import { LiveSwitch } from '../../components/live-switch';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { api, type PackageSheet } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { paneHintClass } from './sim-fields';

/** The longest line that says what an offer is (the API's `OFFER_NOTE_LIMIT`). */
const NOTE_LIMIT = 60;

/**
 * The offer mark on the package page's start tab (spec 2026-11-16-package-page, P.7): a switch that shows the
 * package as «عرض» wherever it is picked, and, while it is on, a short line that says what the offer is («25 ₪ أول
 * شهر ثم 35 ₪»). A mark only: prices and renewals stay the package's own. The switch saves at once, the line with
 * its own button; both go through the details route with the other details as they are.
 */
export function PackageOffer({ sheet, canEdit, busy, run }: {
  sheet: PackageSheet;
  canEdit: boolean;
  busy: boolean;
  run: (work: () => ReturnType<typeof api.setPackageDetails>, options: { note: string }) => Promise<unknown>;
}) {
  const { t } = usePrefs();
  const stored = sheet.offerNote ?? '';
  const [note, setNote] = useState(stored);
  const on = sheet.offer ?? false;
  const save = (change: { offer?: boolean; offerNote?: string }) =>
    run(() => api.setPackageDetails(sheet.code, {
      dataGb: sheet.dataGb,
      smsCount: sheet.smsCount,
      minutes: sheet.minutes,
      details: sheet.details,
      suspendAfterDays: sheet.suspendAfterDays,
      ...change,
    }), { note: t.saved });

  return (
    <div className="grid min-w-0 gap-2.5" data-testid="package-offer">
      <LiveSwitch label={t.offerMark} checked={on} disabled={!canEdit || busy} onChange={(next) => void save({ offer: next })}>
        {t.offerMark}
      </LiveSwitch>
      <p className={paneHintClass}>{t.offerMarkHint}</p>
      {on ? (
        <div className="flex flex-wrap items-end gap-2 max-md:flex-col max-md:items-stretch">
          <Label tone="pane" className="min-w-0 max-w-88 grow basis-64 font-bold max-md:w-full max-md:max-w-none max-md:flex-none">
            {t.offerNote}
            <Input surface="surface" className="text-md" value={note} maxLength={NOTE_LIMIT} disabled={!canEdit} placeholder={t.offerNoteExample} onChange={(event) => setNote(event.target.value)} />
          </Label>
          {canEdit ? <Button type="button" className="max-md:self-start" disabled={busy || note.trim() === stored} onClick={() => void save({ offerNote: note.trim() })}>{t.save}</Button> : null}
        </div>
      ) : null}
    </div>
  );
}
