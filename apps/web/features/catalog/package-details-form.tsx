'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import type { PackageSheet } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';

// The package page's «التفاصيل» tab (spec 2026-11-08-branch-packages-and-details): GB, minutes and messages — each a
// number, «غير محدود» (-1), or empty (not stated) — and up to 300 characters of extra details. The fields are shared
// with «إضافة رزمة» (spec 2026-11-09-admin-review, 3): `DetailsFields` over a `DetailsDraft`.

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

export type DetailsDraft = { dataGb: Amount; minutes: Amount; smsCount: Amount; details: string; suspendAfter: string; esimAvailable: boolean };
export type DetailsValues = { dataGb: number | null; smsCount: number | null; minutes: number | null; details: string; suspendAfterDays: number; esimAvailable: boolean };

export function detailsDraft(values: { dataGb: number | null; smsCount: number | null; minutes: number | null; details?: string; suspendAfterDays?: number; esimAvailable?: boolean }): DetailsDraft {
  return {
    dataGb: amountOf(values.dataGb),
    minutes: amountOf(values.minutes),
    smsCount: amountOf(values.smsCount),
    details: values.details ?? '',
    suspendAfter: String(values.suspendAfterDays ?? 90),
    esimAvailable: values.esimAvailable ?? true,
  };
}

/** The values to send, or null when a field does not hold what it should. */
export function readDetails(draft: DetailsDraft): DetailsValues | null {
  const values = [valueOf(draft.dataGb), valueOf(draft.smsCount), valueOf(draft.minutes)];
  const suspendDays = Number(draft.suspendAfter.trim());
  if (values.some((value) => value === undefined) || draft.details.trim().length > DETAILS_LIMIT || !Number.isInteger(suspendDays) || suspendDays < 1 || suspendDays > 3650) return null;
  const [dataGb, smsCount, minutes] = values as (number | null)[];
  return { dataGb, smsCount, minutes, details: draft.details.trim(), suspendAfterDays: suspendDays, esimAvailable: draft.esimAvailable };
}

/** GB, minutes and messages, the suspension period, eSIM and the extra details. */
export function DetailsFields({ draft, onChange }: { draft: DetailsDraft; onChange: (next: DetailsDraft) => void }) {
  const { t } = usePrefs();
  const set = (patch: Partial<DetailsDraft>) => onChange({ ...draft, ...patch });
  const field = (label: string, key: 'dataGb' | 'minutes' | 'smsCount') => {
    const amount = draft[key];
    return (
      <div className="package-amount">
        <label>
          {label}
          <input
            className="num"
            inputMode="numeric"
            dir="ltr"
            value={amount.text}
            disabled={amount.unlimited}
            onChange={(event) => set({ [key]: { ...amount, text: event.target.value } })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={amount.unlimited} onChange={(event) => set({ [key]: { ...amount, unlimited: event.target.checked } })} />
          <span>{t.unlimited}</span>
        </label>
      </div>
    );
  };
  return (
    <>
      <div className="package-amounts">
        {field(t.dataGbLabel, 'dataGb')}
        {field(t.minutesLabel, 'minutes')}
        {field(t.smsLabel, 'smsCount')}
      </div>
      <label className="package-amount">
        {t.suspendAfterDays}
        <input className="num" inputMode="numeric" dir="ltr" value={draft.suspendAfter} onChange={(event) => set({ suspendAfter: event.target.value })} />
        <span className="hint">{t.suspendAfterHint}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.esimAvailable} onChange={(event) => set({ esimAvailable: event.target.checked })} />
        <span>{t.packageEsimAvailable}</span>
      </label>
      <p className="hint">{t.packageEsimHint}</p>
      <label>
        {t.extraDetails}
        <textarea rows={3} maxLength={DETAILS_LIMIT} value={draft.details} onChange={(event) => set({ details: event.target.value })} />
        <span className="hint" dir="ltr">{draft.details.trim().length} / {DETAILS_LIMIT}</span>
      </label>
    </>
  );
}

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
  const [draft, setDraft] = useState(() => detailsDraft(sheet));

  async function save(event: FormEvent) {
    event.preventDefault();
    const values = readDetails(draft);
    if (!values) {
      onInvalid();
      return;
    }
    await run(() => api.setPackageDetails(sheet.code, values), { note: t.saved });
  }

  return (
    <form className="pane-body stack package-details-form" onSubmit={save}>
      <p className="hint">{t.packageDetailsHint}</p>
      <DetailsFields draft={draft} onChange={setDraft} />
      <div>
        <Button type="submit" disabled={busy}>{t.save}</Button>
      </div>
    </form>
  );
}
