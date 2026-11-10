import { Logger } from '@nestjs/common';

/** What went wrong, as one line for the log: the error's message, never the object. */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A named logger for code that is not a Nest provider (a store's connection, the worker). */
export function logger(name: string): Logger {
  return new Logger(name);
}

/** System and driver error codes that are safe to write down: they name a condition and carry no data. */
const KNOWN_ERROR_CODES = /^(E[A-Z0-9_]{2,30}|ERR_[A-Z0-9_]{2,40}|P\d{4}|UND_ERR_[A-Z_]{2,30})$/;

/**
 * A code for an error whose text must not be logged (a provider's or a driver's message may quote a request,
 * a header or a connection string): the error's own `code` when it is a plain system, Node, undici or Prisma
 * code, else `timeout` for a timeout, else `unclassified`. Never the message, never the stack.
 */
export function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && KNOWN_ERROR_CODES.test(code)) return code;
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return 'unclassified';
}
