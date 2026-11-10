'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AccountName } from '../../components/account-name';
import { Dialog } from '../../components/dialog';
import type { RowAction } from '../../components/row-menu';
import { TransferDialog } from '../../components/transfer-dialog';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { api, type UserRow } from '../../lib/api';
import { everyAccount } from '../../lib/directory';
import { parseShekel, shekelField } from '../../lib/money';
import { useOffice } from '../../lib/office-session';
import { usePrefs } from '../../lib/prefs';
import { sharedKeys } from '../../lib/query';
import { doorUrl } from '../../lib/doors';
import { reloadAt } from '../../lib/reload-at';
import { useAction } from '../../lib/use-action';
import { useApiQuery } from '../../lib/use-api-query';
import { UserSettingsDialog } from './user-settings';

export type AccountOp = 'fund' | 'deduct' | 'ceiling' | 'password' | 'freeze' | 'enter' | 'delete' | 'settings';
type FundReason = 'deposit' | 'correction' | 'settlement';
type DeductReason = 'return' | 'correction' | 'settlement';

/**
 * What the signed-in account may do to one listed account, and the dialogs that do it: fund, ceiling, password,
 * freeze or restore, enter, move, delete. Shared by the users list (row menu) and the user page (head buttons), so
 * both follow one set of rules. `error` is the page's message, shown inside the open dialog.
 */
