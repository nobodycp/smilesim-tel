'use client';

import { ArrowLeftRight, BatteryCharging, CalendarPlus, CreditCard, Hash, PhoneOff, Power, QrCode, Snowflake } from 'lucide-react';
import type { ComponentType } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { LiveSwitch } from '../../../components/live-switch';
import { TableSkeleton } from '../../../components/loading';
import { api } from '../../../lib/api';
import { OP_KEYS, opDescription, opLabel, type OpKey } from '../../../lib/ops';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { useLoad } from '../../../lib/use-load';

const ICONS: Record<OpKey, ComponentType<{ 'aria-hidden'?: boolean | 'true' }>> = {
  activate: Power,
  charge: BatteryCharging,
  extend: CalendarPlus,
  switch: ArrowLeftRight,
  sim: CreditCard,
  esim: QrCode,
  freeze: Snowflake,
  disconnect: PhoneOff,
  rename: Hash,
};

/** The line operations `login` may run. A switch off is a stop that also binds everyone below. */
export function UserOpsTab({
  login,
  canEdit,
  setError,
  setNote,
}: {
  login: string;
  canEdit: boolean;
  setError: (text: string) => void;
  setNote: (text: string) => void;
}) {
  const { t } = usePrefs();
  const ops = useLoad(() => api.userOps(login), [login]);
  const { run, busy } = useAction({ setError, setNote, onDone: ops.reload });
  const denied = new Set(ops.data?.denied ?? []);
  const above = new Map((ops.data?.deniedAbove ?? []).map((item) => [item.op, item.login]));

  function toggle(key: OpKey, allowed: boolean) {
    const next = OP_KEYS.filter((item) => (item === key ? !allowed : denied.has(item)));
    void run(() => api.setUserOps(login, next), { note: t.saved });
  }

  return (
    <section className="pane">
      {!ops.loaded ? (
        <TableSkeleton rows={3} columns={3} />
      ) : !ops.data ? (
        <EmptyState icon="numbers">{t.lineOpsTab}</EmptyState>
      ) : (
        <div className="op-grid">
          {OP_KEYS.map((key) => {
            const Icon = ICONS[key];
            const stoppedBy = above.get(key);
            const allowed = !denied.has(key) && !stoppedBy;
            return (
              <article key={key} className={allowed ? 'op-card' : 'op-card off'} data-op={key}>
                <span className="op-mark" aria-hidden="true"><Icon /></span>
                <div className="op-text">
                  <h3>{opLabel(t, key)}</h3>
                  <p className="hint">{opDescription(t, key)}</p>
                  {stoppedBy ? <span className="badge cancelled">{t.stoppedBy.replace('{login}', stoppedBy)}</span> : null}
                </div>
                <LiveSwitch
                  label={opLabel(t, key)}
                  checked={allowed}
                  disabled={!canEdit || busy || Boolean(stoppedBy)}
                  title={stoppedBy ? t.stoppedBy.replace('{login}', stoppedBy) : undefined}
                  onChange={(next) => toggle(key, next)}
                >
                  <b>{allowed ? t.allowed : t.stopped}</b>
                </LiveSwitch>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
