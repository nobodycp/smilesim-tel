import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ActivityRecorder, type ActivityDraft } from '../platform';
import { metaOf, sessionIdOf } from './auth-http';
import type { Outcome } from './auth.service';

/**
 * What the routes of `/auth` write to the activity log (slice R.A): one place for the three shapes of a record,
 * so that a handler says what happened and never builds a record. A record holds the action, the account and, for
 * a refusal, its code: never a password, a code or a field's value.
 */
@Injectable()
export class AuthRecords {
  constructor(private readonly activity: ActivityRecorder) {}

  /** A sign-in, done or refused, by the login name it was tried with. `how` says how a done one was made. */
  async signIn(req: Request, loginName: string, result: { kind: 'error'; code: string } | { kind: 'ok' }, how = ''): Promise<void> {
    const failed = result.kind === 'error';
    await this.activity.recordLogin({ loginName, ip: metaOf(req).ip, result: failed ? 'fail' : 'ok', reason: failed ? result.code : how });
  }

  /**
   * An account's action on itself, done or refused. A refusal is recorded under the session the request brought;
   * a done one under the session it left, when the action replaced it (a password change, a second step).
   */
  async own(req: Request, action: ActivityDraft['action'], result: Outcome<{ sessionId?: string }>): Promise<void> {
    const failed = result.kind === 'error';
    const sessionId = failed ? sessionIdOf(req) : (result.sessionId ?? sessionIdOf(req));
    await this.activity.record({ sessionId }, metaOf(req).ip, { action }, failed ? 'fail' : 'ok', failed ? result.code : '');
  }

  /**
   * The same, for the two routes that an anonymous request can reach before any check: only a request that brought
   * a session is recorded. An anonymous one names no account, and recording it would let anyone add rows without
   * signing in.
   */
  async ownIfSignedIn(req: Request, action: ActivityDraft['action'], result: Outcome<unknown>): Promise<void> {
    if (sessionIdOf(req)) await this.own(req, action, result);
  }

  /** An owner-only action on another account or on a layer, done or refused. */
  async owner(req: Request, event: ActivityDraft, result: Outcome<unknown>): Promise<void> {
    const failed = result.kind === 'error';
    await this.activity.record({ sessionId: sessionIdOf(req) }, metaOf(req).ip, event, failed ? 'fail' : 'ok', failed ? result.code : '');
  }
}
