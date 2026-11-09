'use client';

import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '../../components/data-table';
import { Money } from '../../components/desk';
import { EmptyState } from '../../components/empty-state';
import { LiveSwitch } from '../../components/live-switch';
import { PriceField } from '../../components/price-field';
import { Button } from '../../components/ui/button';
import { api, type PackageAddon } from '../../lib/api';
import { parseShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';
import { useAction } from '../../lib/use-action';
import { useApiQuery } from '../../lib/use-api-query';

/**
 * The package page's «العمليات الإضافية» (spec 2026-11-09-offers-tasks-addons-wallet-esim, 3): extra operations named
 * by hand, each with the price the point of sale pays. A number on this package asks for one from its card, and
 * it becomes a manual task.
 */
export function PackageAddons({ code, canEdit, setError, setNote }: { code: string; canEdit: boolean; setError: (text: string) => void; setNote: (text: string) => void }) {
  const { t, apiText } = usePrefs();
  const read = useApiQuery(['office', 'package-addons', code], () => api.packageAddons(code));
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
        <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`${t.deleteAccount} ${row.name}`} onClick={() => run(() => api.removePackageAddon(code, row.id), { note: t.saved })}>
          <Trash2 size={15} aria-hidden="true" />
        </Button>
      ),
    }] : []),
  ];

  return (
    <div className="pane-body stack">
      <p className="hint">{t.addonsHint}</p>
      {rows.length === 0 && read.loaded ? <EmptyState>{t.noAddons}</EmptyState> : <DataTable bare columns={columns} rows={rows} rowKey={(row) => row.id} />}
      {canEdit ? (
        <form className="field-row" onSubmit={add}>
          <label>
            {t.addonName}
            <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            {t.price}
            <input className="num" inputMode="decimal" dir="ltr" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0" />
          </label>
          <Button type="submit" disabled={busy || !name.trim()}>{t.addAddon}</Button>
        </form>
      ) : null}
    </div>
  );
}
