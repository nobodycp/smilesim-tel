'use client';

import { Banknote, Briefcase, Building2, Network, CalendarCheck, CalendarClock, CalendarRange, Check, Copy, Gauge, Hash, MessageSquare, Package, Phone, QrCode, RefreshCw, Smartphone, Store, Wifi, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AccountName } from '../../components/account-name';
import { Money, latinWhen } from '../../components/desk';
import { Button } from '../../components/ui/button';
import { IconButton } from '../../components/ui/icon-button';
import type { LineDetail } from '../../lib/api';
import { cn } from '../../lib/cn';
import { daysLeft } from '../../lib/days-left';
import { usePrefs } from '../../lib/prefs';

/*
 * The look (Tailwind migration T4.5, ADR 0022), ported from desk/pane.css, desk/numbers.css and graphite.css in their
 * cascade order:
 * - the tab's body: a grid of sections with no gap, 14px / 18px / 18px padding, 6px corners on `--rd-surface` with a 1px
 *   inset `--rd-line` edge (the number card's pane is bare: `.line-pane .line-details`); in the desk it scrolls inside
 *   the pane (`.desk .pane > .pane-body`); each section 16px / 20px inside (14px under 641px), a 1px `--rd-line` rule
 *   between them;
 * - a section's title: 13px ink bold with its glyph in `--rd-accent`, 8px apart; a section head spreads the title and
 *   what is beside it to both ends, 6px by 12px apart when it wraps;
 * - the period: the days left 12px `--rd-ink-2` with the figure 16px bold ink (`--rd-warning` within three days); the
 *   bar 8px high, 14px over and 10px under, a pill on `--rd-surface-2` with a 1px inset `--rd-line` edge, its fill at
 *   least 8px wide, from `--rd-accent` at 55% to `--rd-accent` along the reading direction; the two ends 12px apart,
 *   13px ink bold under their 11px `--rd-muted` 600 names, the second at the reading end;
 * - the usage: three columns 16px apart, 12px under the head (one column 12px apart under 641px); a meter is a 52px
 *   round `--rd-accent-soft` ring (a dashed 3px track of ink at 12%, a 20px `--rd-accent` glyph) 12px from its text:
 *   the name 11px `--rd-muted` 600, the figure 16px ink bold at 1.2, the allowance 12px `--rd-ink-2`;
 * - the groups: two columns 24px apart (one column 16px apart at 900px and under), each a column 12px apart; its facts
 *   two to a row 8px apart; a fact a row 12px apart with 10px / 12px padding (8px / 4px under 641px) and 6px corners,
 *   `--rd-surface-2` under the pointer; `wide` (and, under 641px, one holding a copy button) takes the whole row; its
 *   mark 36px, 6px corners, `--rd-ink-2` on `--rd-surface-2`; its name 11px `--rd-muted` 600 over its value 13px ink
 *   bold at 1.35, breaking anywhere;
 * - the SIM kind: a 24px tag, 10px sides, 4px corners, 12px bold `--rd-accent` on `--rd-accent-soft`;
 * - a copied value: one row 6px apart, the figures spaced 0.02em and breaking anywhere.
 */
const BODY = cn(
  'grid min-h-0 content-start gap-0 overflow-auto rounded-sm bg-surface px-4.5 pt-3.5 pb-4.5 inset-ring inset-ring-line',
  '*:min-w-0 *:px-5 *:py-4 max-sm:*:p-3.5 [&>*+*]:border-t [&>*+*]:border-line',
);
const TITLE = 'm-0 inline-flex items-center gap-2 text-md font-bold text-ink [&_svg]:text-accent';
const HEAD = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5';
const END = 'grid gap-0.5 text-md font-bold text-ink';
const END_NAME = 'text-xs font-semibold text-muted';

/**
 * The number's «التفاصيل» tab (owner, 2026-11-11): the subscription period as a timeline, the usage against the
 * package's allowance as three rings, then the subscription and the SIM as key and value rows under a titled head.
 * No cards. The API has no usage figures yet, so each ring shows «—» over the allowance until providers report it.
 */
