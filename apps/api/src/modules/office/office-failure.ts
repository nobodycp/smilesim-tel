import { ERROR_MESSAGES, type ErrorCode } from '../../errors';

/** A refusal with an HTTP status and a stable code; the message is the catalog's (`errors.ts`). */
export class OfficeFailure extends Error {
  constructor(readonly status: number, readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
  }
}

export function fail(status: number, code: ErrorCode): never {
  throw new OfficeFailure(status, code);
}
