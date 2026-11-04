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
 * - active: extend, disconnect (and freeze, when the page asks for it)
 * - frozen: unfreeze, disconnect
 * - disconnected: activate again
 * - locked for a package switch: nothing; the backend refuses them until the package is switched
 *
 * Operations that need a value (transfer, rename, swap the SIM, switch the package) are forms, not items.
 * The list leaves out freeze on purpose; the line card has it.
 */
export function lineActions(line: LineRow, verdict: Outcome, run: RunLine, t: Copy, { freeze = false }: { freeze?: boolean } = {}): RowAction[] {
  if (line.opsLocked) return [];
  const items: RowAction[] = [];
  if (line.status === 'active') items.push({ label: t.extend, icon: 'extend', onClick: () => run(() => api.extendLine(line.id, verdict)) });
  if (line.status === 'disconnected') items.push({ label: t.actActivate, icon: 'check', onClick: () => run(() => api.reactivateLine(line.id, verdict)) });
  if (freeze && line.status === 'active') items.push({ label: t.freeze, icon: 'ban', onClick: () => run(() => api.freezeLine(line.id, verdict)) });
  if (line.status === 'frozen') items.push({ label: t.unfreeze, icon: 'undo', onClick: () => run(() => api.unfreezeLine(line.id, verdict)) });
  if (line.status !== 'disconnected') items.push({ label: t.disconnect, icon: 'ban', danger: true, onClick: () => run(() => api.disconnectLine(line.id, verdict)) });
  return items;
}
