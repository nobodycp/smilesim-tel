import { Logger } from '@nestjs/common';

/** What went wrong, as one line for the log: the error's message, never the object. */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A named logger for code that is not a Nest provider (a store's connection, the worker). */
export function logger(name: string): Logger {
  return new Logger(name);
}
