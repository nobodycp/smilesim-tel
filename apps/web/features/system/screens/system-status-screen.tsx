'use client';

import { Activity, Cpu, Database, ListOrdered, MemoryStick, Radio, RefreshCw, Send, Server, TableProperties, type LucideIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Desk, Pane, latinWhen } from '../../../components/desk';
import { Fact, Facts } from '../../../components/facts';
import { LoadFailed } from '../../../components/load-failed';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Skeleton } from '../../../components/ui/skeleton';
import { api, type StatusPart, type StatusState } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import type { Copy, Locale } from '../../../lib/copy';
import { usePrefs } from '../../../lib/prefs';
import { partTone } from '../../../lib/status-tone';
import { useApiQuery } from '../../../lib/use-api-query';
import { megabytes, millis, percent, span } from '../format';
import { CELL_SUB, PANE_HEAD, PANE_TITLE, routeText } from '../kit';
import { useSystemOwner } from '../use-system-owner';

/** The page asks again on this beat while it is open and in view (spec 2026-11-17-system-monitor, section 1). */
const REFRESH_MS = 15_000;
/** The requests part's window when its probe failed and did not say it (the API's `REQUESTS_WINDOW_MINUTES`). */
const REQUESTS_WINDOW_MINUTES = 15;
const PART_COUNT = 9;

type PartName = StatusPart['name'];

const ICONS: Record<PartName, LucideIcon> = {
  api: Server,
  worker: Cpu,
  postgres: Database,
  redis: MemoryStick,
  queues: ListOrdered,
  outbox: Send,
  providers: Radio,
  requests: Activity,
  schema: TableProperties,
};

const NOTE_TONE: Record<StatusState, string> = {
  ok: 'text-muted',
  warn: 'text-warning',
  down: 'text-danger',
};

/*
 * The cards: one column on a phone, two from 768px, three from 1100px (three rows of three), 12px apart; each card a
 * Pane with the home panes' head (the part and its state badge) and a ruled fact list under the reason line. Cards in
 * one row share its height; in two columns an odd last card takes the whole row, as the figure row does (owner
 * 2026-11-11: no card left alone). In the desk column the grid keeps its own height.
 */
const GRID = 'grid gap-3 md:grid-cols-2 xl:grid-cols-3 md:max-xl:[&>:last-child:nth-child(odd)]:col-span-full [.desk_&]:flex-none';
const CARD = 'flex min-w-0 flex-col';
const BODY = 'grid content-start gap-2.5 px-4.5 py-3.5';

function stateWord(t: Copy, state: StatusState) {
  if (state === 'ok') return t.sysStateOk;
  return state === 'warn' ? t.sysStateWarn : t.sysStateDown;
}

function partTitle(t: Copy, locale: Locale, part: StatusPart) {
  switch (part.name) {
    case 'api': return t.sysPartApi;
    case 'worker': return t.sysPartWorker;
    case 'postgres': return t.sysPartPostgres;
    case 'redis': return t.sysPartRedis;
    case 'queues': return t.sysPartQueues;
    case 'outbox': return t.sysPartOutbox;
    case 'providers': return t.sysPartProviders;
    case 'requests': return t.sysPartRequests.replace('{span}', span(locale, (part.figures?.windowMinutes ?? REQUESTS_WINDOW_MINUTES) * 60));
    case 'schema': return t.sysPartSchema;
  }
}

/** Why a part is as it is, in a sentence; none when it is working for no particular reason. */
function reasonOf(t: Copy, part: StatusPart): ReactNode {
  if (!part.note) return null;
  const notes = t.sysNotes as Record<string, string | undefined>;
  return notes[part.note] ?? fill(t.sysProbeFailed, { code: <bdi dir="ltr">{part.note}</bdi> });
}

function latin(value: ReactNode) {
  return <bdi dir="ltr">{value}</bdi>;
}

/** A sentence with `{name}` holes filled by nodes (a Latin figure in its own `bdi`), in the language's own order. */
function fill(template: string, values: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name && name in values ? <Fragment key={index}>{values[name]}</Fragment> : piece;
  });
}

function count(value: number) {
  return value.toLocaleString('en');
}

function queueName(t: Copy, name: string): ReactNode {
  if (name === 'provider-operations') return t.sysQueueOperations;
  if (name === 'provider-settlements') return t.sysQueueSettlements;
  return latin(name);
}

