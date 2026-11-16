'use client';

import { ArrowDownRight, ArrowUpRight, Zap } from 'lucide-react';
import Link from 'next/link';
import { AccountName } from '../../components/account-name';
import { Money, Pane, actionName, latinWhen } from '../../components/desk';
import { EmptyState } from '../../components/empty-state';
import { Button } from '../../components/ui/button';
import { LoadFailed } from '../../components/load-failed';
import { Spinner, TableSkeleton } from '../../components/loading';
import { pointerGlowClass } from '../../components/stat';
import { TrendLine } from '../../components/trend-line';
import { cn } from '../../lib/cn';
import type { FinanceSummary, HomePayload, OverviewPayload, PulseTotals, TaskRow } from '../../lib/api';
import { noticeAge } from '../../lib/notice-text';
import { formatShekel } from '../../lib/money';
import { usePrefs } from '../../lib/prefs';
import { PANE_BODY, PANE_HEAD, PANE_HINT, PANE_TITLE } from './home-panes';

type Period = OverviewPayload['period'];

/*
 * The change chip in a period card's corner (legacy `.change`, graphite.css): 12px from the top and 14px from the
 * inline end, above the trend; a 22px pill, 2px between the arrow and the figure, 7px padding, 11.5px bold. Up is
 * `--rd-success` on its soft fill, down `--rd-danger` on its soft fill, no change `--rd-muted` on `--rd-surface-2`.
 * `data-trend` names the direction.
 */
const CHANGE = 'absolute top-3 end-3.5 z-1 inline-flex h-5.5 items-center gap-0.5 rounded-pill px-1.75 text-caption font-bold';
const CHANGE_TONE = {
  up: 'bg-success-soft text-success',
  down: 'bg-danger-soft text-danger',
  flat: 'bg-surface-2 text-muted',
} as const;

