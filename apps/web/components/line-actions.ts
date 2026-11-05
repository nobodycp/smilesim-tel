import type { Copy } from '../lib/copy';
import { api, type ApplyResult, type LineRow, type Outcome } from '../lib/api';
import type { Fetched } from '../lib/use-load';
import type { RowAction } from './row-menu';

// Runs one write on a number and refreshes the page; the page owns busy, errors, and the note.
export type RunLine = (work: () => Promise<Fetched<ApplyResult>>) => unknown;

/**
 * The immediate operations a number allows, as `RowMenu` items. The list shows them in a row menu and the
 * line card shows the same items as `.command-list` rows, so the rules live here once:
 *
 * - active: extend, refresh, disconnect (and freeze, when the page asks for it)
 * - frozen: unfreeze, disconnect
 * - disconnected: activate again
 * - suspended: nothing until its rules are decided
 * - locked for a package switch: nothing; the backend refuses them until the package is switched
 *
 * Operations that need a value (transfer, rename, swap the SIM, switch the package) are forms, not items.
 * The list leaves out freeze on purpose; the line card has it. Disconnect only asks: the page opens
 * `DisconnectConfirm` and runs it from there.
 */
function offered(line: LineRow, key: string, fallback: boolean) {
  return line.operations ? line.operations.includes(key) : fallback;
}

export function lineActions(
  line: LineRow,
  verdict: Outcome,
  run: RunLine,
  t: Copy,
  { freeze = false, onDisconnect }: { freeze?: boolean; onDisconnect: (line: LineRow) => void },
): RowAction[] {
  if (line.opsLocked && !line.operations) return [];
  const items: RowAction[] = [];
  if (offered(line, 'extend', line.status === 'active')) items.push({ label: t.extend, icon: 'extend', onClick: () => run(() => api.extendLine(line.id, verdict)) });
  if (offered(line, 'refresh', line.status === 'active' && !line.opsLocked)) items.push({ label: t.updateNumber, icon: 'refresh', onClick: () => run(() => api.refreshLine(line.id, verdict)) });
  if (offered(line, 'charge', false)) items.push({ label: t.actCharge, icon: 'check', onClick: () => run(() => api.chargeLine(line.id, verdict)) });
  if (!line.operations && line.status === 'disconnected') items.push({ label: t.actCharge, icon: 'check', onClick: () => run(() => api.chargeLine(line.id, verdict)) });
  if (freeze && offered(line, 'freeze', line.status === 'active')) items.push({ label: t.freeze, icon: 'ban', onClick: () => run(() => api.freezeLine(line.id, verdict)) });
  if (offered(line, 'unfreeze', line.status === 'frozen')) items.push({ label: t.unfreeze, icon: 'undo', onClick: () => run(() => api.unfreezeLine(line.id, verdict)) });
  if (offered(line, 'disconnect', line.status === 'active' || line.status === 'frozen')) items.push({ label: t.disconnect, icon: 'ban', danger: true, onClick: () => onDisconnect(line) });
  return items;
}