/** A part's figures, in the reader's words. */
function PartFigures({ part }: { part: StatusPart }) {
  const { t, locale } = usePrefs();
  const ago = (seconds: number) => t.sysAgo.replace('{span}', span(locale, seconds));
  switch (part.name) {
    case 'api': {
      const figures = part.figures;
      if (!figures) return null;
      const used = figures.memoryBasis === 'container' ? figures.rssBytes : figures.heapUsedBytes;
      return (
        <Facts variant="list">
          <Fact label={t.sysUptime}>{span(locale, figures.uptimeS)}</Fact>
          <Fact label={t.sysMemory}>
            <span>
              {fill(t.sysMemoryOf, { used: latin(megabytes(used)), limit: latin(megabytes(figures.limitBytes)) })}
              <span className={CELL_SUB}>{fill(figures.memoryBasis === 'container' ? t.sysMemoryContainer : t.sysMemoryHeap, { share: latin(percent(figures.memoryShare)) })}</span>
            </span>
          </Fact>
          <Fact label={t.sysVersion}>{figures.commit ? latin(figures.commit.slice(0, 7)) : t.sysVersionUnknown}</Fact>
        </Facts>
      );
    }
    case 'worker': {
      const figures = part.figures;
      if (!figures) return null;
      return (
        <Facts variant="list">
          <Fact label={t.sysLastBeat}>{figures.lastBeatAgeS === null ? t.sysNoBeat : ago(figures.lastBeatAgeS)}</Fact>
          <Fact label={t.sysWorkers}>{latin(count(figures.workers))}</Fact>
        </Facts>
      );
    }
    case 'postgres': {
      const figures = part.figures;
      if (!figures) return null;
      return (
        <Facts variant="list">
          <Fact label={t.sysPing}>{latin(millis(figures.pingMs))}</Fact>
          <Fact label={t.sysConnections}>{latin(count(figures.connections))}</Fact>
          <Fact label={t.sysDbSize}>{latin(megabytes(figures.sizeBytes))}</Fact>
        </Facts>
      );
    }
    case 'redis': {
      const figures = part.figures;
      if (!figures || !figures.configured) return null;
      return (
        <Facts variant="list">
          <Fact label={t.sysPing}>{figures.pingMs === null ? '—' : latin(millis(figures.pingMs))}</Fact>
          <Fact label={t.sysMemory}>{figures.usedMemoryBytes === null ? '—' : latin(megabytes(figures.usedMemoryBytes))}</Fact>
        </Facts>
      );
    }
    case 'queues': {
      const figures = part.figures;
      if (!figures || !figures.configured) return null;
      if (figures.queues.length === 0) return <p className="m-0 text-md text-muted">{t.sysNoQueues}</p>;
      return (
        <Facts variant="list">
          {figures.queues.map((queue) => (
            <Fact key={queue.name} label={queueName(t, queue.name)}>
              <span className={queue.failed > 0 ? 'text-danger' : undefined}>
                {t.sysQueueLine
                  .replace('{waiting}', count(queue.waiting))
                  .replace('{active}', count(queue.active))
                  .replace('{failed}', count(queue.failed))
                  .split(' · ')
                  .map((piece, index) => (
                    <Fragment key={piece}>
                      {index > 0 ? ' · ' : null}
                      <span className="whitespace-nowrap">{piece}</span>
                    </Fragment>
                  ))}
              </span>
            </Fact>
          ))}
        </Facts>
      );
    }
    case 'outbox': {
      const figures = part.figures;
      if (!figures) return null;
      return (
        <Facts variant="list">
          <Fact label={t.sysWaitingMessages}>{latin(count(figures.unpublished))}</Fact>
          <Fact label={t.sysOldest}>{figures.oldestAgeS === null ? t.sysNothingWaits : ago(figures.oldestAgeS)}</Fact>
        </Facts>
      );
    }
    case 'providers': {
      const figures = part.figures;
      if (!figures) return null;
      const troubled = figures.providers.filter((provider) => provider.status === 'problem');
      return (
        <Facts variant="list">
          <Fact label={t.sysProvidersInProblem}>
            {t.sysProvidersOf.replace('{n}', count(figures.problems)).replace('{total}', count(figures.providers.length))}
          </Fact>
          {troubled.map((provider) => (
            <Fact key={provider.code} label={provider.name}>
              <span className="text-warning">
                {provider.reason === 'failures' ? t.sysProviderFailures : provider.reason === 'balance' ? t.sysProviderBalance : t.sysProviderProblem}
              </span>
            </Fact>
          ))}
        </Facts>
      );
    }
    case 'requests': {
      const figures = part.figures;
      if (!figures) return null;
      return (
        <Facts variant="list">
          <Fact label={t.reqLogCount}>{latin(count(figures.count))}</Fact>
          <Fact label={t.sysServerErrors}>
            <span className={figures.failed > 0 ? 'text-danger' : undefined}>{latin(`${count(figures.failed)} (${percent(figures.errorRate)})`)}</span>
          </Fact>
          <Fact label={t.sysSlowestRoute}>
            {figures.slowestRoute ? (
              <span>
                <bdi dir="ltr"><span className="font-semibold">{figures.slowestRoute.method}</span> {routeText(figures.slowestRoute.route)}</bdi>
                <span className={CELL_SUB}>{t.reqLogP95}: {latin(millis(figures.slowestRoute.p95Ms))}</span>
              </span>
            ) : t.sysNone}
          </Fact>
        </Facts>
      );
    }
    case 'schema': {
      const figures = part.figures;
      if (!figures) return null;
      return (
        <Facts variant="list">
          <Fact label={t.sysMigrations}>
            {t.sysMigrationsOf.replace('{applied}', count(figures.applied)).replace('{carried}', count(figures.carried))}
          </Fact>
          {figures.missing.length > 0 ? (
            <Fact label={t.sysMissing}>
              <span className="grid">
                {figures.missing.map((name) => <bdi key={name} dir="ltr" className="text-danger wrap-anywhere">{name}</bdi>)}
              </span>
            </Fact>
          ) : null}
        </Facts>
      );
    }
  }
}

