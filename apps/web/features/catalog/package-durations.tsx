'use client';

import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '../../components/data-table';
import { Money } from '../../components/desk';
import { LiveSwitch } from '../../components/live-switch';
import { PriceField } from '../../components/price-field';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectItem } from '../../components/ui/select';
import { TableSheet } from '../../components/ui/table';
import { api, type PackageDuration } from '../../lib/api';
import type { Copy } from '../../lib/copy';
import { parseShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';
import { paneHintClass } from './sim-fields';

/* The add form is the add-ons tab's (package-addons.tsx): one wrapping row at the foot of its fields, a column under 768px. */
const ADD_FORM = 'flex flex-wrap content-start items-end justify-start gap-2 max-md:flex-col max-md:items-stretch';
const ADD_FIELD = 'min-w-0 max-w-44 grow basis-28 max-md:w-full max-md:max-w-none max-md:flex-none';

const PRICE_KEYS = ['branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice'] as const;
type PriceKey = (typeof PRICE_KEYS)[number];
type Ladder = Record<PriceKey, number>;
const EMPTY: Record<PriceKey, string> = { branchCost: '', mainPrice: '', agentPrice: '', posPrice: '', subscriberPrice: '' };

/** A duration in words: «شهر», «شهران», «3 أشهر», «5 يوم». */
export function durationText(t: Copy, unit: string, count: number): React.ReactNode {
  if (unit === 'month' && count === 1) return t.monthOne;
  if (unit === 'month' && count === 2) return t.monthTwo;
  // The number and its word stay on one line, also in a phone card's narrow title.
  return <span className="whitespace-nowrap"><span>{count}</span> {unit === 'month' ? t.months : t.dayUnit}</span>;
}

/**
 * The package page's «المدد» (spec 2026-11-15-package-durations-and-deals, plan D.3b): the durations the package is
 * renewed for, each with its own price for every layer. The package's own duration is its renewal ladder: it has no
 * switch and no delete. The same unit and count again replaces the prices.
 */
export function PackageDurations({ code, months, durations, canEdit, busy, run, onInvalid }: {
  code: string;
  months: number;
  durations: PackageDuration[];
  canEdit: boolean;
  busy: boolean;
  run: (work: () => ReturnType<typeof api.savePackageDuration>, options: { note: string; then?: () => void }) => Promise<unknown>;
  onInvalid: () => void;
}) {
  const { t } = usePrefs();
  const [unit, setUnit] = useState<'month' | 'day'>('month');
  const [count, setCount] = useState('');
  const [draft, setDraft] = useState(EMPTY);
  const labels: Record<PriceKey, string> = { branchCost: t.branchCost, mainPrice: t.layerMain, agentPrice: t.layerAgent, posPrice: t.layerPos, subscriberPrice: t.subscriberPrice };
  const own = (row: PackageDuration) => row.unit === 'month' && row.count === Math.max(1, months);
  const ladderOf = (row: PackageDuration): Ladder => ({ branchCost: row.branchCost, mainPrice: row.mainPrice, agentPrice: row.agentPrice, posPrice: row.posPrice, subscriberPrice: row.subscriberPrice });
  const save = (row: PackageDuration, change: Partial<Ladder> & { enabled?: boolean }) =>
    run(() => api.savePackageDuration(code, { unit: row.unit, count: row.count, ...ladderOf(row), ...change }), { note: t.saved });

  async function add(event: FormEvent) {
    event.preventDefault();
    const length = Number(count);
    const ladder = Object.fromEntries(PRICE_KEYS.map((key) => [key, parseShekel(draft[key])])) as Record<PriceKey, number | null>;
    if (!Number.isInteger(length) || length < 1 || PRICE_KEYS.some((key) => !draft[key].trim() || ladder[key] === null)) {
      onInvalid();
      return;
    }
    await run(() => api.savePackageDuration(code, { unit, count: length, ...(ladder as Ladder) }), { note: t.saved, then: () => { setCount(''); setDraft(EMPTY); } });
  }

  const columns: Column<PackageDuration>[] = [
    { key: 'duration', header: t.durationLabel, render: (row) => durationText(t, row.unit, row.count) },
    ...PRICE_KEYS.map((key): Column<PackageDuration> => ({
      key,
      header: labels[key],
      num: true,
      render: (row) => (canEdit
        ? (
          <PriceField
            value={row[key]}
            placeholder={0}
            label={labels[key]}
            disabled={busy}
            onSave={(text) => {
              const next = text.trim() ? parseShekel(text) : null;
              if (next === null) onInvalid();
              else if (next !== row[key]) void save(row, { [key]: next });
            }}
          />
        )
        : <Money value={row[key]} />),
    })),
    {
      key: 'enabled',
      header: t.status,
      fit: true,
      render: (row) => (own(row)
        ? <span className="text-sm font-medium text-muted">{t.durationOwn}</span>
        : <LiveSwitch checked={row.enabled} label={t.durationLabel} disabled={!canEdit || busy} onChange={(next) => save(row, { enabled: next })} />),
    },
    ...(canEdit ? [{
      key: 'remove',
      header: '',
      actions: true,
      render: (row: PackageDuration) => (own(row) ? null : (
        <Button type="button" variant="secondary" size="sm" disabled={busy} aria-label={t.durationRemove} onClick={() => run(() => api.removePackageDuration(code, row.id), { note: t.saved })}>
          <Trash2 size={15} aria-hidden="true" />
        </Button>
      )),
    }] : []),
  ];

  return (
    <div className="pane-body min-w-0 max-w-full">
      <p className={paneHintClass}>{t.durationsHint}</p>
      {/* The table scrolls sideways by itself when it is wider than the pane, as the special-prices tab's does. */}
      <TableSheet>
        <DataTable bare columns={columns} rows={durations} rowKey={(row) => row.id} />
      </TableSheet>
      {canEdit ? (
        <form className={ADD_FORM} onSubmit={add}>
          <Label tone="pane" className={ADD_FIELD}>
            {t.durationUnit}
            <Select value={unit} onValueChange={(next) => setUnit(next === 'day' ? 'day' : 'month')}>
              <SelectItem value="month">{t.periodTabMonth}</SelectItem>
              <SelectItem value="day">{t.periodTabDay}</SelectItem>
            </Select>
          </Label>
          <Label tone="pane" className={ADD_FIELD}>
            {t.durationCount}
            <Input surface="surface" className="text-md" inputMode="numeric" dir="ltr" value={count} maxLength={4} onChange={(event) => setCount(event.target.value.replace(/\D/g, ''))} placeholder="1" />
          </Label>
          {PRICE_KEYS.map((key) => (
            <Label key={key} tone="pane" className={ADD_FIELD}>
              {labels[key]}
              <Input surface="surface" className="text-md" inputMode="decimal" dir="ltr" value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} placeholder="0" />
            </Label>
          ))}
          <Button type="submit" className="max-md:self-start" disabled={busy || !count}>{t.durationAdd}</Button>
        </form>
      ) : null}
    </div>
  );
}
