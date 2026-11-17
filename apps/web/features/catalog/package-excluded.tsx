'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AccountName, accountLabel } from '../../components/account-name';
import { DataTable, type Column } from '../../components/data-table';
import { NameField } from '../../components/name-field';
import { layerName } from '../../components/names';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { TableSheet } from '../../components/ui/table';
import { api, type HiddenAccountRow } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { packageKeys } from '../../lib/query';
import { useAction } from '../../lib/use-action';
import { useApiQuery } from '../../lib/use-api-query';
import { paneHintClass } from './sim-fields';

const ACCOUNT_LINK = 'font-semibold text-accent no-underline hover:underline';

/**
 * The package page's «المستثنون» (spec 2026-11-16-package-page, P.9): the accounts this package is hidden from.
 * Naming an account hides the package from it and from everyone under it: none of them sees it on the shelf, starts
 * a number on it, or switches a number to it; the numbers already on it stay and renew. The same switch is on the
 * account's own «الرزم والأسعار», where each name here leads.
 */
export function PackageExcluded({
  code,
  users,
  setError,
  setNote,
}: {
  code: string;
  users: { loginName: string; nickname: string; layer: string }[];
  setError: (text: string) => void;
  setNote: (text: string) => void;
}) {
  const { t } = usePrefs();
  const [loginName, setLoginName] = useState('');
  const client = useQueryClient();
  const read = useApiQuery(packageKeys.hiddenAccounts(code), () => api.packageHiddenAccounts(code));
  const rows = read.data?.accounts ?? [];
  const listed = new Set(rows.map((row) => row.loginName));
  // The accounts' own pages read the same switch (the one named and everyone under it), so their cached sheets go stale.
  const { run, busy } = useAction({
    setError,
    setNote,
    onDone: () => {
      void read.reload();
      void client.invalidateQueries({ queryKey: ['api', 'account'] });
    },
  });

  const setHidden = (login: string, hidden: boolean, then?: () => void) =>
    run(() => api.setUserPackage(login, code, { hidden }), { note: t.saved, then });

  const columns: Column<HiddenAccountRow>[] = [
    {
      key: 'account',
      header: t.accountName,
      render: (row) => (
        <Link className={ACCOUNT_LINK} href={`/users/${encodeURIComponent(row.loginName)}#packages`}>
          <AccountName login={row.loginName} name={row.nickname} />
        </Link>
      ),
    },
    { key: 'layer', header: t.layer, fit: true, render: (row) => layerName(t, row.layer) },
    { key: 'parent', header: t.parent, fit: true, render: (row) => (row.parentLoginName ? <bdi dir="ltr">{row.parentLoginName}</bdi> : '—') },
    { key: 'below', header: t.excludedBelow, num: true, render: (row) => row.below },
    {
      key: 'show',
      header: '',
      actions: true,
      render: (row) => (
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void setHidden(row.loginName, false)}>
          {t.excludedShow}
        </Button>
      ),
    },
  ];

  return (
    <div className="pane-body min-w-0 max-w-full" data-testid="excluded">
      <div className="grid min-w-0 grid-cols-[minmax(12rem,28rem)_auto] items-end justify-start gap-2.5 max-sm:grid-cols-1">
        <Label tone="pane" className="min-w-0 font-bold">
          {t.accountName}
          <NameField
            value={loginName}
            onChange={setLoginName}
            options={users
              .filter((row) => !listed.has(row.loginName))
              .map((row) => ({ value: row.loginName, label: accountLabel(row.loginName, row.nickname), hint: layerName(t, row.layer), keys: [row.loginName] }))}
          />
        </Label>
        <Button type="button" className="px-3.5 text-sm leading-5 font-bold" disabled={!loginName || busy} onClick={() => void setHidden(loginName, true, () => setLoginName(''))}>
          {t.excludedAdd}
        </Button>
      </div>
      <p className={paneHintClass}>{t.excludedHint}</p>
      <TableSheet>
        <DataTable bare columns={columns} rows={rows} rowKey={(row) => row.loginName} empty={read.loaded ? t.excludedNone : undefined} />
      </TableSheet>
    </div>
  );
}
