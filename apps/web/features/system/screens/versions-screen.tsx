'use client';

import { Boxes, RefreshCw, ServerCog } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { Desk, Pane, latinWhen } from '../../../components/desk';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { api, type VersionBehind, type VersionItem } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import type { Copy } from '../../../lib/copy';
import { usePrefs } from '../../../lib/prefs';
import type { Tone } from '../../../lib/status-tone';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { CELL_SUB, PANE_HEAD, PANE_TITLE } from '../kit';
import { useSystemOwner } from '../use-system-owner';
import { cycleName } from '../versions';

/** The names the owner knows them by; any other is its npm name as it is. */
const SHOWN_NAME: Record<string, string> = {
  nodejs: 'Node.js',
  postgresql: 'PostgreSQL',
  redis: 'Redis',
  next: 'Next.js',
  react: 'React',
  tailwindcss: 'Tailwind CSS',
};

/** A state's tone, never its colour alone: the badge carries the word (spec 2026-11-17-system-monitor, section 5). */
const BEHIND_TONE: Record<VersionBehind, Tone | 'info'> = {
  none: 'success',
  patch: 'info',
  minor: 'warning',
  major: 'warning',
  unknown: 'muted',
};

/*
 * A table's `bdi` stays on one line (the table's own rule); on a phone's card a long name or version
 * (`@prisma/client`, `8.0.0-rc.34`) breaks instead, so the card never runs past its column (the errors page's rule).
 */
const PHONE_WRAP = 'wrap-anywhere max-sm:whitespace-normal';

/*
 * The name and the place may break between words from 640px up (a purpose line, «العامل في الخلفية»), so the
 * runtimes' five columns fit the desk at 1024px without the table scrolling; a version never breaks there.
 */
const WORDS_WRAP = 'whitespace-normal';

function rowKey(row: VersionItem) {
  return `${row.name} ${row.where}`;
}

/** A sentence with `{name}` holes filled by nodes (a Latin value in its own `bdi`), in the language's own order. */
function fill(template: string, values: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name && name in values ? <Fragment key={index}>{values[name]}</Fragment> : piece;
  });
}

function latin(value: string, className?: string) {
  return <bdi dir="ltr" className={cn('tabular-nums sm:whitespace-nowrap', PHONE_WRAP, className)}>{value}</bdi>;
}

/** A short Latin value in a sentence (a date, a runtime's cycle and its newest): it moves to the next line whole. */
function whole(value: string) {
  return <bdi dir="ltr" className="whitespace-nowrap tabular-nums">{value}</bdi>;
}

function count(value: number) {
  return value.toLocaleString('en');
}

/** The version shown: without a leading `v` (`v24.21.0` reads `24.21.0`, as the newest is written). */
function shown(version: string | null) {
  return version ? version.replace(/^v(?=\d)/, '') : null;
}

function nameCell(t: Copy, row: VersionItem) {
  const what = (t.verWhat as Record<string, string | undefined>)[row.name];
  return (
    <span>
      <bdi dir="ltr" className={cn('font-semibold', PHONE_WRAP)}>{SHOWN_NAME[row.name] ?? row.name}</bdi>
      {what ? <span className={CELL_SUB}>{what}</span> : null}
    </span>
  );
}

function latestCell(t: Copy, row: VersionItem) {
  const latest = shown(row.latest);
  const inCycle = shown(row.latestInCycle);
  const cycle = row.kind === 'runtime' ? cycleName(row) : null;
  return (
    <span>
      {latest ? latin(latest) : '—'}
      {inCycle && cycle && inCycle !== latest ? (
        <span className={CELL_SUB}>{fill(t.verInCycle, { cycle: whole(cycle), version: whole(inCycle) })}</span>
      ) : null}
    </span>
  );
}

/** The state as a word and a tone; under it, for a runtime, its support, and a failed last check. */
function stateCell(t: Copy, row: VersionItem) {
  return (
    <span className="inline-grid justify-items-start gap-1">
      <Badge variant={BEHIND_TONE[row.behind]} dot>{t.verBehind[row.behind]}</Badge>
      {row.kind === 'runtime' ? supportLine(t, row) : null}
      {row.failed ? <span className="text-caption leading-1-3 font-semibold text-warning" data-testid="version-failed">{t.verFailed}</span> : null}
    </span>
  );
}

/** A runtime's support: the day it ends, or that it has ended (danger, in words); nothing when undated. */
function supportLine(t: Copy, row: VersionItem) {
  if (row.supportEnded) return <span className="text-caption leading-1-3 font-semibold text-danger" data-testid="version-support-ended">{t.verSupportEnded}</span>;
  if (row.supportEnds) return <span className="text-caption leading-1-3 text-muted">{fill(t.verSupportEnds, { date: whole(row.supportEnds) })}</span>;
  return null;
}

/** The versions page (spec 2026-11-17-system-monitor, section 5): the branch owner's page. */
export function VersionsScreen() {
  return useSystemOwner() ? <VersionsDesk /> : null;
}