export function LineDetails({ line, isPos, onQr }: { line: LineDetail; isPos: boolean; onQr: () => void }) {
  const { t } = usePrefs();
  // The moment the tab opened: the timeline does not move while it is open.
  const [now] = useState(() => Date.now());
  const start = line.lastRechargeAt ?? line.createdAt;
  const total = Math.max(1, new Date(line.endsAt).getTime() - new Date(start).getTime());
  const done = Math.min(1, Math.max(0, (now - new Date(start).getTime()) / total));
  const left = daysLeft(line.endsAt, now);
  const allowance = (value: number | null | undefined, unit: string) => (
    value == null ? '—' : value < 0 ? t.unlimited : `${value} ${unit}`
  );

  return (
    <div className={BODY} data-slot="line-details">
      <section aria-label={t.periodTitle}>
        <div className={HEAD}>
          <span className={TITLE}><CalendarRange size={16} aria-hidden="true" />{t.periodTitle}</span>
          <span className="text-sm text-ink-2"><b className={cn('text-xl font-bold', left <= 3 ? 'text-warning' : 'text-ink')}>{left}</b> {t.dayUnit}</span>
        </div>
        <div
          className="relative mt-3.5 mb-2.5 h-2 overflow-hidden rounded-pill bg-surface-2 inset-ring inset-ring-line"
          role="progressbar"
          aria-label={t.periodTitle}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(done * 100)}
        >
          <span
            className="block h-full min-w-2 rounded-[inherit] bg-linear-90/srgb from-accent/55 to-accent rtl:bg-linear-270/srgb"
            style={{ inlineSize: `${Math.round(done * 100)}%` }}
          />
        </div>
        <div className="flex justify-between gap-3">
          <span className={END}><small className={END_NAME}>{line.lastRechargeAt ? t.lastRecharge : t.activatedOn}</small><bdi dir="ltr">{latinWhen(start).slice(0, 10)}</bdi></span>
          <span className={cn(END, 'text-end')}><small className={END_NAME}>{t.endsOn}</small><bdi dir="ltr">{latinWhen(line.endsAt).slice(0, 10)}</bdi></span>
        </div>
      </section>

      <section aria-label={t.usage}>
        <div className={HEAD}>
          <span className={TITLE}><Gauge size={16} aria-hidden="true" />{t.usage}</span>
          <span className="m-0 text-sm text-muted">{t.usageHint}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-4 max-sm:grid-cols-1 max-sm:gap-3">
          <Meter icon={Wifi} label={t.internet} total={allowance(line.dataGb, t.gbUnit)} />
          <Meter icon={Phone} label={t.minutes} total={allowance(line.minutes, t.minuteUnit)} />
          <Meter icon={MessageSquare} label={t.messages} total={allowance(line.smsCount, t.messageUnit)} />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-6 max-lg:grid-cols-1 max-lg:gap-4">
        <Group icon={CalendarRange} title={t.subscriptionSection}>
          <Row icon={Building2} label={t.company}>{line.companyName || '—'}</Row>
          <Row icon={Package} label={t.packageName}>{line.packageName}</Row>
          {line.months ? <Row icon={CalendarClock} label={t.packagePeriod}>{line.months === 1 ? t.monthOne : line.months === 2 ? t.monthTwo : <><span>{line.months}</span> {t.months}</>}</Row> : null}
          <Row icon={Banknote} label={t.subscriptionPrice}><Money value={line.subscriberPrice ?? line.posPrice} /></Row>
          <Row icon={CalendarCheck} label={t.activatedOn}><bdi dir="ltr">{latinWhen(line.createdAt).slice(0, 10)}</bdi></Row>
          <Row icon={RefreshCw} label={t.lastRecharge}>{line.lastRechargeAt ? <bdi dir="ltr">{latinWhen(line.lastRechargeAt)}</bdi> : '—'}</Row>
          {line.mainAgentLoginName ? <Row icon={Network} label={t.layerMain}><AccountName login={line.mainAgentLoginName} /></Row> : null}
          {line.agentLoginName ? <Row icon={Briefcase} label={t.layerAgent}><AccountName login={line.agentLoginName} /></Row> : null}
          {!isPos && line.posLoginName ? <Row icon={Store} label={t.pointOfSale} wide><AccountName login={line.posLoginName} /></Row> : null}
        </Group>
        <Group icon={Smartphone} title={t.simSection}>
          <Row icon={Smartphone} label={t.simType}>
            <span className="inline-flex h-6 items-center rounded-xs bg-accent-soft px-2.5 text-sm font-bold text-accent">{line.esim ? t.esim : t.physicalSim}</span>
          </Row>
          <Row icon={Phone} label={t.number}><CopyValue value={line.msisdn} /></Row>
          <Row icon={Hash} label={t.simSerial} wide>{line.iccid ? <CopyValue value={line.iccid} /> : '—'}</Row>
          {line.esim && line.esimQr ? (
            <Row icon={QrCode} label={t.esimQr} wide><Button type="button" variant="secondary" size="sm" onClick={onQr}><QrCode size={15} strokeWidth={1.75} aria-hidden="true" />{t.showQr}</Button></Row>
          ) : null}
        </Group>
      </div>
    </div>
  );
}

