'use client';

import { Banknote, Building2, CalendarCheck, CalendarClock, CalendarRange, Check, Copy, Gauge, Hash, MessageSquare, Package, Phone, QrCode, RefreshCw, Smartphone, Store, Wifi, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AccountName } from '../../components/account-name';
import { Money, latinWhen } from '../../components/desk';
import { Button } from '../../components/ui/button';
import type { LineRow } from '../../lib/api';
import { daysLeft } from '../../lib/days-left';
import { usePrefs } from '../../lib/prefs';

/**
 * The number's «التفاصيل» tab (owner, 2026-11-11): the subscription period as a timeline, the usage against the
 * package's allowance as three rings, then the subscription and the SIM as key and value rows under a titled head.
 * No cards. The API has no usage figures yet, so each ring shows «—» over the allowance until providers report it.
 */
export function LineDetails({ line, isPos, onQr }: { line: LineRow; isPos: boolean; onQr: () => void }) {
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
    <div className="pane-body line-details">
      <section className="ld-period" aria-label={t.periodTitle}>
        <div className="ld-period-head">
          <span className="ld-title"><CalendarRange size={16} aria-hidden="true" />{t.periodTitle}</span>
          <span className={left <= 3 ? 'ld-left soon' : 'ld-left'}><b className="num">{left}</b> {t.dayUnit}</span>
        </div>
        <div className="ld-bar" role="progressbar" aria-label={t.periodTitle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}>
          <span style={{ inlineSize: `${Math.round(done * 100)}%` }} />
        </div>
        <div className="ld-period-ends">
          <span><small>{line.lastRechargeAt ? t.lastRecharge : t.activatedOn}</small><bdi dir="ltr" className="num">{latinWhen(start).slice(0, 10)}</bdi></span>
          <span><small>{t.endsOn}</small><bdi dir="ltr" className="num">{latinWhen(line.endsAt).slice(0, 10)}</bdi></span>
        </div>
      </section>

      <section className="ld-usage" aria-label={t.usage}>
        <div className="ld-section-head">
          <span className="ld-title"><Gauge size={16} aria-hidden="true" />{t.usage}</span>
          <span className="hint">{t.usageHint}</span>
        </div>
        <div className="ld-meters">
          <Meter icon={Wifi} label={t.internet} total={allowance(line.dataGb, t.gbUnit)} />
          <Meter icon={Phone} label={t.minutes} total={allowance(line.minutes, t.minuteUnit)} />
          <Meter icon={MessageSquare} label={t.messages} total={allowance(line.smsCount, t.messageUnit)} />
        </div>
      </section>

      <div className="ld-groups">
        <Group icon={CalendarRange} title={t.subscriptionSection}>
          <Row icon={Building2} label={t.company}>{line.companyName || '—'}</Row>
          <Row icon={Package} label={t.packageName}>{line.packageName}</Row>
          {line.months ? <Row icon={CalendarClock} label={t.packagePeriod}>{line.months === 1 ? t.monthOne : line.months === 2 ? t.monthTwo : <><span className="num">{line.months}</span> {t.months}</>}</Row> : null}
          <Row icon={Banknote} label={t.subscriptionPrice}><Money value={line.subscriberPrice ?? line.posPrice} /></Row>
          <Row icon={CalendarCheck} label={t.activatedOn}><bdi dir="ltr" className="num">{latinWhen(line.createdAt).slice(0, 10)}</bdi></Row>
          <Row icon={RefreshCw} label={t.lastRecharge}>{line.lastRechargeAt ? <bdi dir="ltr" className="num">{latinWhen(line.lastRechargeAt)}</bdi> : '—'}</Row>
          {!isPos && line.posLoginName ? <Row icon={Store} label={t.pointOfSale} wide><AccountName login={line.posLoginName} /></Row> : null}
        </Group>
        <Group icon={Smartphone} title={t.simSection}>
          <Row icon={Smartphone} label={t.simType}><span className="ld-kind">{line.esim ? t.esim : t.physicalSim}</span></Row>
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
    <div className="ld-meter">
      <span className="ld-ring" aria-hidden="true">
        <svg className="ld-ring-track" viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" /></svg>
        <Icon className="ld-ring-icon" size={18} strokeWidth={1.8} />
      </span>
      <span className="ld-meter-text">
        <span className="ld-meter-label">{label}</span>
        <b className="num">—</b>
        <small>{total === t.unlimited || total === '—' ? total : t.ofAllowance.replace('{total}', total)}</small>
      </span>
    </div>
  );
}

function Group({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="ld-group" aria-label={title}>
      <h3 className="ld-title"><Icon size={16} aria-hidden="true" />{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

/** One fact: a small tinted mark, its name above its value, close together so the eye reads them as one. */
function Row({ icon: Icon, label, wide = false, children }: { icon: LucideIcon; label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'ld-item wide' : 'ld-item'}>
      <span className="ld-item-mark" aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span>
      <span className="ld-item-text"><dt>{label}</dt><dd>{children}</dd></span>
    </div>
  );
}

/** A Latin value (number, serial) with a copy button beside it. */
function CopyValue({ value }: { value: string }) {
  const { t } = usePrefs();
  const [copied, setCopied] = useState(false);
  return (
    <span className="ld-copy">
      <bdi dir="ltr" className="num">{value}</bdi>
      <button
        type="button"
        className="icon-btn"
        aria-label={`${t.copy} ${value}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </span>
  );
}
