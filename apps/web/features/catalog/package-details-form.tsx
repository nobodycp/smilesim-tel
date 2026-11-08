'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import type { PackageSheet } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';

// The package page's «التفاصيل» tab (spec 2026-11-08-branch-packages-and-details): GB, minutes and messages — each a
// number, «غير محدود» (-1), or empty (not stated) — and up to 300 characters of extra details.

type Amount = { text: string; unlimited: boolean };
const amountOf = (value: number | null): Amount => ({ text: value === null || value === -1 ? '' : String(value), unlimited: value === -1 });
/** -1 for unlimited, null for empty, the number otherwise; undefined when the text is not a whole number. */
function valueOf(amount: Amount): number | null | undefined {
  if (amount.unlimited) return -1;
  const text = amount.text.trim();
  if (!text) return null;
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

const DETAILS_LIMIT = 300;

export function PackageDetailsForm({
  sheet,
  run,
  busy,
  onInvalid,
}: {
  sheet: PackageSheet;
  run: (work: () => ReturnType<typeof api.setPackageDetails>, options: { note: string }) => Promise<unknown>;
  busy: boolean;
  onInvalid: () => void;
}) {
  const { t } = usePrefs();
  const [dataGb, setDataGb] = useState(amountOf(sheet.dataGb));
  const [minutes, setMinutes] = useState(amountOf(sheet.minutes));
  const [smsCount, setSmsCount] = useState(amountOf(sheet.smsCount));
  const [details, setDetails] = useState(sheet.details);
  const [suspendAfter, setSuspendAfter] = useState(String(sheet.suspendAfterDays ?? 90));

  async function save(event: FormEvent) {
    event.preventDefault();
    const values = [valueOf(dataGb), valueOf(smsCount), valueOf(minutes)];
    const suspendDays = Number(suspendAfter.trim());
    if (values.some((value) => value === undefined) || details.trim().length > DETAILS_LIMIT || !Number.isInteger(suspendDays) || suspendDays < 1 || suspendDays > 3650) {
      onInvalid();
      return;
    }
    const [gb, sms, mins] = values as (number | null)[];
    await run(() => api.setPackageDetails(sheet.code, { dataGb: gb, smsCount: sms, minutes: mins, details: details.trim(), suspendAfterDays: suspendDays }), { note: t.saved });
  }

  const field = (label: string, amount: Amount, set: (next: Amount) => void) => (
    <div className="package-amount">
      <label>
        {label}
        <input
          className="num"
          inputMode="numeric"
          dir="ltr"
          value={amount.text}
          disabled={amount.unlimited}
          onChange={(event) => set({ ...amount, text: event.target.value })}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={amount.unlimited} onChange={(event) => set({ ...amount, unlimited: event.target.checked })} />
        <span>{t.unlimited}</span>
      </label>
    </div>
  );

  return (
    <form className="pane-body stack package-details-form" onSubmit={save}>
      <p className="hint">{t.packageDetailsHint}</p>
      <div className="package-amounts">
        {field(t.dataGbLabel, dataGb, setDataGb)}
        {field(t.minutesLabel, minutes, setMinutes)}
        {field(t.smsLabel, smsCount, setSmsCount)}
      </div>
      <label className="package-amount">
        {t.suspendAfterDays}
        <input className="num" inputMode="numeric" dir="ltr" value={suspendAfter} onChange={(event) => setSuspendAfter(event.target.value)} />
        <span className="hint">{t.suspendAfterHint}</span>
      </label>
      <label>
        {t.extraDetails}
        <textarea rows={3} maxLength={DETAILS_LIMIT} value={details} onChange={(event) => setDetails(event.target.value)} />
        <span className="hint" dir="ltr">{details.trim().length} / {DETAILS_LIMIT}</span>
      </label>
      <div>
        <Button type="submit" disabled={busy}>{t.save}</Button>
      </div>
    </form>
  );
}
