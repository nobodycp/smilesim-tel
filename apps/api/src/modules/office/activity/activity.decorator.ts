import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ActivityAction } from './activity-log';

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
export const Activity = (action: ActivityAction, subjectKind: string, subject: (req: Request) => string = none) =>
  SetMetadata(ACTIVITY_KEY, { action, subjectKind, subject } satisfies ActivityMeta);

export const NO_ACTIVITY_KEY = 'office:no-activity';

/**
 * Says on purpose that a write is not logged, and why (backend-engineering.mdc 4.4): every office write carries
 * `@Activity` or this. For writes that only change what the caller itself sees, where a log row per call is noise.
 */
export const NoActivity = (why: string) => SetMetadata(NO_ACTIVITY_KEY, why);
