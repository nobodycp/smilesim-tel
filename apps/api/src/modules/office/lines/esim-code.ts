import { fail } from '../../shared/office-failure';
import { logger } from '../../shared/log';
import { isSealed, seal, secretsKey, tryOpen, type Unreadable } from '../../shared/secret-box';

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

// ── Writing (ADR 0019, D17; plan slice S.5b) ─────────────────────────────────────────────────────────────────────
// A code is stored sealed, always. It is sealed by the service, before the transaction that writes it and before
// any money moves, and the repositories refuse to store one that is not sealed.

/**
 * Refuses now when a code could not be sealed: there is no valid `SECRETS_KEY`. For a caller that will only have
 * the code after a step it cannot take back (the provider's answer), so the refusal comes before that step.
 */
export function assertCanSealEsimCode(): void {
  if (secretsKey()) return;
  log.error('an eSIM code cannot be stored: there is no valid SECRETS_KEY to seal it with; the request is refused');
  fail(500, 'ESIM_CODE_UNSEALABLE');
}

/** The sealed value, or null when the cipher failed; its error is not kept. */
function sealedOrNull(code: string): string | null {
  try {
    return seal(code);
  } catch {
    return null;
  }
}

/**
 * The value to store for a code, or `null` for none. Called before the transaction.
 *
 * - A code as it was given or issued is sealed, and the sealed value is opened again and compared: only a value
 *   that reads back as the code is stored.
 * - A value that is already sealed (a task's stored code handed on to its line) is kept as it is, never sealed a
 *   second time, and only when it opens; one that does not open is refused, never passed on.
 * - With no valid key the request is refused: the code is never stored as written.
 *
 * `where` names the record for the log. Neither the code, the key nor the cipher's error is logged or returned.
 */
export function storableEsimCode(code: string | null | undefined, where: string): string | null {
  if (!code) return null;
  if (isSealed(code)) {
    const read = tryOpen(code);
    if ('value' in read) return code;
    report(where, read.unreadable, 'it is not passed on and the request is refused');
    fail(500, 'ESIM_CODE_UNREADABLE');
  }
  assertCanSealEsimCode();
  const sealed = sealedOrNull(code);
  const back = sealed && isSealed(sealed) ? tryOpen(sealed) : null;
  if (!sealed || !back || !('value' in back) || back.value !== code) {
    log.error(`${where}: its eSIM code could not be sealed and read back; nothing is stored and the request is refused`);
    fail(500, 'ESIM_CODE_UNSEALABLE');
  }
  return sealed;
}

/**
 * The last line before the database: a code that is not sealed is never written, whatever path led here. This is
 * a fault in the code that called, not in the request, so it throws and the transaction rolls back.
 */
export function assertStoredSealed(code: string | null | undefined | { set?: string | null }): void {
  // A write may name the value directly or as Prisma's `{ set }`.
  const value = code && typeof code === 'object' ? code.set : code;
  if (value && !isSealed(value)) throw new Error('An eSIM code must be sealed before it is stored');
}