/** The relative change against the same span before: up or down, in percent; nothing over all time. */
function Change({ now, before, period }: { now: number; before: number | null | undefined; period: Period }) {
  const { t } = usePrefs();
  if (period === 'all' || before === null || before === undefined) return null;
  const versus = period === 'day' ? t.vsYesterday : t.vsLastMonth;
  if (before === 0 && now === 0) return <span className={cn(CHANGE, CHANGE_TONE.flat)} data-trend="flat" data-testid="pulse-change" title={versus}>0%</span>;
  if (before === 0) return <span className={cn(CHANGE, CHANGE_TONE.up)} data-trend="up" data-testid="pulse-change" title={versus}><ArrowUpRight size={13} aria-hidden="true" />{t.changeNew}</span>;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  const up = pct >= 0;
  const trend = pct === 0 ? 'flat' : up ? 'up' : 'down';
  return (
    <span className={cn(CHANGE, CHANGE_TONE[trend])} data-trend={trend} data-testid="pulse-change" title={versus} aria-label={`${up ? '+' : ''}${pct}% ${versus}`}>
      {pct === 0 ? null : up ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
      <bdi dir="ltr">{Math.abs(pct)}%</bdi>
    </span>
  );
}

// A step is an hour (YYYY-MM-DDTHH), a day (YYYY-MM-DD) or a month (YYYY-MM).
const stepLabel = (period: Period, at: string) => (at.length === 13 ? (period === 'day' ? `${at.slice(11)}:00` : `${at.slice(5, 10)} ${at.slice(11)}:00`) : at.length === 10 ? at.slice(5) : at);

/*
 * The account band (Tailwind migration T4.1), ported from desk/home.css and graphite.css in their cascade order:
 * - the band: a grid 12px apart, two columns; from 1100px the lead and four cards (1.35fr, then four equal); under
 *   640px the fourth card takes the whole row. The branch's band is three equal columns, one under 768px. Its cards
 *   rise in (8px, 420ms), the second to the fourth 40ms after the one before, when motion is allowed;
 * - a card (`data-slot="figure-tile"`, `"pulse-tile"`): a column 6px apart, 14px / 16px padding (12px all round under
 *   640px), 8px corners on `--rd-surface` with a 1px inset `--rd-line` edge and the tag's cut corner (`--rd-cut`) at
 *   the top inline end; a soft `--rd-glow` light under the pointer (the shell sets `--mx` / `--my`) and, when motion
 *   is allowed, a 2px lift. A figure card is at least 112px high (no minimum under 640px), a period card 128px at every
 *   width; in a period card the words lie above the trend and let the pointer through to it;
 * - the lead card: its edge `--rd-accent` at 35% over `--rd-line`, a 2px `--rd-accent` thread along its top up to the
 *   cut, its figure 1.9rem (1.6rem under 640px); it takes the whole row under 1100px;
 * - the name 12px `--rd-muted` 500; the figure 1.45rem bold, 1.25 line height, -0.01em, tabular (1.2rem under 640px);
 *   the caption at the card's foot, 12px `--rd-muted`, 1.6 line height; the unit 6px after the figure, 12px
 *   `--rd-muted` 500;
 * - the ceiling's twenty ticks, 3px apart, 4px under the figure: 6px high, 1px corners, `--rd-surface-2` with a 1px
 *   inset `--rd-line` edge, the used ones `--rd-accent` with no edge.
 */
const BAND_RISE = cn(
  'motion-safe:*:animate-rise',
  'motion-safe:[&>:nth-child(2)]:[animation-delay:40ms] motion-safe:[&>:nth-child(3)]:[animation-delay:80ms] motion-safe:[&>:nth-child(4)]:[animation-delay:120ms]',
);
const BAND = cn('grid grid-cols-2 gap-3 xl:grid-cols-[1.35fr_repeat(4,minmax(0,1fr))] max-sm:[&>:nth-child(4)]:col-span-full', BAND_RISE);
const BRANCH_BAND = cn('grid grid-cols-3 gap-3 max-md:grid-cols-1', BAND_RISE);
const TILE = cn(
  'relative isolate flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-card bg-surface px-4 py-3.5 inset-ring inset-ring-line max-sm:p-3',
  '[clip-path:polygon(0_0,calc(100%_-_var(--rd-cut))_0,100%_var(--rd-cut),100%_100%,0_100%)]',
  'rtl:[clip-path:polygon(var(--rd-cut)_0,100%_0,100%_100%,0_100%,0_var(--rd-cut))]',
  pointerGlowClass,
);
const FIGURE_TILE = cn(TILE, 'min-h-28 max-sm:min-h-0');
const LEAD_TILE = cn(
  FIGURE_TILE,
  'inset-ring-accent/35 shadow-edge max-xl:col-span-full',
  "before:absolute before:start-0 before:end-(--rd-cut) before:top-0 before:h-0.5 before:bg-accent before:content-['']",
);
const PULSE_TILE = cn(TILE, 'min-h-32');
// In a period card the words sit above the trend and let the pointer through to it.
const OVER_TREND = 'relative z-1 pointer-events-none';
const TILE_LABEL = 'text-sm font-medium text-muted';
const TILE_VALUE = 'text-figure leading-1-25 font-bold tracking-figure tabular-nums max-sm:text-figure-sm';
const LEAD_VALUE = 'text-figure-lead leading-1-25 font-bold tracking-figure tabular-nums max-sm:text-figure-lead-sm';
const TILE_META = 'mt-auto block text-sm leading-1-6 text-muted';

/**
 * The top of the home page (approved Graphite design, owner 2026-11-09): the available balance with its ceiling as
 * twenty ticks, then three cards that follow the period switch — sales (every sale operation and its volume), new
 * subscriptions (activations) and profit — each with its change against the same span of yesterday or last month in
 * the corner and its trend inside, and the active numbers with those ending within three days.
 */
export function AccountBand({ summary, home, overview, period, branch = false }: { summary: FinanceSummary | null | undefined; home: HomePayload | null | undefined; overview: OverviewPayload | null | undefined; period: Period; branch?: boolean }) {
  const { t } = usePrefs();
  const held = summary?.held ?? 0;
  const available = summary ? (summary.unlimited ? summary.balance : summary.balance + summary.ceiling - held) : 0;
  const used = summary && !summary.unlimited && summary.ceiling > 0 ? Math.max(0, -summary.balance) + held : 0;
  const share = summary && !summary.unlimited && summary.ceiling > 0 ? Math.min(1, used / summary.ceiling) : 0;
  const ticks = Math.round(share * 20);
  const ceilingMeta = summary && !summary.unlimited && summary.ceiling > 0
    ? t.ceilingShareMeta.replace('{n}', String(Math.round(share * 100))).replace('{held}', `${formatShekel(held)} ₪`)
    : t.heldMeta.replace('{held}', `${formatShekel(held)} ₪`);
  const pulse = overview?.pulse;
  const now: PulseTotals | undefined = pulse?.current;
  const before = pulse?.previous;
  const labels = pulse ? pulse.trend.map((point) => stepLabel(period, point.at)) : [];
  const periodName = period === 'day' ? t.periodToday : period === 'month' ? t.periodMonth : t.periodAll;
  const trend = (pick: (point: PulseTotals) => number, money: boolean, name: string, tone: 'accent' | 'success' = 'accent') => (pulse ? (
    <TrendLine
      values={pulse.trend.map(pick)}
      labels={labels}
      format={(value) => (money ? `${formatShekel(value)} ₪` : String(value))}
      label={`${name} · ${periodName}`}
      tone={tone}
    />
  ) : null);
  return (
    <section className={branch ? BRANCH_BAND : BAND} aria-label={t.homeTitle} data-testid="account-band">
      {/* The branch's band is the period's three figures: no available balance, no active numbers (spec
          2026-11-09-admin-review, 6.3; the numbers are in the donut below). */}
      {branch ? null : <div className={LEAD_TILE} data-slot="figure-tile" data-testid="figure-tile">
        <span className={TILE_LABEL}>{t.homeAvailable}</span>
        <div className={LEAD_VALUE}>{summary ? <Money value={available} /> : '—'}</div>
        {summary && !summary.unlimited && summary.ceiling > 0 ? (
          <div className="mt-1 flex gap-0.75" role="img" aria-label={ceilingMeta}>
            {Array.from({ length: 20 }, (_, index) => <i key={index} className={cn('h-1.5 flex-1 rounded-4xs', index < ticks ? 'bg-accent' : 'bg-surface-2 inset-ring inset-ring-line')} />)}
          </div>
        ) : null}
        <div className={TILE_META}>{summary ? ceilingMeta : null}</div>
      </div>}
      <div className={PULSE_TILE} data-slot="pulse-tile" data-testid="pulse-tile">
        <span className={cn(TILE_LABEL, OVER_TREND)}>{t.homeSales}</span>
        {now ? <Change now={now.amount} before={before?.amount} period={period} /> : null}
        <div className={cn(TILE_VALUE, OVER_TREND)}>{now ? now.count : '—'}<small className="ms-1.5 text-sm font-medium text-muted">{t.operationsUnit}</small></div>
        <div className={cn(TILE_META, OVER_TREND)}>{now ? <>{t.volumeWord} <Money value={now.amount} /></> : null}</div>
        {trend((point) => point.amount, true, t.homeSales)}
      </div>
      <div className={PULSE_TILE} data-slot="pulse-tile" data-testid="pulse-tile">
        <span className={cn(TILE_LABEL, OVER_TREND)}>{t.homeNewSubscriptions}</span>
        {now ? <Change now={now.activations} before={before?.activations} period={period} /> : null}
        <div className={cn(TILE_VALUE, OVER_TREND)}>{now ? now.activations : '—'}</div>
        <div className={cn(TILE_META, OVER_TREND)}>{periodName}</div>
        {trend((point) => point.activations, false, t.homeNewSubscriptions, 'success')}
      </div>
      <div className={PULSE_TILE} data-slot="pulse-tile" data-testid="pulse-tile">
        <span className={cn(TILE_LABEL, OVER_TREND)}>{t.homeProfit}</span>
        {now ? <Change now={now.profit} before={before?.profit} period={period} /> : null}
        <div className={cn(TILE_VALUE, OVER_TREND)}>{now ? <Money value={now.profit} signed /> : '—'}</div>
        <div className={cn(TILE_META, OVER_TREND)}>{periodName}</div>
        {trend((point) => point.profit, true, t.homeProfit, 'success')}
      </div>
      {branch ? null : <div className={FIGURE_TILE} data-slot="figure-tile" data-testid="figure-tile">
        <span className={TILE_LABEL}>{t.homeActiveLines}</span>
        <div className={TILE_VALUE}>{home ? home.activeLines : '—'}</div>
        <div className={TILE_META}>
          {home ? <><span className={home.expiringLines ? 'text-accent' : undefined}>{t.expiringMeta.replace('{n}', String(home.expiringLines))}</span> · <Link className="font-bold text-inherit no-underline" href="/numbers?status=expiring">{t.showThem}</Link></> : null}
        </div>
      </div>}
    </section>
  );
}

type Movement = HomePayload['operations'][number];

/*
 * The last operations (legacy `.op-list`, graphite.css): rows 12px apart in three columns (the operation, its detail,
 * the amount and time at the end), 10px / 18px padding, a 1px `--rd-line` rule between rows, every other row on
 * `--rd-surface-2` at 45%; the detail 12.5px `--rd-muted`, gone under 641px with its column. A row's account and time
 * are 12px `--rd-muted`, 2px under the line above them.
 */
const OP_ROW = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 border-t border-line px-4.5 py-2.5 first:border-t-0 even:bg-surface-2/45 max-sm:grid-cols-title-end';
const SUB = 'text-sm text-muted';

export function LastOperations({ home, failed, onRetry, showAccount }: { home: HomePayload | null | undefined; failed: string; onRetry: () => void; showAccount: boolean }) {
  const { t } = usePrefs();
  const head = (
    <header className={PANE_HEAD}>
      <h2 className={PANE_TITLE}>{t.lastOps}</h2>
      <Button asChild variant="ghost" size="sm" className="ms-auto"><Link href="/finance?scope=operations">{t.allOperations}</Link></Button>
    </header>
  );
  if (!home) {
    return (
      <Pane>
        {head}
        {failed ? <LoadFailed message={failed} onRetry={onRetry} /> : <TableSkeleton rows={5} columns={3} />}
      </Pane>
    );
  }
  return (
    <Pane>
      {head}
      {home.operations.length === 0 ? (
        <EmptyState>{t.noMovements}</EmptyState>
      ) : (
        <ul className="m-0 list-none p-0">
          {home.operations.slice(0, 6).map((row: Movement) => (
            <li key={row.id} className={OP_ROW}>
              <span className="grid gap-0.5">
                <strong>{actionName(t, row.kind)}</strong>
                {showAccount ? <span className={SUB}><AccountName login={row.loginName} /></span> : null}
              </span>
              <span className="text-chip text-muted max-sm:hidden">{row.packageName || row.note || '—'}</span>
              <span className="grid gap-0.5 text-end">
                <Money value={row.amount} />
                <span className={SUB} dir="ltr">{latinWhen(row.at).slice(11)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}

/*
 * The tasks waiting (legacy `.waiting-list`, graphite.css): cards 10px apart, each a row 12px apart with 10px / 12px
 * padding and 6px corners on `--rd-surface-2` (a 1px inset `--rd-line` edge under the pointer): the task's mark, its
 * operation over the number, account and package (12px `--rd-muted`, 2px apart), and its age at the end. The mark is
 * the tasks list's (legacy `.task-mark`): 36px, 6px corners, `--rd-accent` on its soft fill, an 8px cut corner at the
 * top inline end.
 */
const TASK_MARK = cn(
  'grid size-9 flex-none place-items-center rounded-sm bg-accent-soft text-accent',
  '[clip-path:polygon(0_0,calc(100%_-_8px)_0,100%_8px,100%_100%,0_100%)] rtl:[clip-path:polygon(8px_0,100%_0,100%_100%,0_100%,0_8px)]',
);

export function WaitingTasks({ tasks, open, loading }: { tasks: TaskRow[]; open: number; loading: boolean }) {
  const { t } = usePrefs();
  return (
    <Pane>
      <header className={PANE_HEAD}>
        <h2 className={PANE_TITLE}>{t.tasksWaiting}</h2>
        {loading ? <Spinner /> : <span className={cn(PANE_HINT, 'ms-auto')}>{t.openMeta.replace('{n}', String(open))}</span>}
      </header>
      <div className={PANE_BODY}>
        {loading ? <TableSkeleton rows={3} columns={1} /> : tasks.length === 0 ? (
          <EmptyState>{t.noWaitingTasks}</EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {tasks.slice(0, 4).map((task) => (
              <li key={task.id}>
                <Link className="flex items-center gap-3 rounded-sm bg-surface-2 px-3 py-2.5 text-inherit no-underline hover:inset-ring hover:inset-ring-line" href={`/tasks/${task.id}`}>
                  <span className={TASK_MARK} aria-hidden="true"><Zap size={16} /></span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <strong>{actionName(t, task.action)}</strong>
                    <span className={SUB}><bdi dir="ltr">{task.msisdn ?? '—'}</bdi> · <AccountName login={task.posLoginName} /></span>
                    {task.packageName ? <span className={SUB}>{task.packageName}</span> : null}
                  </span>
                  {task.createdAt ? <span className={cn(SUB, 'flex-none')}>{noticeAge(t, task.createdAt)}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Pane>
  );
}
