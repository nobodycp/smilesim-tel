'use client';

import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '../../components/data-table';
import { Money } from '../../components/desk';
import { EmptyState } from '../../components/empty-state';
import { LiveSwitch } from '../../components/live-switch';
import { PriceField } from '../../components/price-field';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { api, type PackageAddon } from '../../lib/api';
import { parseShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';
import { useAction } from '../../lib/use-action';
import { useApiQuery } from '../../lib/use-api-query';
import { paneHintClass } from './sim-fields';

/*
 * The look (ADR 0022): the tab's body
 * is a pane body never wider than its column; the add form one wrapping row at the foot of its fields, 8px apart
 * (`.pane form`'s gap), each field a pane label growing from 16rem up to 22rem; under 768px a column, the fields across
 * it at their own height and the button at the start.
 */
const ADD_FORM = 'flex flex-wrap content-start items-end justify-start gap-2 max-md:flex-col max-md:items-stretch';
const ADD_FIELD = 'min-w-0 max-w-88 grow basis-64 max-md:w-full max-md:max-w-none max-md:flex-none';

/**
 * The package page's «العمليات الإضافية» (spec 2026-11-09-offers-tasks-addons-wallet-esim, 3): extra operations named
 * by hand, each with the price the point of sale pays. A number on this package asks for one from its card, and
 * it becomes a manual task.
 */
export function PackageAddons({ code, canEdit, setError, setNote }: { code: string; canEdit: boolean; setError: (text: string) => void; setNote: (text: string) => void }) {
  const { t, apiText } = usePrefs();
  const read = useApiQuery(['api', 'package-addons', code], () => api.packageAddons(code));
  const { run, busy } = useAction({ setError, setNote, onDone: read.reload });
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const rows = read.data?.addons ?? [];

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = price.trim() ? parseShekel(price) : 0;
    if (!name.trim() || value === null) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    await run(() => api.addPackageAddon(code, { name: name.trim(), price: value }), { note: t.saved, then: () => { setName(''); setPrice(''); } });
  }

  const columns: Column<PackageAddon>[] = [
    { key: 'name', header: t.addonName, render: (row) => row.name },
    {
      key: 'price',
      header: t.price,
      num: true,
      render: (row) => (canEdit
        ? (
          <PriceField
            value={row.price}
            placeholder={0}
            label={`${t.price} ${row.name}`}
            onSave={(text) => {
              const next = text.trim() ? parseShekel(text) : 0;
              if (next === null) setError(apiText('بيانات غير صالحة'));
              else void run(() => api.savePackageAddon(code, row.id, { price: next }), { note: t.saved });
            }}
          />
        )
        : <Money value={row.price} />),
    },
    {
      key: 'active',
      header: t.status,
      fit: true,
      render: (row) => (
        <LiveSwitch
          checked={row.active}
          label={row.name}
          disabled={!canEdit || busy}
          onChange={(next) => run(() => api.savePackageAddon(code, row.id, { active: next }), { note: t.saved })}
        />
      ),
    },
    ...(canEdit ? [{
      key: 'remove',
      header: '',
      actions: true,
      render: (row: PackageAddon) => (
        <Button type="button" variant="secondary" size="sm" disabled={busy} aria-label={`${t.deleteAccount} ${row.name}`} onClick={() => run(() => api.removePackageAddon(code, row.id), { note: t.saved })}>
          <Trash2 size={15} aria-hidden="true" />
        </Button>
      ),
    }] : []),
  ];

  return (
    <div className="pane-body min-w-0 max-w-full">
      <p className={paneHintClass}>{t.addonsHint}</p>
      {rows.length === 0 && read.loaded ? <EmptyState>{t.noAddons}</EmptyState> : <DataTable bare columns={columns} rows={rows} rowKey={(row) => row.id} />}
      {canEdit ? (
        <form className={ADD_FORM} onSubmit={add}>
          <Label tone="pane" className={ADD_FIELD}>
            {t.addonName}
            <Input surface="surface" className="text-md" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </Label>
          <Label tone="pane" className={ADD_FIELD}>
            {t.price}
            <Input surface="surface" className="text-md" inputMode="decimal" dir="ltr" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0" />
          </Label>
          <Button type="submit" className="max-md:self-start" disabled={busy || !name.trim()}>{t.addAddon}</Button>
        </form>
      ) : null}
    </div>
  );
}