function VersionsDesk() {
  const { t } = usePrefs();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const versions = useApiQuery(['api', 'system', 'versions'], () => api.systemVersions());
  const { run, busy } = useAction({ setError, setNote, onDone: () => versions.reload() });

  const data = versions.data;
  const checking = data?.checking !== 'off';
  const items = data?.items ?? [];
  const runtimes = items.filter((item) => item.kind === 'runtime');
  const libraries = items.filter((item) => item.kind === 'library');
  const upToDate = items.filter((item) => item.behind === 'none').length;
  const newer = items.filter((item) => item.behind !== 'none' && item.behind !== 'unknown').length;
  const unknown = items.length - upToDate - newer;

  async function checkNow() {
    await run(async () => {
      const answer = await api.checkVersions();
      // A check ran within the minute (the API's own limit): said plainly, not as "too many attempts".
      return !answer.ok && answer.code === 'RATE_LIMITED' ? { ok: false as const, message: t.verTooSoon } : answer;
    }, { note: t.verChecked });
  }

  const base: Column<VersionItem>[] = [
    { key: 'name', header: t.verName, cell: WORDS_WRAP, sortValue: (row) => SHOWN_NAME[row.name] ?? row.name, render: (row) => nameCell(t, row) },
    { key: 'where', header: t.verWhereLabel, cell: WORDS_WRAP, sortValue: (row) => t.verWhere[row.where], render: (row) => t.verWhere[row.where] },
    { key: 'current', header: t.verCurrent, render: (row) => (shown(row.current) ? latin(shown(row.current) as string) : '—') },
  ];
  // With the check off the newest, the state and a runtime's support are never asked: only what is in use is shown.
  const judged: Column<VersionItem>[] = checking
    ? [
        { key: 'latest', header: t.verLatest, render: (row) => latestCell(t, row) },
        { key: 'state', header: t.verState, sortValue: (row) => ['major', 'minor', 'patch', 'unknown', 'none'].indexOf(row.behind), render: (row) => stateCell(t, row) },
      ]
    : [];
  const columns: Column<VersionItem>[] = [...base, ...judged];

  const table = (rows: VersionItem[], columns: Column<VersionItem>[], skeletonRows: number) => (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={rowKey}
      loading={!versions.loaded}
      failed={versions.error}
      onRetry={() => void versions.reload()}
      empty={t.verEmpty}
      keepHead
      paginate={false}
      skeleton={{ rows: skeletonRows, columns: columns.length }}
    />
  );

  return (
    <Desk title={t.navVersions} lede={t.verLede} error={error} note={note}>
      {data ? (
        <Pane className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4.5 py-3.5 [.desk>&]:flex-row" data-testid="versions-summary">
          {checking ? (
            <>
              <p className="m-0 text-md font-semibold text-ink" aria-live="polite">
                {[t.verUpToDate.replace('{n}', count(upToDate)), t.verNewer.replace('{n}', count(newer)), ...(unknown > 0 ? [t.verUnknownCount.replace('{n}', count(unknown))] : [])].map((piece, index) => (
                  <Fragment key={piece}>
                    {index > 0 ? ' · ' : null}
                    <span className="whitespace-nowrap">{piece}</span>
                  </Fragment>
                ))}
              </p>
              <p className="m-0 text-sm text-muted">
                {data.checkedAt ? fill(t.verCheckedAt, { time: latin(latinWhen(data.checkedAt)) }) : t.verNeverChecked}
              </p>
              <Button type="button" variant="secondary" className="ms-auto" disabled={busy} aria-busy={busy} onClick={() => void checkNow()} data-testid="versions-check">
                <RefreshCw size={15} aria-hidden="true" className={cn(busy && 'motion-safe:animate-spin')} />
                {t.verCheckNow}
              </Button>
            </>
          ) : (
            <p className="m-0 text-md font-semibold text-ink" role="status" data-testid="versions-off">
              {fill(t.verOff, { flag: <bdi dir="ltr" className="font-mono text-sm">VERSION_CHECK=off</bdi> })}
            </p>
          )}
        </Pane>
      ) : null}
      <Pane data-testid="versions-runtimes">
        <header className={PANE_HEAD}>
          <h2 className={PANE_TITLE}><ServerCog size={16} aria-hidden="true" className="flex-none text-muted" />{t.verRuntimes}</h2>
        </header>
        {table(runtimes, columns, 5)}
      </Pane>
      <Pane data-testid="versions-libraries">
        <header className={PANE_HEAD}>
          <h2 className={PANE_TITLE}><Boxes size={16} aria-hidden="true" className="flex-none text-muted" />{t.verLibraries}</h2>
        </header>
        {table(libraries, columns, 8)}
      </Pane>
      <p className="m-0 text-sm leading-1-5 text-muted" data-testid="versions-footnote">{t.verFootnote}</p>
    </Desk>
  );
}
