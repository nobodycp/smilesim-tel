'use client';

import {
  Ban,
  CheckCheck,
  DoorOpen,
  Eye,
  Gauge,
  Hourglass,
  KeyRound,
  LockKeyhole,
  PowerOff,
  ScanSearch,
  ScrollText,
  ServerCrash,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
  Bug,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccountName } from '../../../components/account-name';
import { Desk, Pane, latinWhen } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { Fact, Facts } from '../../../components/facts';
import { FilterBar } from '../../../components/filter-bar';
import { LoadFailed } from '../../../components/load-failed';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Select, SelectItem } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { api, type AlertKind, type AlertLink, type SystemAlert } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import type { Copy, Locale } from '../../../lib/copy';
import { useDesk } from '../../../lib/desk-session';
import { alertKindName } from '../../../lib/notice-text';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { useUrlFilters } from '../../../lib/url-state';
import { millis, span } from '../format';
import { CELL_SUB, PANE_HEAD, PANE_TITLE, routeText } from '../kit';
import { useSystemOwner } from '../use-system-owner';

/** The rules run every 30 s in the worker (spec 2026-11-17-system-monitor, section 4): the page asks on the same beat. */
const REFRESH_MS = 30_000;
const SKELETONS = 3;

// The filters in the address: `state` keeps the open or the ended ones; `id` (the bell's notice) brings one alert
// into view.
const FILTER_KEYS = ['state', 'id'] as const;
type StateFilter = '' | 'open' | 'closed';

const ICONS: Record<AlertKind, LucideIcon> = {
  password_cracking: KeyRound,
  many_accounts: Users,
  second_step: Smartphone,
  rate_limit: Hourglass,
  probing: ScanSearch,
  wrong_door: DoorOpen,
  permission_probing: LockKeyhole,
  system_failing: ServerCrash,
  service_down: PowerOff,
  slow: Gauge,
};

/** An attack or a failure is danger; a limit reached and slowness are warnings (often harmless). */
const WARNING_KINDS: readonly AlertKind[] = ['rate_limit', 'slow'];

/*
 * The cards: one column, two from 768px (cards in a row share its height; an odd last card takes the whole row, as
 * the status page's do), 12px apart,
 * under a small heading per part (open now, ended). Each card a Pane with the home panes' head (the kind's icon and
 * name, its state badge), then the meaning line, a ruled fact list, «ماذا تفعل» on `--rd-surface-2`, and the actions.
 * The alert the bell's notice named is ringed in `--rd-accent` and scrolled into view.
 */
const GRID = 'grid gap-3 md:grid-cols-2 md:[&>:last-child:nth-child(odd)]:col-span-full [.desk_&]:flex-none';
const CARD = 'flex min-w-0 scroll-mt-20 flex-col';
const BODY = 'flex flex-1 flex-col gap-2.5 px-4.5 py-3.5';
const SKELETON_BODY = 'grid content-start gap-2.5 px-4.5 py-3.5';
const PART_TITLE = 'm-0 text-md font-bold text-muted';
const TODO = 'm-0 rounded-sm bg-surface-2 px-3 py-2.5 text-md text-ink-2';

function latin(value: ReactNode, className?: string) {
  return <bdi dir="ltr" className={className}>{value}</bdi>;
}

function address(ip: string) {
  return ip.replace(/^::ffff:/, '');
}

function secondsSince(iso: string, now: number) {
  return Math.max(0, (now - new Date(iso).getTime()) / 1000);
}

/**
 * The request log's address for an alert's own link: every field the link carries, under the request log's names
 * (`slowerThan` is its `slower`); the range is two moments, which the request log takes as they are.
 */
export function requestsHref(link: AlertLink): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | undefined) => {
    if (value) params.set(key, value);
  };
  set('status', link.status);
  set('code', link.code);
  set('method', link.method);
  set('route', link.route);
  set('unmatched', link.unmatched);
  set('account', link.account);
  set('ip', link.ip ? address(link.ip) : undefined);
  set('slower', link.slowerThan);
  set('from', link.from);
  set('to', link.to);
  return `/system/requests?${params.toString()}`;
}

