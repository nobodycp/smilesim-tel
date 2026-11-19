'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AccountName } from '../../../components/account-name';
import { DataTable, PagedTable, type Column } from '../../../components/data-table';
import { DateField } from '../../../components/date-field';
import { Desk, Pane, latinWhen, layerName } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { Fact, Facts } from '../../../components/facts';
import { FilterBar } from '../../../components/filter-bar';
import { RowMenu } from '../../../components/row-menu';
import { Stat, StatRow } from '../../../components/stat';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Select, SelectItem } from '../../../components/ui/select';
import { api, type RequestLogRow, type RouteFigures } from '../../../lib/api';
import { pick } from '../../../lib/fetched';
import { usePrefs } from '../../../lib/prefs';
import { requestTone } from '../../../lib/status-tone';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { useDebouncedField, useUrlFilters } from '../../../lib/url-state';
import { CopyValue } from '../../lines/line-details';
import { ReportFilters } from '../../reports/report-kit';
import type { RequestLogFilters } from '../api';
import { CELL_SUB, PANE_HEAD, PANE_TITLE, routeText } from '../kit';
import { useSystemOwner } from '../use-system-owner';

// The filters in the address (`?status=5xx&route=/v1/postpaid/lines/:id`). `status` is a class of answers here; the API also
// takes one status (`404`), which a link may carry and the menu then shows as its own choice. `from` / `to` are days
// from the date fields, or two moments from an alert's link (`2026-11-17T10:02:00.000Z`), which the API takes as they
// are and the page says in a line under the filters.
const FILTER_KEYS = ['status', 'code', 'method', 'route', 'path', 'unmatched', 'account', 'ip', 'slower', 'from', 'to'] as const;
const STATUS_CLASSES = ['2xx', '4xx', '5xx'] as const;
const STATUS = /^([1-5]xx|[1-5]\d\d)$/;
/*
 * The «مسارات غير معروفة» toggle chip: the filter panel's chip rules draw it, as «السالب فقط» on the balances report.
 */
const TOGGLE_CHIP = 'm-0 min-h-9 max-touch:min-h-11';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
// The API's error codes, as the copy names them; the two the web makes up itself (no answer, no code) are not sent.
const WEB_ONLY_CODES = new Set(['NETWORK', 'GENERIC']);

function isMoment(value: string) {
  return MOMENT.test(value) && !Number.isNaN(new Date(value).getTime());
}

function dayOrMoment(value: string) {
  return DAY.test(value) || isMoment(value) ? value : '';
}

/*
 * The request log's cells: Latin values (method, pattern, path, code, address) are `bdi dir="ltr"` inside the RTL page;
 * the method semibold; a path shown for a pattern no route matched, `--rd-muted`; who entered an account under it, a
 * block 11.5px muted (the audit log's sub line). The two route lists sit side by side from 1280px, one over the other
 * under it, 12px apart, each its own Pane with the home panes' head. The panes keep their own height (`items-start`):
 * stretched, the empty and failed blocks' `min-height: 100%` would resolve against the row and overflow the pane.
 */
const ROUTE_GRID = 'grid items-start gap-3 xl:grid-cols-2 [.desk_&]:flex-none';

/*
 * A table's `bdi` stays on one line (the table's own rule); on a phone's card a long route breaks instead (after a
 * slash first, `routeText`), so the card never runs past its column (the errors page's rule).
 */
const PHONE_WRAP = 'wrap-anywhere max-sm:whitespace-normal';

function ms(value: number) {
  return <bdi dir="ltr">{value.toLocaleString('en')} ms</bdi>;
}

function bytes(value: number) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}

function address(ip: string) {
  return ip.replace(/^::ffff:/, '');
}

/**
 * The request log (spec 2026-11-17-system-monitor, section 2): the branch owner's page. Any other door or account is
 * sent home, as `/roles` does, instead of drawing the page and failing on its 403.
 */
export function RequestLogScreen() {
  return useSystemOwner() ? <RequestLogDesk /> : null;
}

