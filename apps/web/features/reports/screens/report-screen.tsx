'use client';

import { useParams } from 'next/navigation';
import { AccountName } from '../../../components/account-name';
import { PagedTable, type Column, type PagedView } from '../../../components/data-table';
import { Desk, Money, actionName, latinWhen, lineStatus, taskStatus } from '../../../components/desk';
import { api, type LineRow, type ProviderReportRow, type ReportRow, type TaskRow } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { pick, type Fetched } from '../../../lib/fetched';
import { pageRows, usePaged, type PageOf } from '../../../lib/use-paged';
import { useRequireLayer } from '../../../lib/use-require-layer';

const BRANCH = ['branch'];

const kinds = {
  providers: 'reportProviders',
  tasks: 'reportTasks',
  numbers: 'reportNumbers',
  operations: 'reportOperations',
} as const;

type Kind = keyof typeof kinds;

// Each report reads its own list of the API; the kind says which table to draw.
type ProviderLine = ProviderReportRow;
type MoneyLine = ReportRow;

// `usePaged` holds the rows of whichever list the kind reads, so the cast is exact.
function viewOf<Row>(list: PagedView<unknown>): PagedView<Row> {
  return list as PagedView<Row>;
}

/** One page of the report `kind`: the providers and operations reports, or the tasks and numbers lists themselves. */
async function readReport(kind: Kind, cursor: string | null): Promise<Fetched<PageOf<unknown>>> {
  if (kind === 'providers') return pick(await api.reportProviders(), pageRows);
  if (kind === 'tasks') return pick(await api.officeTasks({ cursor }), pageRows);
  if (kind === 'numbers') return pick(await api.officeLines({ cursor }), pageRows);
  return pick(await api.reportOperations(cursor), pageRows);
}

export function ReportScreen() {
  const { t } = usePrefs();
  const params = useParams<{ kind: string }>();
  const kind = typeof params.kind === 'string' && params.kind in kinds ? (params.kind as Kind) : '';
  const allowed = useRequireLayer(BRANCH);
  const list = usePaged<unknown>(kind, async (cursor) => readReport(kind as Kind, cursor), { enabled: allowed && kind !== '' });

  const providerColumns: Column<ProviderLine>[] = [
    { key: 'provider', header: t.provider, render: (row) => row.providerName },
    { key: 'company', header: t.company, render: (row) => row.companyName },
    { key: 'package', header: t.packageName, render: (row) => row.packageName },
    { key: 'cost', header: t.branchCost, num: true, render: (row) => <Money value={row.price} /> },
    { key: 'lines', header: t.linesCount, num: true, render: (row) => row.lines },
  ];
  const lineColumns: Column<LineRow>[] = [
    { key: 'number', header: t.number, cell: 'msisdn', render: (line) => <bdi dir="ltr">{line.msisdn}</bdi> },
    { key: 'package', header: t.packageName, render: (line) => line.packageName },
    { key: 'pos', header: t.pointOfSale, render: (line) => <AccountName login={line.posLogin} /> },
    { key: 'status', header: t.status, render: (line) => lineStatus(t, line.status) },
  ];
  const taskColumns: Column<TaskRow>[] = [
    { key: 'status', header: t.status, render: (row) => taskStatus(t, row.status) },
    { key: 'movement', header: t.movement, render: (row) => `${actionName(t, row.action)} · ${row.packageName}` },
    { key: 'number', header: t.number, render: (row) => <bdi dir="ltr">{row.msisdn ?? '—'}</bdi> },
    { key: 'pos', header: t.pointOfSale, render: (row) => <AccountName login={row.posLogin} /> },
    { key: 'account', header: t.accountName, render: (row) => <AccountName login={row.assigneeLogin ?? row.submitterLogin} /> },
  ];
  const entryColumns: Column<MoneyLine>[] = [
    { key: 'when', header: t.when, cell: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at)}</bdi> },
    {
      key: 'account',
      header: t.accountName,
      render: (row) => (
        <>
          <AccountName login={row.loginName} />
          <div className="hint"><AccountName login={row.actorLogin} /></div>
        </>
      ),
    },
    { key: 'movement', header: t.movement, render: (row) => actionName(t, row.kind) },
    { key: 'amount', header: t.amount, num: true, render: (row) => <Money value={row.amount} /> },
    { key: 'balance', header: t.balance, num: true, render: (row) => <Money value={row.balanceAfter} /> },
    { key: 'note', header: t.note, render: (row) => row.note ?? '—' },
  ];

  const title = t[kind ? kinds[kind] : 'navReports'];
  return (
    <Desk title={allowed ? title : ''} lede="" error={list.error} note="">
      <section className="pane">
        {!kind || list.error ? null : kind === 'providers' ? (
          <PagedTable list={viewOf<ProviderLine>(list)} columns={providerColumns} rowKey={(row) => `${row.providerName}-${row.companyName}-${row.packageName}`} />
        ) : kind === 'numbers' ? (
          <PagedTable list={viewOf<LineRow>(list)} columns={lineColumns} rowKey={(row) => row.id} empty={t.noLines} />
        ) : kind === 'tasks' ? (
          <PagedTable list={viewOf<TaskRow>(list)} columns={taskColumns} rowKey={(row) => row.id} empty={t.noTasks} />
        ) : (
          <PagedTable list={viewOf<MoneyLine>(list)} columns={entryColumns} rowKey={(row) => row.id} empty={t.noMovements} />
        )}
      </section>
    </Desk>
  );
}
