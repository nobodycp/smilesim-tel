import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const ACTIVITY_KEY = 'office:activity';

export type ActivityMeta = {
  action: string;
  subjectKind: string;
  /** The subject reference written into the log, read from the request. */
  subject: (req: Request) => string;
};

/** A route parameter, as the subject of the logged action. */
export const param = (name: string) => (req: Request): string => {
  const value = (req.params as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
};

/** A body field, as the subject of the logged action; anything but a string logs as empty. */
export const bodyField = (name: string) => (req: Request): string => {
  const value = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
};

const none = (): string => '';

/**
 * Logs the route in the activity log: once with `ok` after it answers, or with `fail` and the refusal code
 * when it throws an OfficeFailure. See ActivityInterceptor.
 */
export const Activity = (action: string, subjectKind: string, subject: (req: Request) => string = none) =>
  SetMetadata(ACTIVITY_KEY, { action, subjectKind, subject } satisfies ActivityMeta);
