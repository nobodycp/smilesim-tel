import { logger } from '../../shared/log';
import { tryOpen } from '../../shared/secret-box';

const log = logger('EsimCode');

/**
 * An eSIM's activation code as it is shown (ADR 0019, D17; plan slice S.5a). The stored value is either the code
 * as it was written before sealing, which is answered as it is, or a sealed one (`v1:`…), which is opened. Both
 * forms can sit side by side while the stored codes are being sealed.
 *
 * A sealed code that cannot be opened is not shown: the answer is `null`, as for a line that has no code, and
 * one line in the log says which record and why, by a code. Neither the stored text nor the cipher's error is
 * returned or logged. Reading never writes: the stored value stays exactly as it is.
 *
 * `where` names the record for the log: `line <id>` or `task <id>`.
 */
export function shownEsimCode(stored: string | null | undefined, where: string): string | null {
  if (!stored) return null;
  const read = tryOpen(stored);
  if ('value' in read) return read.value;
  log.error(`${where}: its eSIM code is stored sealed and could not be opened (${read.unreadable}); it is not shown`);
  return null;
}