function partName(t: Copy, part: string): ReactNode {
  switch (part) {
    case 'api': return t.sysPartApi;
    case 'worker': return t.sysPartWorker;
    case 'postgres': return t.sysPartPostgres;
    case 'redis': return t.sysPartRedis;
    case 'queues': return t.sysPartQueues;
    case 'outbox': return t.sysPartOutbox;
    default: return latin(part);
  }
}

/** Who or where an alert is about, and the detail its kind carries, as fact rows. */
function SubjectFacts({ alert }: { alert: SystemAlert }) {
  const { t } = usePrefs();
  const limits = t.alertLimits as Record<string, string | undefined>;
  const rows: ReactNode[] = [];
  if (alert.loginName) {
    rows.push(
      <Fact key="login" label={alert.kind === 'password_cracking' ? t.alertLoginTried : t.reqLogAccount}>
        {alert.kind === 'password_cracking' ? latin(alert.loginName, 'wrap-anywhere') : <AccountName login={alert.loginName} />}
      </Fact>,
    );
  }
  if (alert.ip) rows.push(<Fact key="ip" label={t.reqLogAddress}>{latin(address(alert.ip))}</Fact>);
  if (alert.route) {
    rows.push(
      <Fact key="route" label={t.reqLogRoute}>
        {latin(<><span className="font-semibold">{alert.method}</span> {routeText(alert.route)}</>, 'wrap-anywhere')}
      </Fact>,
    );
  } else if (alert.path) {
    rows.push(
      <Fact key="path" label={t.reqLogPath}>
        {latin(<>{alert.method ? <span className="font-semibold">{alert.method} </span> : null}{routeText(alert.path)}</>, 'wrap-anywhere')}
      </Fact>,
    );
  } else if (alert.kind === 'system_failing' && alert.detail === 'route') {
    rows.push(<Fact key="route" label={t.reqLogRoute}>{latin(<span className="font-semibold">{alert.method}</span>)} <span className="text-muted">{t.reqLogUnknownRoute}</span></Fact>);
  }
  if (alert.part) rows.push(<Fact key="part" label={t.alertPart}>{partName(t, alert.part)}</Fact>);
  switch (alert.kind) {
    case 'many_accounts':
      if (alert.detail) rows.push(<Fact key="names" label={t.alertNamesTried}>{latin(alert.detail)}</Fact>);
      break;
    case 'rate_limit':
      if (alert.detail) rows.push(<Fact key="limit" label={t.alertLimit}>{limits[alert.detail] ?? latin(alert.detail)}</Fact>);
      break;
    case 'probing':
      rows.push(
        <Fact key="answer" label={t.alertAnswer}>
          <span>{latin(alert.detail)} · {alert.detail === '401' ? t.alertProbe401 : t.alertProbe404}</span>
        </Fact>,
      );
      break;
    case 'system_failing':
      if (alert.detail === 'share') rows.push(<Fact key="scope" label={t.alertScope}>{t.alertScopeAll}</Fact>);
      break;
    case 'slow':
      if (/^\d+$/.test(alert.detail)) rows.push(<Fact key="p95" label={t.reqLogP95}>{latin(millis(Number(alert.detail)))}</Fact>);
      break;
    default:
      break;
  }
  return <>{rows}</>;
}