function PartCard({ part }: { part: StatusPart }) {
  const { t, locale } = usePrefs();
  const Icon = ICONS[part.name];
  const reason = reasonOf(t, part);
  return (
    <Pane className={CARD} data-testid="status-part" data-part={part.name} data-state={part.state}>
      <header className={PANE_HEAD}>
        <h2 className={PANE_TITLE}>
          <Icon size={16} aria-hidden="true" className="flex-none text-muted" />
          {partTitle(t, locale, part)}
        </h2>
        <Badge variant={partTone(part.state)} dot>{stateWord(t, part.state)}</Badge>
      </header>
      <div className={BODY}>
        {reason ? <p className={cn('m-0 text-md font-semibold', NOTE_TONE[part.state])}>{reason}</p> : null}
        <PartFigures part={part} />
      </div>
    </Pane>
  );
}

function PartSkeleton() {
  return (
    <Pane className={CARD} aria-hidden="true">
      <div className={PANE_HEAD}>
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-14" />
      </div>
      <div className={BODY}>
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    </Pane>
  );
}

/** The system status (spec 2026-11-17-system-monitor, section 1): the branch owner's page. */
export function SystemStatusScreen() {
  return useSystemOwner() ? <SystemStatusDesk /> : null;
}

function SystemStatusDesk() {
  const { t } = usePrefs();
  const status = useApiQuery(['api', 'system', 'status'], () => api.systemStatus(), { every: REFRESH_MS });
  const data = status.data;
  const attention = data ? data.parts.filter((part) => part.state !== 'ok').length : 0;

  return (
    <Desk
      title={t.navSystemStatus}
      lede={t.sysLede}
      error={status.error}
      note=""
      action={(
        <Button type="button" variant="secondary" aria-busy={status.fetching} onClick={() => void status.reload()}>
          <RefreshCw size={15} aria-hidden="true" className={cn(status.fetching && 'motion-safe:animate-spin')} />
          {t.sysRefresh}
        </Button>
      )}
    >
      {data ? (
        <Pane className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4.5 py-3.5 [.desk>&]:flex-row" data-testid="status-summary">
          <Badge variant={partTone(data.state)} dot>{stateWord(t, data.state)}</Badge>
          <p className="m-0 text-md font-semibold text-ink" aria-live="polite">
            {attention === 0 ? t.sysAllWell : t.sysNeedAttention.replace('{n}', count(attention)).replace('{total}', count(data.parts.length))}
          </p>
          <p className="m-0 ms-auto text-sm text-muted">{fill(t.sysReadAt, { time: <bdi dir="ltr" className="tabular-nums">{latinWhen(data.at, true)}</bdi> })}</p>
        </Pane>
      ) : null}
      {data ? (
        <div className={GRID}>
          {data.parts.map((part) => <PartCard key={part.name} part={part} />)}
        </div>
      ) : status.loaded ? (
        <Pane>
          <LoadFailed message={status.error} onRetry={() => void status.reload()} busy={status.fetching} />
        </Pane>
      ) : (
        <div className={GRID}>
          {Array.from({ length: PART_COUNT }, (_, index) => <PartSkeleton key={index} />)}
        </div>
      )}
    </Desk>
  );
}