function Meter({ icon: Icon, label, total }: { icon: LucideIcon; label: string; total: string }) {
  const { t } = usePrefs();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="relative grid size-13 flex-none place-items-center rounded-pill bg-accent-soft" aria-hidden="true">
        <svg className="absolute inset-0 size-full" viewBox="0 0 44 44">
          <circle className="fill-none stroke-ink/12 stroke-3 [stroke-dasharray:3_4]" cx="22" cy="22" r="19" />
        </svg>
        <Icon className="size-5 text-accent" size={18} strokeWidth={1.8} />
      </span>
      <span className="grid min-w-0 gap-px">
        <span className="text-xs font-semibold text-muted">{label}</span>
        <b className="text-xl leading-1-2 font-bold text-ink">—</b>
        <small className="text-sm text-ink-2">{total === t.unlimited || total === '—' ? total : t.ofAllowance.replace('{total}', total)}</small>
      </span>
    </div>
  );
}

function Group({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-3" aria-label={title}>
      <h3 className={TITLE}><Icon size={16} aria-hidden="true" />{title}</h3>
      <dl className="m-0 grid grid-cols-2 gap-2">{children}</dl>
    </section>
  );
}

/** One fact: a small tinted mark, its name above its value, close together so the eye reads them as one. */
function Row({ icon: Icon, label, wide = false, children }: { icon: LucideIcon; label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-sm px-3 py-2.5 transition-colors duration-fast ease-standard hover:bg-surface-2',
        'max-sm:px-1 max-sm:py-2 max-sm:has-[[data-slot=copy-value]]:col-span-full',
        wide && 'col-span-full',
      )}
    >
      <span className="grid size-9 flex-none place-items-center rounded-sm bg-surface-2 text-ink-2" aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span>
      <span className="grid min-w-0 gap-0.5">
        <dt className="text-xs font-semibold text-muted">{label}</dt>
        <dd className="m-0 min-w-0 text-md leading-1-35 font-bold text-ink wrap-anywhere">{children}</dd>
      </span>
    </div>
  );
}

/** A Latin value (number, serial) with a copy button beside it. `data-slot="copy-value"` is its handle. */
export function CopyValue({ value }: { value: string }) {
  const { t } = usePrefs();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-slot="copy-value">
      <bdi dir="ltr" className="tracking-head wrap-anywhere">{value}</bdi>
      <IconButton
        size="sm"
        tone="faint-to-ink"
        className="flex-none"
        aria-label={`${t.copy} ${value}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </IconButton>
    </span>
  );
}
