'use client';

import { ArrowLeftRight, ArrowRightLeft, BatteryCharging, CalendarPlus, CreditCard, Hash, PhoneOff, Power, QrCode, Snowflake } from 'lucide-react';
import type { ComponentType } from 'react';
import { Pane } from '../../../components/desk';
import { EmptyState } from '../../../components/empty-state';
import { LiveSwitch } from '../../../components/live-switch';
import { TableSkeleton } from '../../../components/loading';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { api } from '../../../lib/api';
import { OP_KEYS, opDescription, opLabel, type OpKey } from '../../../lib/ops';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { Badge } from '../../../components/ui/badge';
import { pointerGlowClass, riseInClass } from '../../../components/stat';
import { cn } from '../../../lib/cn';

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
  transfer: ArrowRightLeft,
};

/*
 * The operation cards (Tailwind migration T4.2, ADR 0022), ported from desk/components.css `.op-grid` / `.op-card` /
 * `.op-mark` / `.op-text` and graphite.css in their cascade order:
 * - the grid: as many columns of at least 260px as fit, 1px apart; the cards rise in (`riseInClass`);
 * - a card: a grid of the mark, the text and the switch, 12px apart at the top, at least 96px high with 14px padding,
 *   ink bold at the reading start on `--rd-surface` with a 1px `--rd-line-soft` ring and a 1px `--rd-line` rule under
 *   it, square; `--rd-surface-2` under the pointer and while stopped; the soft `--rd-glow` light under the pointer
 *   (the shell finds the card by `data-slot="op-card"` and sets `--mx` / `--my`), and a 2px lift when motion is allowed;
 * - the mark: 40px, 8px corners, an ink 20px glyph on `--rd-surface-2` (`--rd-muted` on `--rd-surface` while stopped);
 * - the text: a column 4px apart; the name 14px extra bold ink (`--rd-muted` while stopped), the description 12px
 *   `--rd-muted` at 1.4 line height, the stop's badge at the reading start 2px under it.
 */
const OP_CARD = cn(
  'relative isolate grid min-h-24 grid-cols-[auto_1fr_auto] items-start gap-3 rounded-none border-0 border-b border-line p-3.5',
  'text-start font-bold text-ink ring ring-line-soft hover:bg-surface-2',
  pointerGlowClass,
);

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
  const ops = useApiQuery(sharedKeys.accountOps(login), () => api.userOps(login));
  const { run, busy } = useAction({ setError, setNote, onDone: ops.reload });
  const denied = new Set(ops.data?.denied ?? []);
  const above = new Map((ops.data?.deniedAbove ?? []).map((item) => [item.op, item.login]));

  function toggle(key: OpKey, allowed: boolean) {
    const next = OP_KEYS.filter((item) => (item === key ? !allowed : denied.has(item)));
    void run(() => api.setUserOps(login, next), { note: t.saved });
  }

  return (
    <Pane>
      {!ops.loaded ? (
        <TableSkeleton rows={3} columns={3} />
      ) : !ops.data ? (
        <EmptyState icon="numbers">{ops.error || t.lineOpsTab}</EmptyState>
      ) : (
        <div className={cn('grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-px', riseInClass)}>
          {OP_KEYS.map((key) => {
            const Icon = ICONS[key];
            const stoppedBy = above.get(key);
            const allowed = !denied.has(key) && !stoppedBy;
            return (
              <article key={key} className={cn(OP_CARD, allowed ? 'bg-surface' : 'bg-surface-2')} data-slot="op-card" data-testid="op-card" data-op={key}>
                <span
                  className={cn('grid size-10 place-items-center rounded-card [&_svg]:size-5', allowed ? 'bg-surface-2 text-ink' : 'bg-surface text-muted')}
                  aria-hidden="true"
                >
                  <Icon />
                </span>
                <div className="grid min-w-0 gap-1">
                  <h3 className={cn('m-0 text-base font-bold', allowed ? 'text-ink' : 'text-muted')}>{opLabel(t, key)}</h3>
                  <p className="m-0 text-sm leading-1-4 text-muted">{opDescription(t, key)}</p>
                  {stoppedBy ? <Badge variant="danger" dot className="mt-0.5 justify-self-start">{t.stoppedBy.replace('{login}', stoppedBy)}</Badge> : null}
                </div>
                <LiveSwitch
                  className="flex-col gap-0"
                  label={opLabel(t, key)}
                  checked={allowed}
                  disabled={!canEdit || busy || Boolean(stoppedBy)}
                  title={stoppedBy ? t.stoppedBy.replace('{login}', stoppedBy) : undefined}
                  onChange={(next) => toggle(key, next)}
                >
                  <b className="order-2 text-xs font-bold text-muted">{allowed ? t.allowed : t.stopped}</b>
                </LiveSwitch>
              </article>
            );
          })}
        </div>
      )}
    </Pane>
  );
}
