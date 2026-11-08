'use client';

import { ChevronDown, Lock } from 'lucide-react';
import { useState } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Dialog } from '../../../components/dialog';
import { Money } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { LinePricesDialog } from '../../../components/line-prices-dialog';
import { LiveSwitch } from '../../../components/live-switch';
import { TableSkeleton } from '../../../components/loading';
import { RowMenu, type RowAction } from '../../../components/row-menu';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { api, type UserPackageRow } from '../../../lib/api';
import { formatShekel, parseShekel, shekelField } from '../../../lib/money';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { termsTone } from '../../../lib/status-tone';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';

type Group = { code: string; name: string; packages: UserPackageRow[] };

/**
 * Every package on sale, grouped by company, as `login` sees and pays for it (spec 2026-11-08-user-packages-tab-redesign).
 * Each company folds; each package is one line with its switch, buy and sell prices, margin and what is special about
 * it. The price is changed from the row menu, in a dialog. The page shows errors through `setError`.
 */
export function UserPackagesTab({
  login,
  canEdit,
  setError,
  setNote,
}: {
  login: string;
  canEdit: boolean;
  setError: (text: string) => void;
  setNote: (text: string) => void;
}) {
  const { t, apiText } = usePrefs();
  const [needle, setNeedle] = useState('');
  const [company, setCompany] = useState('');
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<UserPackageRow | null>(null);
  const [pricing, setPricing] = useState<UserPackageRow | null>(null);
  const sheet = useApiQuery(sharedKeys.accountPackages(login), () => api.userPackages(login));
  const { run, busy } = useAction({ setError, setNote, onDone: sheet.reload });

  const needleText = needle.trim();
  const companies: Group[] = (sheet.data?.companies ?? [])
    .filter((group) => !company || group.code === company)
    .map((group) => ({
      ...group,
      packages: group.packages.filter((row) => !needleText || row.name.includes(needleText) || row.code.includes(needleText)),
    }))
    .filter((group) => group.packages.length > 0);
  const summary = sheet.data?.summary;
  // A search or a chosen company opens what it found; otherwise a company opens when its header is pressed.
  const isOpen = (code: string) => Boolean(needleText) || company === code || unfolded.has(code);

  function toggleGroup(code: string) {
    setUnfolded((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function save(row: UserPackageRow, body: { hidden?: boolean; price?: number | null; renewalPrice?: number | null }, then?: () => void) {
    return run(() => api.setUserPackage(login, row.code, body), { note: t.saved, then });
  }

  const summaryOf = (rows: UserPackageRow[]) => t.termsSummary
    .replace('{total}', String(rows.length))
    .replace('{visible}', String(rows.filter((row) => !row.hidden && !row.hiddenAbove).length))
    .replace('{custom}', String(rows.filter((row) => row.source === 'custom').length));

  const columns: Column<UserPackageRow>[] = [
    {
      key: 'package',
      header: t.packageName,
      render: (row) => (
        <span className="terms-name">
          <strong>{row.name}</strong>
          {row.dataGb === null ? null : <bdi dir="ltr" className="hint">{row.dataGb} GB</bdi>}
        </span>
      ),
    },
    { key: 'buy', header: t.buyPair, num: true, render: (row) => <PricePair first={row.parentBuy} second={row.parentRenewalBuy} /> },
    { key: 'sell', header: t.sellPair, num: true, render: (row) => <PricePair first={row.effective} second={row.renewalEffective} strong={row.source === 'custom'} /> },
    { key: 'margin', header: t.margin, num: true, render: (row) => <Money value={row.effective - row.parentBuy} signed /> },
    {
      key: 'state',
      header: t.status,
      render: (row) => {
        const locked = row.hiddenAbove !== null;
        const custom = row.source === 'custom';
        if (!locked && !row.hidden && !custom) return null;
        return (
          <Badge variant={termsTone({ locked, hidden: row.hidden, custom })} dot>
            {locked ? <><Lock aria-hidden="true" />{t.stoppedAbove}</> : row.hidden ? t.stopped : t.customPrice}
          </Badge>
        );
      },
    },
    {
      key: 'switch',
      header: <span className="sr-only">{t.status}</span>,
      fit: true,
      render: (row) => {
        const locked = row.hiddenAbove !== null;
        return (
          <LiveSwitch
            label={row.name}
            checked={!row.hidden && !locked}
            disabled={!canEdit || busy || locked}
            title={locked ? t.hiddenBy.replace('{login}', row.hiddenAbove ?? '') : undefined}
            onChange={(next) => void save(row, { hidden: !next })}
          />
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t.rowActions}</span>,
      actions: true,
      render: (row) => {
        const locked = row.hiddenAbove !== null;
        const items: RowAction[] = [
          ...(canEdit && !locked ? [{ label: t.editPrice, icon: 'edit' as const, onClick: () => setEditing(row) }] : []),
          ...(canEdit && !locked && row.source === 'custom'
            ? [{ label: t.resetDefault, icon: 'undo' as const, onClick: () => void save(row, { price: null, renewalPrice: null }) }]
            : []),
          // Numbers that already renewed under another price change only here, never by writing a price above.
          ...(canEdit && row.lines > 0 ? [{ label: t.linePricesMenu, icon: 'receipt' as const, onClick: () => setPricing(row) }] : []),
        ];
        return <RowMenu label={`${t.rowActions} ${row.name}`} items={items} />;
      },
    },
  ];

  return (
    <>
      <div className="filter-bar terms-filter">
        <div className="filter-panel">
          <label>
            {t.packageName}
            <input value={needle} onChange={(event) => setNeedle(event.target.value)} />
          </label>
          <label>
            {t.company}
            <Select value={company} onChange={(event) => setCompany(event.target.value)}>
              <option value="">{t.allRows}</option>
              {(sheet.data?.companies ?? []).map((group) => (
                <option key={group.code} value={group.code}>{group.name}</option>
              ))}
            </Select>
          </label>
          {summary ? (
            <span className="hint terms-summary">
              {t.termsSummary
                .replace('{total}', String(summary.total))
                .replace('{visible}', String(summary.visible))
                .replace('{custom}', String(summary.custom))}
            </span>
          ) : null}
          <Button type="button" variant="secondary" size="sm" className="filter-clear" onClick={() => { setNeedle(''); setCompany(''); }}>
            {t.clearFilters}
          </Button>
        </div>
      </div>
      <section className="pane">
        {!sheet.loaded ? (
          <TableSkeleton rows={5} columns={4} />
        ) : sheet.error ? (
          <EmptyState icon="plans">{sheet.error}</EmptyState>
        ) : companies.length === 0 ? (
          <EmptyState icon="plans">{t.noPackagesForUser}</EmptyState>
        ) : (
          <div className="sheet terms-sheet">
            {companies.map((group) => {
              const open = isOpen(group.code);
              const body = `terms-${group.code}`;
              return (
                <section key={group.code} className={open ? 'terms-group open' : 'terms-group'}>
                  <button type="button" className="terms-group-head" aria-expanded={open} aria-controls={body} onClick={() => toggleGroup(group.code)}>
                    <ChevronDown className="terms-chevron" aria-hidden="true" />
                    <strong>{group.name}</strong>
                    <span className="hint">{summaryOf(group.packages)}</span>
                  </button>
                  {open ? (
                    <div id={body} className="terms-rows">
                      <DataTable
                        bare
                        sortable={false}
                        columns={columns}
                        rows={group.packages}
                        rowKey={(row) => row.code}
                      />
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </section>
      {editing ? (
        <PriceDialog
          row={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(price, renewalPrice) => void save(editing, { price, renewalPrice }, () => setEditing(null))}
          onInvalid={() => setError(apiText('بيانات غير صالحة'))}
        />
      ) : null}
      <LinePricesDialog
        open={pricing !== null}
        code={pricing?.code ?? ''}
        packageName={pricing?.name ?? ''}
        scope={login}
        onClose={() => setPricing(null)}
        onSaved={(lines) => {
          setNote(t.linePricesSaved.replace('{n}', String(lines)));
          void sheet.reload();
        }}
      />
    </>
  );
}

function PricePair({ first, second, strong = false }: { first: number; second: number; strong?: boolean }) {
  return (
    // The pair follows the reading direction, like its header «اشتراك / تجديد»; each amount stays left to right.
    <span className={strong ? 'terms-pair custom' : 'terms-pair'}>
      <span className="money" dir="ltr">{formatShekel(first)}</span>
      <span className="terms-pair-sep" aria-hidden="true">/</span>
      <span className="money" dir="ltr">{formatShekel(second)}</span>
    </span>
  );
}

/** «تعديل السعر»: the sell prices of one package for this account. An empty field goes back to the default price. */
function PriceDialog({
  row,
  busy,
  onClose,
  onSave,
  onInvalid,
}: {
  row: UserPackageRow;
  busy: boolean;
  onClose: () => void;
  onSave: (price: number | null, renewalPrice: number | null) => void;
  onInvalid: () => void;
}) {
  const { t } = usePrefs();
  const shown = (value: number | null) => (value === null ? '' : shekelField(value));
  const [price, setPrice] = useState(shown(row.price));
  const [renewal, setRenewal] = useState(shown(row.renewalPrice));
  const read = (text: string) => (text.trim() === '' ? null : parseShekel(text));
  const priceValue = read(price);
  const renewalValue = read(renewal);
  const margin = (priceValue ?? (row.price === null ? row.effective : null)) ?? null;

  function submit() {
    if ((price.trim() !== '' && priceValue === null) || (renewal.trim() !== '' && renewalValue === null)) {
      onInvalid();
      return;
    }
    onSave(priceValue, renewalValue);
  }

  return (
    <Dialog
      open
      size="form"
      title={t.editPrice}
      lede={row.name}
      mark="wallet"
      closeLabel={t.cancel}
      onClose={onClose}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t.cancel}</Button>
          <Button type="button" disabled={busy} onClick={submit}>{t.save}</Button>
        </>
      )}
    >
      <div className="dialog-form terms-price-form">
        <p className="terms-price-buy">
          <span>{t.buyPair}</span>
          <PricePair first={row.parentBuy} second={row.parentRenewalBuy} />
        </p>
        <label>
          {t.subscriptionShort}
          <input inputMode="decimal" dir="ltr" value={price} placeholder={shown(row.effective)} onChange={(event) => setPrice(event.target.value)} />
        </label>
        <label>
          {t.renewalShort}
          <input inputMode="decimal" dir="ltr" value={renewal} placeholder={shown(row.renewalEffective)} onChange={(event) => setRenewal(event.target.value)} />
        </label>
        <p className="hint">{t.priceEmptyIsDefault}</p>
        {margin !== null ? (
          <p className="terms-price-buy">
            <span>{t.margin}</span>
            <Money value={margin - row.parentBuy} signed />
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
