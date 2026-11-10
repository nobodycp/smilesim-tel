import { Logger } from '@nestjs/common';

/** What went wrong, as one line for the log: the error's message, never the object. */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A named logger for code that is not a Nest provider (a store's connection, the worker). */
export function logger(name: string): Logger {
  return new Logger(name);
}

/**
 * The error codes that may be written down, each named here: a code is logged only when it is one of these exact
 * words. A pattern would also let through a made-up "code" that carries data (a key spelled after an `E`).
 * Adding a code means adding a line here.
 */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  // Sockets and DNS (libuv / Node `net`, `dns`).
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  // Node streams, sockets and TLS.
  'ERR_SOCKET_CLOSED',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_STREAM_DESTROYED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  // undici (Node's fetch).
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_ABORTED',
  'UND_ERR_CLOSED',
  'UND_ERR_DESTROYED',
  // Prisma: connection, time limits, and the write conflicts the API itself handles.
  'P1000',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2002',
  'P2024',
  'P2025',
  'P2028',
  'P2034',
]);

/**
 * A code for an error whose text must not be logged (a provider's or a driver's message may quote a request,
 * a header or a connection string): the error's own `code` when it is one of `KNOWN_ERROR_CODES`, else `timeout`
 * for a `TimeoutError`, else `unclassified`. Never the message, never the stack, never a code that is not listed.
 */
export function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && KNOWN_ERROR_CODES.has(code)) return code;
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return 'unclassified';
}
