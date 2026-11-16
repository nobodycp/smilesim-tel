'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { api } from '../../lib/api';
import type { PackageSheet } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { paneHintClass } from './sim-fields';

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

/*
 * The look (Tailwind migration T4.4, ADR 0022), ported from desk/components.css, pane.css, forms.css and graphite.css.
 * The fields sit in a pane body (the package page's tab, «إضافة رزمة»'s step 2):
 * - GB, minutes and messages: as many 12rem-or-wider columns as fit, 12px apart; each a grid 4px apart at the top
 *   holding its pane field and its «غير محدود» box;
 * - a box: a pane label laid out as a row, at least 36px high (44px under 721px);
 * - the extra details: the pane body's text area, its 42px height (forms.css) under its 72px minimum, so it opens at
 *   72px whatever its rows; its count a pane note;
 * - the tab's form (`PackageDetailsForm`): the pane body with `.pane form`'s 8px between rows, never wider than its
 *   column; its save at the start.
 */
const CHECK_ROW = 'm-0 flex min-h-9 cursor-pointer items-center max-touch:min-h-11';

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
export function DetailsFields({ draft, onChange, esim = true }: { draft: DetailsDraft; onChange: (next: DetailsDraft) => void; esim?: boolean }) {
  const { t } = usePrefs();
  const set = (patch: Partial<DetailsDraft>) => onChange({ ...draft, ...patch });
  const field = (label: string, key: 'dataGb' | 'minutes' | 'smsCount') => {
    const amount = draft[key];
    return (
      <div className="grid content-start gap-1">
        <Label tone="pane">
          {label}
          <Input
            surface="surface"
            className="text-md"
            inputMode="numeric"
            dir="ltr"
            value={amount.text}
            disabled={amount.unlimited}
            onChange={(event) => set({ [key]: { ...amount, text: event.target.value } })}
          />
        </Label>
        <Label tone="pane" className={CHECK_ROW}>
          <Checkbox checked={amount.unlimited} onCheckedChange={(next) => set({ [key]: { ...amount, unlimited: next === true } })} />
          <span>{t.unlimited}</span>
        </Label>
      </div>
    );
  };
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
        {field(t.dataGbLabel, 'dataGb')}
        {field(t.minutesLabel, 'minutes')}
        {field(t.smsLabel, 'smsCount')}
      </div>
      <Label tone="pane" className="content-start">
        {t.suspendAfterDays}
        <Input surface="surface" className="text-md" inputMode="numeric" dir="ltr" value={draft.suspendAfter} onChange={(event) => set({ suspendAfter: event.target.value })} />
        <span className={paneHintClass}>{t.suspendAfterHint}</span>
      </Label>
      {/* The package page has eSIM on its start tab (spec 2026-11-16-package-page, P.1); «إضافة رزمة» asks here. */}
      {esim ? (
        <>
          <Label tone="pane" className={CHECK_ROW}>
            <Checkbox checked={draft.esimAvailable} onCheckedChange={(next) => set({ esimAvailable: next === true })} />
            <span>{t.packageEsimAvailable}</span>
          </Label>
          <p className={paneHintClass}>{t.packageEsimHint}</p>
        </>
      ) : null}
      <Label tone="pane">
        {t.extraDetails}
        <Textarea className="h-10.5" rows={3} maxLength={DETAILS_LIMIT} value={draft.details} onChange={(event) => set({ details: event.target.value })} />
        <span className={paneHintClass} dir="ltr">{draft.details.trim().length} / {DETAILS_LIMIT}</span>
      </Label>
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
    // eSIM is saved by its own switch on the start tab: these details leave it as it is.
    const { esimAvailable: _esim, ...rest } = values;
    await run(() => api.setPackageDetails(sheet.code, rest), { note: t.saved });
  }

  return (
    // On the package page's start tab, inside its pane body (spec 2026-11-16-package-page, P.2).
    <form className="grid min-w-0 max-w-full content-start gap-2" data-testid="package-details-form" onSubmit={save}>
      <p className={paneHintClass}>{t.packageDetailsHint}</p>
      <DetailsFields draft={draft} onChange={setDraft} esim={false} />
      <div>
        <Button type="submit" disabled={busy}>{t.save}</Button>
      </div>
    </form>
  );
}