function RequestLogDesk() {
  const { t } = usePrefs();
  const errors = t.errors as Record<string, string | undefined>;
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<RequestLogRow | null>(null);
  const [clearing, setClearing] = useState(false);

  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const status = STATUS.test(filters.status) ? filters.status : '';
  const slower = /^\d{1,6}$/.test(filters.slower) && Number(filters.slower) <= 600_000 ? filters.slower : '';
  const from = dayOrMoment(filters.from);
  const to = dayOrMoment(filters.to);
  const method = (METHODS as readonly string[]).includes(filters.method) ? filters.method : '';
  const codes = Object.keys(t.errors).filter((name) => !WEB_ONLY_CODES.has(name));
  const code = codes.includes(filters.code) ? filters.code : '';
  const unmatched = filters.unmatched === '1' ? '1' : '';
  const [route, setRoute] = useDebouncedField(filters.route, useCallback((value: string) => setFilters({ route: value }), [setFilters]));
  const [path, setPath] = useDebouncedField(filters.path, useCallback((value: string) => setFilters({ path: value }), [setFilters]));
  const [account, setAccount] = useDebouncedField(filters.account, useCallback((value: string) => setFilters({ account: value }), [setFilters]));
  const [ip, setIp] = useDebouncedField(filters.ip, useCallback((value: string) => setFilters({ ip: value }), [setFilters]));
  const [slowerText, setSlowerText] = useDebouncedField(slower, useCallback((value: string) => setFilters({ slower: value }), [setFilters]));

  const query: RequestLogFilters = { status, code, method, route: filters.route, path: filters.path, unmatched, account: filters.account, ip: filters.ip, slowerThan: slower, from, to };
  const key = `${status}|${code}|${method}|${filters.route}|${filters.path}|${unmatched}|${filters.account}|${filters.ip}|${slower}|${from}|${to}`;
  const list = usePaged<RequestLogRow>(key, async (cursor) => pick(await api.requestLog({ ...query, cursor }), pageRows));
  const summary = useApiQuery(['api', 'system', 'requests', 'summary', key], () => api.requestLogSummary(query));
  const { run, busy } = useAction({
    setError,
    setNote,
    onDone: () => Promise.all([list.reload(), summary.reload()]),
  });

  function clearFilters() {
    setFilters({ status: '', code: '', method: '', route: '', path: '', unmatched: '', account: '', ip: '', slower: '', from: '', to: '' });
  }

  function clearLog() {
    void run(() => api.clearRequestLog(), {
      note: (answer) => t.reqLogCleared.replace('{n}', answer.removed.toLocaleString('en')).replace('{e}', answer.errorsRemoved.toLocaleString('en')),
      then: () => setClearing(false),
    });
  }

  const columns: Column<RequestLogRow>[] = [
    { key: 'when', header: t.when, kind: 'when', render: (row) => <bdi dir="ltr">{latinWhen(row.at, true)}</bdi> },
    { key: 'method', header: t.reqLogMethod, render: (row) => <bdi dir="ltr" className="font-semibold">{row.method}</bdi> },
    {
      key: 'route',
      header: t.reqLogRoute,
      render: (row) => (row.route ? <bdi dir="ltr" className="wrap-anywhere">{row.route}</bdi> : <bdi dir="ltr" className="text-muted wrap-anywhere" title={t.reqLogUnknownRoute}>{row.path}</bdi>),
    },
    {
      key: 'status',
      header: t.reqLogStatus,
      render: (row) => <Badge variant={requestTone(row.status)} dot><bdi dir="ltr">{row.status}</bdi></Badge>,
    },
    { key: 'code', header: t.reqLogCode, render: (row) => (row.code ? <bdi dir="ltr" title={errors[row.code]}>{row.code}</bdi> : '—') },
    { key: 'duration', header: t.reqLogDuration, num: true, render: (row) => ms(row.durationMs) },
    {
      key: 'account',
      header: t.reqLogAccount,
      render: (row) => (
        <>
          <AccountName login={row.actorLoginName || null} />
          {row.operatorLoginName !== null ? (
            <span className={CELL_SUB}>{t.reqLogEnteredBy} <AccountName login={row.operatorLoginName || null} /></span>
          ) : null}
        </>
      ),
    },
    { key: 'ip', header: t.reqLogAddress, render: (row) => (row.ip ? <bdi dir="ltr">{address(row.ip)}</bdi> : '—') },
    {
      key: 'ops',
      header: t.rowActions,
      actions: true,
      render: (row) => <RowMenu label={`${t.rowActions} ${row.requestId}`} items={[{ label: t.reqLogDetails, icon: 'receipt', onClick: () => setOpen(row) }]} />,
    },
  ];

  // A route of the two lists filters the log by its method and pattern; the requests no route matched (an empty
  // pattern) by `unmatched=1` and the method.
  const routeColumns: Column<RouteFigures>[] = [
    {
      key: 'route',
      header: t.reqLogRoute,
      render: (row) => {
        const label = (
          <span className="whitespace-normal">
            <bdi dir="ltr" className="font-semibold">{row.method}</bdi> {row.route ? <bdi dir="ltr" className={PHONE_WRAP}>{routeText(row.route)}</bdi> : <span className="text-muted">{t.reqLogUnknownRoute}</span>}
          </span>
        );
        const filter = row.route ? { method: row.method, route: row.route, unmatched: '' } : { method: row.method, route: '', unmatched: '1' };
        return (
          <Button
            type="button"
            variant="link"
            className="h-auto max-w-full p-0 text-start whitespace-normal"
            aria-label={`${t.reqLogByRoute}: ${row.method} ${row.route || t.reqLogUnknownRoute}`}
            onClick={() => setFilters(filter)}
          >
            {label}
          </Button>
        );
      },
    },
    { key: 'p95', header: t.reqLogP95, num: true, render: (row) => ms(row.p95Ms) },
    { key: 'median', header: t.reqLogMedian, num: true, render: (row) => ms(row.medianMs) },
    { key: 'calls', header: t.reqLogCalls, num: true, render: (row) => row.calls.toLocaleString('en') },
  ];

  const figures = summary.data;
  const routeKey = (row: RouteFigures) => `${row.method} ${row.route}`;

  return (
    <Desk
      title={t.navRequestLog}
      lede={t.reqLogLede}
      error={error || summary.error}
      note={note}
      action={(
        <Button type="button" variant="danger" onClick={() => { setError(''); setClearing(true); }}>
          <Trash2 size={15} aria-hidden="true" />
          {t.reqLogClear}
        </Button>
      )}
    >
      <ReportFilters>
        <FilterBar loose onClear={clearFilters} clearLabel={t.clearFilters}>
          <label>
            {t.reqLogStatus}
            <Select value={status} onValueChange={(next) => setFilters({ status: next })}>
              <SelectItem value="">{t.allRows}</SelectItem>
              <SelectItem value="2xx">{t.reqLogStatusOk}</SelectItem>
              <SelectItem value="4xx">{t.reqLogStatusRefused}</SelectItem>
              <SelectItem value="5xx">{t.reqLogStatusFailed}</SelectItem>
              {status && !(STATUS_CLASSES as readonly string[]).includes(status) ? <SelectItem value={status}>{status}</SelectItem> : null}
            </Select>
          </label>
          <label>
            {t.reqLogMethod}
            <Select value={method} onValueChange={(next) => setFilters({ method: next })}>
              <SelectItem value="">{t.allRows}</SelectItem>
              {METHODS.map((name) => <SelectItem key={name} value={name}><bdi dir="ltr">{name}</bdi></SelectItem>)}
            </Select>
          </label>
          <label>
            {t.reqLogRoute}
            <input dir="ltr" aria-label={t.reqLogRoute} value={route} maxLength={200} onChange={(event) => setRoute(event.target.value)} />
          </label>
          <label>
            {t.reqLogPathContains}
            <input dir="ltr" aria-label={t.reqLogPathContains} value={path} maxLength={200} onChange={(event) => setPath(event.target.value)} />
          </label>
          <label>
            {t.reqLogCode}
            <Select value={code} onValueChange={(next) => setFilters({ code: next })}>
              <SelectItem value="">{t.allRows}</SelectItem>
              {codes.map((name) => <SelectItem key={name} value={name}><bdi dir="ltr">{name}</bdi></SelectItem>)}
            </Select>
          </label>
          <label>
            {t.reqLogAccount}
            <input dir="ltr" aria-label={t.reqLogAccount} value={account} maxLength={60} onChange={(event) => setAccount(event.target.value)} />
          </label>
          <label>
            {t.reqLogAddressStarts}
            <input dir="ltr" aria-label={t.reqLogAddressStarts} placeholder="10.0." value={ip} maxLength={64} onChange={(event) => setIp(event.target.value)} />
          </label>
          <label>
            {t.reqLogSlowerThan}
            <input dir="ltr" aria-label={t.reqLogSlowerThan} inputMode="numeric" value={slowerText} maxLength={6} onChange={(event) => setSlowerText(event.target.value.replace(/\D/g, ''))} />
          </label>
          <label>
            {t.from}
            <DateField value={from.slice(0, 10)} onChange={(next) => setFilters({ from: next })} />
          </label>
          <label>
            {t.to}
            <DateField value={to.slice(0, 10)} onChange={(next) => setFilters({ to: next })} />
          </label>
          <label className={TOGGLE_CHIP}>
            <input type="checkbox" checked={unmatched === '1'} onChange={(event) => setFilters({ unmatched: event.target.checked ? '1' : '', ...(event.target.checked ? { route: '' } : {}) })} />
            <span>{t.reqLogUnmatched}</span>
          </label>
        </FilterBar>
      </ReportFilters>
      {isMoment(from) || isMoment(to) ? (
        <p className="m-0 text-md text-muted" role="status" data-testid="request-log-range">
          {t.reqLogRange.split(/(\{from\}|\{to\})/).map((piece, index) => {
            if (piece === '{from}') return <bdi key={index} dir="ltr" className="tabular-nums">{from ? latinWhen(from, true) : '—'}</bdi>;
            if (piece === '{to}') return <bdi key={index} dir="ltr" className="tabular-nums">{to ? latinWhen(to, true) : '—'}</bdi>;
            return piece;
          })}
        </p>
      ) : null}
      <StatRow>
        <Stat label={t.reqLogCount} value={figures ? figures.count.toLocaleString('en') : '—'} meta={t.reqLogCountMeta} />
        <Stat
          label={t.reqLogErrorRate}
          value={figures ? <bdi dir="ltr" className={figures.failed ? 'text-danger' : undefined}>{(figures.errorRate * 100).toFixed(1)}%</bdi> : '—'}
          meta={figures ? t.reqLogErrorRateMeta.replace('{n}', figures.failed.toLocaleString('en')) : undefined}
        />
        <Stat label={t.reqLogRefused} value={figures ? figures.refused.toLocaleString('en') : '—'} meta={t.reqLogRefusedMeta} />
      </StatRow>
      <div className={ROUTE_GRID}>
        <Pane>
          <header className={PANE_HEAD}><h2 className={PANE_TITLE}>{t.reqLogSlowest}</h2></header>
          <DataTable columns={routeColumns} rows={figures?.slowest ?? []} rowKey={routeKey} loading={!summary.loaded} failed={summary.error} onRetry={() => void summary.reload()} empty={t.reqLogEmpty} keepHead sortable={false} paginate={false} skeleton={{ rows: 5, columns: 4 }} />
        </Pane>
        <Pane>
          <header className={PANE_HEAD}><h2 className={PANE_TITLE}>{t.reqLogBusiest}</h2></header>
          <DataTable columns={routeColumns} rows={figures?.busiest ?? []} rowKey={routeKey} loading={!summary.loaded} failed={summary.error} onRetry={() => void summary.reload()} empty={t.reqLogEmpty} keepHead sortable={false} paginate={false} skeleton={{ rows: 5, columns: 4 }} />
        </Pane>
      </div>
      <Pane data-testid="request-log-pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.reqLogEmpty} keepHead skeleton={{ rows: 8, columns: 9 }} />
      </Pane>
      <Dialog open={open !== null} title={t.reqLogDetails} closeLabel={t.closeMenu} onClose={() => setOpen(null)}>
        {open ? (
          <Facts variant="list">
            <Fact label={t.when}><bdi dir="ltr">{latinWhen(open.at, true)}</bdi></Fact>
            <Fact label={t.reqLogDuration}>{ms(open.durationMs)}</Fact>
            <Fact label={t.reqLogRoute}><bdi dir="ltr">{open.method}</bdi> {open.route ? <bdi dir="ltr">{open.route}</bdi> : <span className="text-muted">{t.reqLogUnknownRoute}</span>}</Fact>
            <Fact label={t.reqLogPath}><bdi dir="ltr">{open.path}</bdi></Fact>
            <Fact label={t.reqLogStatus}><Badge variant={requestTone(open.status)} dot><bdi dir="ltr">{open.status}</bdi></Badge></Fact>
            <Fact label={t.reqLogCode}>{open.code ? <span><bdi dir="ltr">{open.code}</bdi>{errors[open.code] ? <span className={CELL_SUB}>{errors[open.code]}</span> : null}</span> : '—'}</Fact>
            <Fact label={t.reqLogAccount}><AccountName login={open.actorLoginName || null} /></Fact>
            {open.operatorLoginName !== null ? <Fact label={t.reqLogEnteredBy}><AccountName login={open.operatorLoginName || null} /></Fact> : null}
            <Fact label={t.layer}>{open.layer ? layerName(t, open.layer) : '—'}</Fact>
            <Fact label={t.reqLogAddress}>{open.ip ? <bdi dir="ltr">{address(open.ip)}</bdi> : '—'}</Fact>
            <Fact label={t.reqLogBrowser}>{open.userAgent ? <bdi dir="ltr">{open.userAgent}</bdi> : '—'}</Fact>
            <Fact label={t.reqLogSizes}><bdi dir="ltr">{bytes(open.bytesIn)} / {bytes(open.bytesOut)}</bdi></Fact>
            <Fact label={t.reqLogRequestId}><CopyValue value={open.requestId} /></Fact>
          </Facts>
        ) : null}
      </Dialog>
      <Dialog
        open={clearing}
        size="confirm"
        title={t.reqLogClear}
        lede={t.reqLogClearHint}
        mark="trash"
        tone="danger"
        closeLabel={t.closeMenu}
        error={error}
        onClose={() => { if (!busy) setClearing(false); }}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setClearing(false)}>{t.cancel}</Button>
            <Button type="button" variant="danger" disabled={busy} onClick={clearLog}>{t.reqLogClear}</Button>
          </>
        )}
      >
        <p className="m-0 text-md text-muted">{t.reqLogClearAll}</p>
      </Dialog>
    </Desk>
  );
}
