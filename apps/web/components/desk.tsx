'use client';

import { type ReactNode } from 'react';
import type { Copy } from '../lib/copy';
import { type Outcome } from '../lib/api';
import { useIdentity } from '../lib/identity';
import { useOffice } from '../lib/office-session';
import { usePrefs } from '../lib/prefs';
import { OfficeShell } from './office-shell';
import { PageAlert } from './dialog';

export function Desk({
  title,
  lede,
  action,
  error,
  note,
  children,
}: {
  title: string;
  lede: string;
  action?: ReactNode;
  error: string;
  note: string;
  children: ReactNode;
}) {
  const { me } = useOffice();
  const saved = useIdentity();
  const account = me ? me.nickname || me.loginName : saved.account;
  const hint = me ? (me.nickname ? me.loginName : undefined) : saved.hint || undefined;

  return (
    <OfficeShell account={account} hint={hint} wide>
      <div className="desk">
        <header className="page-head">
          <h1>{title}</h1>
          {action}
          {lede ? <p className="lede">{lede}</p> : null}
        </header>
        <PageAlert error={error} note={note}>
          {children}
        </PageAlert>
      </div>
    </OfficeShell>
  );
}

export function Money({ value }: { value: number }) {
  return (
    <span className={value < 0 ? 'money neg' : 'money'} dir="ltr">
      {value}
    </span>
  );
}

export function layerName(t: Copy, layer: string): string {
  if (layer === 'branch') return t.layerBranch;
  if (layer === 'main_agent') return t.layerMain;
  if (layer === 'agent') return t.layerAgent;
  if (layer === 'pos') return t.layerPos;
  if (layer === 'staff') return t.staffAccount;
  return layer;
}

export function actionName(t: Copy, action: string): string {
  if (action === 'activate') return t.actActivate;
  if (action === 'charge') return t.actCharge;
  if (action === 'extend') return t.extend;
  if (action === 'reactivate') return t.actActivate;
  if (action === 'rename') return t.updateNumber;
  if (action === 'sim') return t.swapSim;
  if (action === 'disconnect') return t.actDisconnect;
  if (action === 'freeze') return t.actFreeze;
  if (action === 'unfreeze') return t.unfreeze;
  if (action === 'switch') return t.actSwitch;
  if (action === 'enter') return t.enterAccount;
  if (action === 'fund') return t.fund;
  if (action === 'self_fund') return t.selfFund;
  return action;
}

export function lineStatus(t: Copy, status: string): string {
  if (status === 'active') return t.lineActive;
  if (status === 'frozen') return t.lineFrozen;
  if (status === 'disconnected') return t.lineDisconnected;
  return status;
}

export function taskStatus(t: Copy, status: string): string {
  if (status === 'pending') return t.pending;
  if (status === 'working') return t.working;
  if (status === 'done') return t.done;
  if (status === 'cancelled') return t.cancelled;
  return status;
}

export function OutcomePick({
  value,
  onChange,
}: {
  value: Outcome;
  onChange: (value: Outcome) => void;
}) {
  const { t } = usePrefs();
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="hint">{t.outcome}</span>
      <div className="seg" role="group" aria-label={t.outcome}>
        <button type="button" aria-pressed={value === 'success'} onClick={() => onChange('success')}>
          {t.success}
        </button>
        <button type="button" aria-pressed={value === 'fail'} onClick={() => onChange('fail')}>
          {t.failure}
        </button>
      </div>
    </div>
  );
}

export function whole(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
