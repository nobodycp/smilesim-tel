'use client';

import { Pencil } from 'lucide-react';
import { AccountName } from '../../components/account-name';
import { DataTable, type Column } from '../../components/data-table';
import { Money } from '../../components/desk';
import { Button } from '../../components/ui/button';
import { TableSheet } from '../../components/ui/table';
import { api, type LineAccountRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { useApiQuery } from '../../lib/use-api-query';
import { paneHintClass } from './sim-fields';

/**
 * The package page's «أرقام الحسابات» (spec 2026-11-16-package-page, P.3): every point of sale that holds numbers
 * on the package, how many it holds and how many are active, the renewal price it would pay today, and «تعديل
 * السعر», which opens the line-prices dialog for that account. The first line opens it for every account at once.
 */
export function PackageLineAccounts({ code, onReprice }: { code: string; onReprice: (scope: string) => void }) {
  const { t } = usePrefs();
  const read = useApiQuery(['api', 'package-line-accounts', code], () => api.packageLineAccounts(code));
  const rows = read.data?.accounts ?? [];

  const columns: Column<LineAccountRow>[] = [
    { key: 'account', header: t.layerPos, render: (row) => <AccountName login={row.loginName} name={row.nickname} /> },
    { key: 'parent', header: t.layerAgent, render: (row) => (row.parentLoginName ? <AccountName login={row.parentLoginName} name={row.parentNickname} /> : '—') },
    { key: 'lines', header: t.linesTotal, num: true, render: (row) => row.lines },
    { key: 'active', header: t.activeLines, num: true, render: (row) => row.activeLines },
    { key: 'price', header: t.lineAccountsPrice, num: true, render: (row) => <Money value={row.price} /> },
    {
      key: 'edit',
      header: '',
      actions: true,
      // A phone's card keeps the action in its corner: the icon alone there, the words from 641px.
      render: (row) => (
        <Button type="button" variant="secondary" size="sm" aria-label={t.lineAccountsEdit} onClick={() => onReprice(row.loginName)}>
          <Pencil size={15} aria-hidden="true" />
          <span className="max-sm:hidden">{t.lineAccountsEdit}</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="pane-body min-w-0 max-w-full" data-testid="reprice">
      <p className={paneHintClass}>{t.lineAccountsHint}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-lg font-bold text-ink">{t.repriceTitle}</h3>
        <Button type="button" variant="secondary" onClick={() => onReprice('all')}>{t.linePricesOpen}</Button>
      </div>
      <TableSheet>
        <DataTable bare columns={columns} rows={rows} rowKey={(row) => row.loginName} empty={read.loaded ? t.noLines : undefined} />
      </TableSheet>
    </div>
  );
}