function AlertCard({
  alert,
  now,
  marked,
  busy,
  onSeen,
}: {
  alert: SystemAlert;
  now: number;
  marked: boolean;
  busy: boolean;
  onSeen: (alert: SystemAlert) => void;
}) {
  const { t, locale } = usePrefs();
  const meanings = t.alertMeaning as Record<string, string | undefined>;
  const todos = t.alertTodos as Record<string, string | undefined>;
  const Icon = ICONS[alert.kind] ?? Ban;
  const open = alert.state === 'open';
  const tone = open ? (WARNING_KINDS.includes(alert.kind) ? 'warning' : 'danger') : 'muted';
  const ago = (iso: string) => {
    const seconds = secondsSince(iso, now);
    return seconds < 10 ? t.justNow : t.sysAgo.replace('{span}', span(locale as Locale, seconds));
  };
  // A state's own figure (a service down, slowness) counts the worker's rounds, not events: it is not shown.
  const counted = alert.kind !== 'service_down' && alert.kind !== 'slow';
  const unseen = open && !alert.seenAt;

  return (
    <Pane
      id={`alert-${alert.id}`}
      className={cn(CARD, marked && 'ring-2 ring-accent')}
      data-testid="alert-card"
      data-alert={alert.id}
      data-kind={alert.kind}
      data-state={alert.state}
      data-marked={marked ? '' : undefined}
      aria-current={marked ? 'true' : undefined}
    >
      <header className={PANE_HEAD}>
        <h3 className={PANE_TITLE}>
          <Icon size={16} aria-hidden="true" className={cn('flex-none', open ? (tone === 'warning' ? 'text-warning' : 'text-danger') : 'text-muted')} />
          {alertKindName(t, alert.kind)}
        </h3>
        <span className="flex flex-wrap items-center justify-end gap-1.5">
          {unseen ? <Badge variant="info">{t.alertNew}</Badge> : null}
          <Badge variant={tone} dot={open}>{open ? t.alertOpen : t.alertClosed}</Badge>
        </span>
      </header>
      <div className={BODY}>
        <p className={cn('m-0 text-md font-semibold', open ? 'text-ink' : 'text-muted')}>{meanings[alert.kind] ?? ''}</p>
        {alert.kind === 'password_cracking' && alert.detail === 'locked' ? <p className="m-0 text-md text-danger">{t.alertLocked}</p> : null}
        <Facts variant="list">
          <SubjectFacts alert={alert} />
          {counted ? <Fact label={t.reqLogCalls}>{latin(alert.count.toLocaleString('en'))}</Fact> : null}
          <Fact label={t.alertSince}>
            <span>
              {ago(alert.firstAt)}
              <span className={CELL_SUB}>{latin(latinWhen(alert.firstAt, true), 'tabular-nums')}</span>
            </span>
          </Fact>
          {open ? (
            <Fact label={t.errLastAt}>
              <span>
                {ago(alert.lastAt)}
                <span className={CELL_SUB}>{latin(latinWhen(alert.lastAt, true), 'tabular-nums')}</span>
              </span>
            </Fact>
          ) : (
            <>
              <Fact label={t.alertLasted}>{span(locale as Locale, (new Date(alert.lastAt).getTime() - new Date(alert.firstAt).getTime()) / 1000)}</Fact>
              {alert.closedAt ? (
                <Fact label={t.alertEndedAt}>
                  <span>
                    {ago(alert.closedAt)}
                    <span className={CELL_SUB}>{latin(latinWhen(alert.closedAt, true), 'tabular-nums')}</span>
                  </span>
                </Fact>
              ) : null}
            </>
          )}
          <Fact label={t.alertSeenLabel}>
            {alert.seenAt ? (
              <span className="text-muted">
                {t.alertSeenBy.split(/(\{login\}|\{ago\})/).map((piece, index) => {
                  if (piece === '{login}') return <AccountName key={index} login={alert.seenByLoginName || null} />;
                  if (piece === '{ago}') return <span key={index}>{ago(alert.seenAt as string)}</span>;
                  return piece;
                })}
              </span>
            ) : (
              <span className={unseen ? 'text-ink' : 'text-muted'}>{t.alertNotSeen}</span>
            )}
          </Fact>
        </Facts>
        {todos[alert.kind] ? (
          <p className={TODO}>
            <span className="font-bold">{t.alertTodo}: </span>
            {todos[alert.kind]}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={requestsHref(alert.link)}>
              <ScrollText size={15} aria-hidden="true" />
              {t.alertShowRequests}
            </Link>
          </Button>
          {alert.kind === 'service_down' || alert.kind === 'slow' ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/system">
                <Gauge size={15} aria-hidden="true" />
                {t.navSystemStatus}
              </Link>
            </Button>
          ) : null}
          {alert.kind === 'system_failing' ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/system/errors">
                <Bug size={15} aria-hidden="true" />
                {t.navErrors}
              </Link>
            </Button>
          ) : null}
          {unseen ? (
            <Button type="button" size="sm" disabled={busy} onClick={() => onSeen(alert)} data-testid="alert-seen">
              <Eye size={15} aria-hidden="true" />
              {t.alertMarkSeen}
            </Button>
          ) : null}
        </div>
      </div>
    </Pane>
  );
}