export function useAccountActions({
  error,
  setError,
  setNote,
  onDone,
  onDeleted,
}: {
  error: string;
  setError: (text: string) => void;
  setNote: (text: string) => void;
  onDone: () => Promise<void> | void;
  onDeleted?: () => void;
}) {
  const { t, apiText } = usePrefs();
  const { me } = useOffice();
  const router = useRouter();
  const [op, setOp] = useState<{ row: UserRow; kind: AccountOp } | null>(null);
  const [amount, setAmount] = useState('');
  const [fundNote, setFundNote] = useState('');
  const [fundReason, setFundReason] = useState<FundReason>('deposit');
  const [deductReason, setDeductReason] = useState<DeductReason>('return');
  const [ceiling, setCeiling] = useState('');
  const [password, setPassword] = useState('');
  const [moving, setMoving] = useState<UserRow | null>(null);
  const { run: send, busy } = useAction({ setError, setNote, onDone: async () => { await onDone(); } });

  const isBranch = me?.layer === 'branch';
  const opensAccounts = me?.layer === 'branch' || me?.layer === 'main_agent' || me?.layer === 'agent';
  // Moving a point of sale and moving an agent are two grants. A stopped transfer, or a session that entered
  // another account, moves nothing: the server refuses it, so the action is not offered.
  const canMove = Boolean(me && !me.stops.includes('transfer') && !me.impersonating);
  const canMovePos = canMove && Boolean(me?.grants.includes('transferPos'));
  const canMoveAgent = canMove && Boolean(me?.grants.includes('transferAgents'));

  // The whole visible tree, read only while a move is open: its destinations.
  const everyone = useApiQuery(sharedKeys.users, everyAccount, { enabled: moving !== null }).data?.users ?? [];
  // A point of sale moves under another agent, an agent under another main agent: never to the parent it already
  // has, and never to a frozen account.
  const destinations = moving
    ? everyone.filter((row) => row.layer === (moving.layer === 'pos' ? 'agent' : 'main_agent') && row.loginName !== moving.parentLogin && !row.frozen)
    : [];

  function canFund(row: UserRow) {
    if (row.self) return isBranch;
    if (isBranch) return true;
    return row.directChild;
  }

  function choose(row: UserRow, kind: AccountOp) {
    setError('');
    setAmount('');
    setFundNote('');
    setFundReason('deposit');
    setDeductReason('return');
    setPassword('');
    setCeiling(shekelField(row.ceiling));
    setOp({ row, kind });
  }

  /** Each action this account may take on `row`, in the order the menus show them. */
  function actionsFor(row: UserRow): (RowAction & { key: AccountOp | 'move' })[] {
    const items: (RowAction & { key: AccountOp | 'move' })[] = [];
    if (canFund(row)) items.push({ key: 'fund', label: t.fund, icon: 'fund', onClick: () => choose(row, 'fund') });
    // Taking back follows the same rule as funding, but never from oneself.
    if (canFund(row) && !row.self) items.push({ key: 'deduct', label: t.deduct, icon: 'undo', onClick: () => choose(row, 'deduct') });
    if (row.directChild && row.layer !== 'branch') items.push({ key: 'ceiling', label: t.ceiling, icon: 'edit', onClick: () => choose(row, 'ceiling') });
    if ((row.layer === 'pos' && canMovePos) || (row.layer === 'agent' && canMoveAgent)) {
      items.push({ key: 'move', label: t.transfer, icon: 'move', onClick: () => { setError(''); setMoving(row); } });
    }
    if (!row.self && row.layer !== 'branch' && opensAccounts) items.push({ key: 'password', label: t.newPassword, icon: 'key', onClick: () => choose(row, 'password') });
    if (row.canFreeze) {
      items.push({
        key: 'freeze',
        label: row.frozen ? t.restoreAccount : t.freezeAccount,
        icon: row.frozen ? 'undo' : 'ban',
        onClick: () => choose(row, 'freeze'),
      });
    }
    // «إعدادات المستخدم» (email, mobile, two-step, password, sessions) is the branch owner's, for any account.
    if (isBranch && me?.isBranchOwner && !me.impersonating) items.push({ key: 'settings', label: t.userSettings, icon: 'key', onClick: () => choose(row, 'settings') });
    if (row.canEnter) items.push({ key: 'enter', label: t.enterAccount, icon: 'enter', onClick: () => choose(row, 'enter') });
    if (row.canDelete) items.push({ key: 'delete', label: t.deleteAccount, icon: 'trash', danger: true, onClick: () => choose(row, 'delete') });
    return items;
  }

  /**
   * The same actions split in two menus (spec 2026-11-08-overview-and-reports-nav, H), on the users list and on the
   * user page: «المحفظة» holds fund, deduct, ceiling and the statement; ⋯ holds the rest.
   */
  function groupedFor(row: UserRow) {
    const all = actionsFor(row);
    const walletKeys = new Set(['fund', 'deduct', 'ceiling']);
    const wallet: RowAction[] = all.filter((item) => walletKeys.has(item.key));
    if (row.layer !== 'branch' || row.self) {
      wallet.push({ label: t.statement, icon: 'receipt', onClick: () => router.push(`/finance?q=${encodeURIComponent(row.loginName)}`) });
    }
    return { wallet, more: all.filter((item) => !walletKeys.has(item.key)) };
  }

  // Every account operation closes its dialog when it succeeds.
  function run(work: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>, then?: () => void) {
    return send(work, { then: () => { setOp(null); then?.(); } });
  }

  async function fund(row: UserRow) {
    const value = parseShekel(amount);
    if (value === null || value < 1 || (row.self && !fundNote.trim())) {
      setError(apiText(row.self ? 'أضف ملاحظة للتمويل' : 'بيانات غير صالحة'));
      setNote('');
      return;
    }
    await send(() => api.fundWallet(row.loginName, value, fundNote, fundReason), { note: t.funded, then: () => setOp(null) });
  }

  async function deduct(row: UserRow) {
    const value = parseShekel(amount);
    if (value === null || value < 1 || !fundNote.trim()) {
      setError(apiText(!fundNote.trim() ? 'أضف ملاحظة للتمويل' : 'بيانات غير صالحة'));
      setNote('');
      return;
    }
    await send(() => api.deductWallet(row.loginName, value, deductReason, fundNote), { note: t.funded2, then: () => setOp(null) });
  }

  async function saveCeiling(row: UserRow) {
    const value = parseShekel(ceiling);
    if (value === null) {
      setError(apiText('بيانات غير صالحة'));
      setNote('');
      return;
    }
    await send(() => api.setCeiling(row.loginName, value), { note: t.save, then: () => setOp(null) });
  }

  const active = op?.row;
  const dialogs: ReactNode = (
    <>
      {active && op?.kind === 'settings' ? (
        <UserSettingsDialog
          loginName={active.loginName}
          name={active.nickname}
          onClose={() => setOp(null)}
          onSaved={(text) => { setOp(null); setError(''); setNote(text); }}
        />
      ) : null}
      {active && op && op.kind !== 'settings' ? (
        <Dialog
          open
          size={op.kind === 'fund' || op.kind === 'deduct' || op.kind === 'ceiling' || op.kind === 'password' ? 'form' : 'confirm'}
          title={op.kind === 'fund' ? t.fund : op.kind === 'deduct' ? t.deduct : op.kind === 'ceiling' ? t.ceiling : op.kind === 'password' ? t.newPassword : op.kind === 'enter' ? t.enterAccount : op.kind === 'delete' ? t.deleteAccount : active.frozen ? t.restoreAccount : t.freezeAccount}
          lede={op.kind === 'fund' ? t.fundHint : op.kind === 'deduct' ? t.deductHint : op.kind === 'ceiling' ? t.ceilingHint : op.kind === 'password' ? t.passwordHint : op.kind === 'enter' ? t.enterHint : op.kind === 'delete' ? t.deleteHint : active.frozen ? t.restoreHint : t.freezeHint}
          mark={op.kind === 'fund' || op.kind === 'deduct' || op.kind === 'ceiling' ? 'wallet' : op.kind === 'password' ? 'key' : op.kind === 'enter' ? 'enter' : op.kind === 'delete' ? 'trash' : 'freeze'}
          tone={op.kind === 'delete' || (op.kind === 'freeze' && !active.frozen) ? 'danger' : 'neutral'}
          closeLabel={t.closeMenu}
          error={error}
          onClose={() => { if (!busy) setOp(null); }}
          footer={(
            <>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setOp(null)}>{t.cancel}</Button>
              {op.kind === 'fund' ? <Button type="button" disabled={busy} onClick={() => fund(active)}>{t.fund}</Button> : null}
              {op.kind === 'deduct' ? <Button type="button" disabled={busy} onClick={() => deduct(active)}>{t.deduct}</Button> : null}
              {op.kind === 'ceiling' ? <Button type="button" disabled={busy} onClick={() => saveCeiling(active)}>{t.save}</Button> : null}
              {op.kind === 'password' ? <Button type="button" disabled={busy} onClick={() => run(() => api.setUserPassword(active.loginName, password))}>{t.save}</Button> : null}
              {op.kind === 'freeze' ? <Button type="button" disabled={busy} onClick={() => run(() => (active.frozen ? api.restoreUser(active.loginName) : api.freezeUser(active.loginName)))}>{active.frozen ? t.restoreAccount : t.freezeAccount}</Button> : null}
              {op.kind === 'enter' ? (
                <Button type="button" disabled={busy} onClick={() => send(() => api.enterUser(active.loginName), { then: (entered) => reloadAt(doorUrl(entered.door, `/enter#${entered.code}`)), reload: false })}>
                  {t.enterAccount}
                </Button>
              ) : null}
              {op.kind === 'delete' ? <Button type="button" variant="danger" disabled={busy} onClick={() => run(() => api.removeUser(active.loginName), onDeleted)}>{t.deleteAccount}</Button> : null}
            </>
          )}
        >
          <div className="dialog-form">
            <p className="dialog-who"><AccountName login={active.loginName} name={active.nickname} /></p>
            {op.kind === 'fund' || op.kind === 'deduct' ? (
              <>
                <label>
                  {t.reason}
                  {op.kind === 'fund' ? (
                    <Select value={fundReason} onChange={(event) => setFundReason(event.target.value as FundReason)}>
                      <option value="deposit">{t.reasonDeposit}</option>
                      <option value="correction">{t.reasonCorrection}</option>
                      <option value="settlement">{t.reasonSettlement}</option>
                    </Select>
                  ) : (
                    <Select value={deductReason} onChange={(event) => setDeductReason(event.target.value as DeductReason)}>
                      <option value="return">{t.reasonReturn}</option>
                      <option value="correction">{t.reasonCorrection}</option>
                      <option value="settlement">{t.reasonSettlement}</option>
                    </Select>
                  )}
                </label>
                <label>
                  {t.amount}
                  <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
                </label>
                <label>
                  {t.note}
                  <input value={fundNote} onChange={(event) => setFundNote(event.target.value)} />
                </label>
              </>
            ) : null}
            {op.kind === 'ceiling' ? (
              <label>
                {t.ceiling}
                <input inputMode="numeric" value={ceiling} onChange={(event) => setCeiling(event.target.value)} />
              </label>
            ) : null}
            {op.kind === 'password' ? (
              <label>
                {t.newPassword}
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
            ) : null}
          </div>
        </Dialog>
      ) : null}
      <TransferDialog
        open={moving !== null}
        row={moving}
        destinations={destinations}
        onClose={() => setMoving(null)}
        onDone={() => { setMoving(null); void onDone(); }}
      />
    </>
  );

  return { actionsFor, groupedFor, dialogs, busy };
}
