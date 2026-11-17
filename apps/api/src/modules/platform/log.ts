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

/** What may be stored of a server error (a 5xx): its class, a code for its message, and where it was thrown. */
export type ErrorReport = { name: string; message: string; frames: string[] };

/** How many frames of a stack are kept: the top, where the error was thrown. */
export const REPORT_FRAMES = 10;

/** A class name: an identifier, nothing that could carry a value. */
const CLASS_NAME = /^[A-Za-z_$][\w$]{0,79}$/;
/** One V8 frame: `at fn (path:line:col)` or `at path:line:col`, the function an identifier path, the path a file's. */
const FRAME = /^at (?:((?:async |new )?[\w$.<>[\] ]{1,160}) \()?((?:file:\/\/|node:|\/)[^\s()]{1,400}):(\d{1,7}):(\d{1,7})\)?$/;

/**
 * A server error as it may be stored (system monitor M.4): the same rule as the server's log lines, no value of the
 * request. `name` is the error's class when it is an identifier (else `Error`); `message` is `errorCode(error)`,
 * never the error's own words, which may quote a body, a query or a header; `frames` are the top `REPORT_FRAMES`
 * lines of the stack that name a function and a file. The stack's first part is the message and is cut off first,
 * so a message that holds a line shaped like a frame is not taken for one; when the message cannot be found in
 * the stack (it was changed after the error was made), no frame is kept at all. A file path is cut to where the
 * code starts (`dist/`, `src/`, `node_modules/`).
 */
export function errorReport(error: unknown): ErrorReport {
  const message = errorCode(error);
  if (!(error instanceof Error)) return { name: typeof error === 'object' && error !== null ? 'Object' : typeof error, message, frames: [] };
  const own = error.constructor?.name;
  const name = typeof own === 'string' && CLASS_NAME.test(own) && own !== 'Object' ? own : CLASS_NAME.test(error.name) ? error.name : 'Error';
  return { name, message, frames: framesOf(error) };
}

function framesOf(error: Error): string[] {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  const words = typeof error.message === 'string' ? error.message : '';
  // The stack starts with `Name: message` (or the name alone); what follows the message is the frames.
  const at = words === '' ? stack.indexOf('\n') : stack.indexOf(`: ${words}`);
  if (at < 0) return [];
  const rest = stack.slice(words === '' ? at : at + 2 + words.length);
  const frames: string[] = [];
  for (const line of rest.split('\n')) {
    const frame = FRAME.exec(line.trim());
    if (!frame) continue;
    const path = frame[2].replace(/^file:\/\//, '').replace(/^.*?\/(?=(?:dist|src|node_modules)\/)/, '');
    frames.push(frame[1] ? `${frame[1]} (${path}:${frame[3]}:${frame[4]})` : `${path}:${frame[3]}:${frame[4]}`);
    if (frames.length === REPORT_FRAMES) break;
  }
  return frames;
}