function AlertSkeleton() {
  return (
    <Pane className={CARD} aria-hidden="true">
      <div className={PANE_HEAD}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-14" />
      </div>
      <div className={SKELETON_BODY}>
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3.5 w-2/5" />
      </div>
    </Pane>
  );
}

/** The early warnings (spec 2026-11-17-system-monitor, section 4): the branch owner's page. */
export function AlertsScreen() {
  return useSystemOwner() ? <AlertsDesk /> : null;
}

function AlertsDesk() {
  const { t, apiText } = usePrefs();
  const { me, refresh: refreshMe } = useDesk();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [clearing, setClearing] = useState(false);
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const state: StateFilter = filters.state === 'open' || filters.state === 'closed' ? filters.state : '';
  const wanted = filters.id;

  // The first page asks again on the rules' beat. Older pages are read on demand («عرض المزيد», or to find the alert
  // the address names) and kept beside it; the first page's copy of an alert wins over theirs.
  const first = useApiQuery(['api', 'system', 'alerts', state], () => api.alerts({ state: state || undefined }), { every: REFRESH_MS });
  const [older, setOlder] = useState<{ state: StateFilter; rows: SystemAlert[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const olderHere = older && older.state === state ? older : null;
  const next = olderHere ? olderHere.next : (first.data?.nextCursor ?? null);
  const alerts = useMemo(() => {
    const head = first.data?.items ?? [];
    const seen = new Set(head.map((row) => row.id));
    return [...head, ...(olderHere?.rows ?? []).filter((row) => !seen.has(row.id))];
  }, [first.data, olderHere]);

  // The time spans count from the moment the list was read, and move on with each refresh.
  const [now, setNow] = useState(() => Date.now());
  const readAt = first.data ? first.data : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock follows each answer of the list
    setNow(Date.now());
  }, [readAt]);

  const loadMore = useCallback(async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    const result = await api.alerts({ state: state || undefined, cursor: next });
    setLoadingMore(false);
    if (!result.ok) {
      setError(apiText(result));
      return;
    }
    setOlder((current) => ({
      state,
      rows: [...(current && current.state === state ? current.rows : []), ...result.data.items],
      next: result.data.nextCursor,
    }));
  }, [next, loadingMore, state, apiText]);

  const reload = useCallback(async () => {
    setOlder(null);
    await first.reload();
  }, [first]);
  const { run, busy } = useAction({ setError, setNote, onDone: reload });

  // The bell's notice names one alert: the pages are read on, following the cursor, until it is found or the list
  // ends; found, it is ringed and scrolled into view once.
  const found = wanted ? alerts.some((row) => row.id === wanted) : false;
  const listed = first.data !== null;
  const missing = Boolean(wanted) && listed && !found && !next && !loadingMore;
  useEffect(() => {
    // Reading the next page is a request; its answer lands in state after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (wanted && listed && !found && next && !loadingMore) void loadMore();
  }, [wanted, listed, found, next, loadingMore, loadMore]);
  const scrolled = useRef('');
  useEffect(() => {
    if (!wanted || !found || scrolled.current === wanted) return;
    scrolled.current = wanted;
    const card = document.getElementById(`alert-${wanted}`);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  }, [wanted, found]);

  // The sidebar's count is `me.openAlerts`: when the whole list is read and it disagrees (an alert opened or ended
  // since `me` was read), `me` is read again.
  const openUnseen = alerts.filter((row) => row.state === 'open' && !row.seenAt).length;
  const whole = listed && !next && state !== 'closed';
  const counted = me?.openAlerts;
  useEffect(() => {
    if (whole && counted !== undefined && counted !== openUnseen) void refreshMe();
  }, [whole, counted, openUnseen, refreshMe]);

  function markSeen(alert: SystemAlert) {
    void run(() => api.markAlertSeen(alert.id), { note: t.alertMarkedSeen });
  }

  function clearAlerts() {
    void run(() => api.clearAlerts(), {
      note: (answer) => t.alertsCleared.replace('{n}', answer.removed.toLocaleString('en')),
      then: () => setClearing(false),
    });
  }

  const openRows = alerts.filter((row) => row.state === 'open');
  const closedRows = alerts.filter((row) => row.state === 'closed');
  const card = (row: SystemAlert) => <AlertCard key={row.id} alert={row} now={now} marked={row.id === wanted} busy={busy} onSeen={markSeen} />;
  const emptyTitle = state === 'open' ? t.alertsEmptyOpen : state === 'closed' ? t.alertsEmptyClosed : t.alertsEmpty;

  return (
    <Desk
      title={t.navAlerts}
      lede={t.alertsLede}
      error={error || (first.data ? first.error : '')}
      note={note}
      action={(
        <Button type="button" variant="danger" onClick={() => { setError(''); setClearing(true); }}>
          <Trash2 size={15} aria-hidden="true" />
          {t.alertsClear}
        </Button>
      )}
    >
      {/* One chip: it stays on the page on a phone too (no «كل الفلاتر» drawer for a single choice). */}
      <FilterBar loose bare>
        <label>
          {t.alertsState}
          <Select value={state} onValueChange={(value) => { setOlder(null); setFilters({ state: value }); }}>
            <SelectItem value="">{t.allRows}</SelectItem>
            <SelectItem value="open">{t.alertsOpenOnly}</SelectItem>
            <SelectItem value="closed">{t.alertsClosedOnly}</SelectItem>
          </Select>
        </label>
      </FilterBar>
      {missing ? (
        <p className="m-0 text-md font-semibold text-warning" role="status" data-testid="alert-missing">{t.alertNotFound}</p>
      ) : null}
      {!first.data && first.loaded ? (
        <Pane>
          <LoadFailed message={first.error} onRetry={() => void first.reload()} busy={first.fetching} />
        </Pane>
      ) : !first.data ? (
        <div className={GRID}>
          {Array.from({ length: SKELETONS }, (_, index) => <AlertSkeleton key={index} />)}
        </div>
      ) : alerts.length === 0 ? (
        <Pane className="grid justify-items-center gap-1.5 px-4.5 py-8 text-center" data-testid="alerts-empty" role="status">
          <span className="grid size-10 place-items-center rounded-pill bg-success-soft text-success" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <p className="m-0 text-item font-bold text-ink">{emptyTitle}</p>
          {state === '' ? <p className="m-0 text-md text-muted">{t.alertsEmptyText}</p> : null}
        </Pane>
      ) : (
        <>
          {openRows.length > 0 ? (
            <section className="grid gap-2 [.desk_&]:flex-none" aria-labelledby="alerts-open" data-testid="alerts-open">
              <h2 id="alerts-open" className={PART_TITLE}>{t.alertsOpenTitle} · {latin(openRows.length.toLocaleString('en'))}</h2>
              <div className={GRID}>{openRows.map(card)}</div>
            </section>
          ) : state !== 'closed' ? (
            <p className="m-0 inline-flex items-center gap-2 text-md text-muted" role="status">
              <CheckCheck size={16} aria-hidden="true" className="text-success" />
              {t.alertsEmptyOpen}
            </p>
          ) : null}
          {closedRows.length > 0 ? (
            <section className="grid gap-2 [.desk_&]:flex-none" aria-labelledby="alerts-closed" data-testid="alerts-closed">
              <h2 id="alerts-closed" className={PART_TITLE}>{t.alertsClosedTitle}</h2>
              <div className={GRID}>{closedRows.map(card)}</div>
            </section>
          ) : null}
          {next ? (
            <Button type="button" variant="secondary" className="self-center" disabled={loadingMore} aria-busy={loadingMore} onClick={() => void loadMore()}>
              {t.alertsMore}
            </Button>
          ) : null}
        </>
      )}
      <Dialog
        open={clearing}
        size="confirm"
        title={t.alertsClear}
        lede={t.alertsClearHint}
        mark="trash"
        tone="danger"
        closeLabel={t.closeMenu}
        error={error}
        onClose={() => { if (!busy) setClearing(false); }}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setClearing(false)}>{t.cancel}</Button>
            <Button type="button" variant="danger" disabled={busy} onClick={clearAlerts}>{t.alertsClear}</Button>
          </>
        )}
      >
        <p className="m-0 text-md text-muted">{t.alertsClearKeep}</p>
      </Dialog>
    </Desk>
  );
}
