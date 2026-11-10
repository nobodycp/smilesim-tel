import { fail } from '../../shared/office-failure';
import { logger } from '../../shared/log';
import { tryOpen, type Unreadable } from '../../shared/secret-box';

const log = logger('EsimCode');

/**
 * What reading a stored eSIM code gives (ADR 0019, D17; plan slice S.5a). `{ code: null }` is a record that truly
 * has no code. `{ unreadable }` is a record that has one, stored sealed, which does not open. The two are never
 * the same answer here; each caller below decides what an unreadable code becomes.
 */
export type EsimCodeRead = { code: string | null } | { unreadable: Unreadable };

/**
 * Reads a stored code: one written before sealing is answered as it is, a sealed one (`v1:`…) is opened. Both
 * forms can sit side by side while the stored codes are being sealed. Reading never writes, never throws, and
 * keeps neither the stored text nor the cipher's error.
 */
export function readEsimCode(stored: string | null | undefined): EsimCodeRead {
  if (!stored) return { code: null };
  const read = tryOpen(stored);
  return 'value' in read ? { code: read.value } : read;
}

/** One line in the log: which record and why, by a code. Never the stored text, the key or the cipher's error. */
function report(where: string, reason: Unreadable, then: string): void {
  log.error(`${where}: its eSIM code is stored sealed and could not be opened (${reason}); ${then}`);
}

/**
 * The code in a row of a list. One unreadable code must not take the whole page down: that row answers `null`
 * and the log says so. A list therefore cannot tell «no code» from «unreadable»; the record's detail can.
 *
 * `where` names the record for the log: `line <id>` or `task <id>`.
 */
export function listedEsimCode(stored: string | null | undefined, where: string): string | null {
  const read = readEsimCode(stored);
  if ('code' in read) return read.code;
  report(where, read.unreadable, 'it is not shown');
  return null;
}

/**
 * The code in the detail of one record. `null` only when the record has no code. A code that cannot be opened
 * is a fault, not «no code»: the request is refused with `ESIM_CODE_UNREADABLE`, whose body carries the catalog
 * message and nothing of the stored text or the key.
 */
export function esimCodeOrFail(stored: string | null | undefined, where: string): string | null {
  const read = readEsimCode(stored);
  if ('code' in read) return read.code;
  report(where, read.unreadable, 'the request is refused');
  fail(500, 'ESIM_CODE_UNREADABLE');
}

/**
 * The code of a line in the detail of an open task whose work is to replace it (a SIM change, a new eSIM). The
 * old code is not what the task hands over, and the task is how a code that no longer opens gets repaired, so
 * an unreadable one must not close the task's screen: it is logged and the task's own code, already read by the
 * caller with `esimCodeOrFail`, is answered in its place. Nothing of the old value is answered.
 */
export function replacedEsimCode(stored: string | null | undefined, where: string, replacement: string | null): string | null {
  const read = readEsimCode(stored);
  if ('code' in read) return read.code ?? replacement;
  report(where, read.unreadable, 'the open task replaces it, so it is not shown');
  return replacement;
}
