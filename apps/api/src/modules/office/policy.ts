import { fail } from '../shared/office-failure';
import type { ErrorCode } from '../../errors';
import type { Actor } from './kernel/types';
import { LAYER_ORDER } from './kernel/values';
import type { GrantCode } from './rules/office-grants';

// Who may do what in the office (backend-engineering.mdc 3.1). Services ask these functions; they do not read
// `actor.grants` or `actor.isBranchOwner` themselves, so `permissions.http.spec.ts` and the code say one thing.

/** A grant code (office-grants.ts). `read` and `accounting` are not enforced everywhere yet (ADR 0006). */
export type Grant = GrantCode;

/** What a permission question needs to know about whoever asks. */
type Who = Pick<Actor, 'layer' | 'isBranchOwner' | 'grants'>;

/** 0 for the branch, 3 for a point of sale; an unknown layer ranks below every known one. */
export function layerRank(layer: string): number {
  const rank = LAYER_ORDER.indexOf(layer);
  return rank < 0 ? LAYER_ORDER.length : rank;
}

/** Whether a viewer on `viewer` may see a value that belongs to `layer`: its own layer and the ones below it. */
export function seesLayer(viewer: string, layer: string): boolean {
  return layerRank(viewer) <= layerRank(layer);
}

export const isBranch = (actor: Who) => actor.layer === 'branch';

/** The branch owner in person or through its own session; never an employee. */
export const isOwner = (actor: Who) => actor.isBranchOwner;

/** Whether the actor's roles give it this grant, on whatever layer it is (the owner holds every grant). */
export function granted(actor: Who, grant: Grant): boolean {
  return actor.isBranchOwner || actor.grants.includes(grant);
}

/** A branch account with the grant: the owner always, an employee by its roles. Lower layers never. */
export function holds(actor: Who, grant: Grant): boolean {
  return actor.layer === 'branch' && granted(actor, grant);
}

/** A branch account that holds any of the grants named. */
export function holdsAny(actor: Who, grants: Grant[]): boolean {
  return grants.some((grant) => holds(actor, grant));
}

/** 403 unless the actor is a branch account holding the grant (the owner always does). */
export function requireGrant(actor: Who, grant: Grant, code: ErrorCode = 'FORBIDDEN'): void {
  if (!holds(actor, grant)) fail(403, code);
}

export function requireAnyGrant(actor: Who, grants: Grant[], code: ErrorCode = 'FORBIDDEN'): void {
  if (!holdsAny(actor, grants)) fail(403, code);
}

/** 403 unless the actor is the branch owner in person. */
export function requireOwner(actor: Actor): void {
  if (!actor.isBranchOwner || actor.impersonating) fail(403, 'FORBIDDEN');
}

/** 403 for an entered session: it works as the account, it does not administer it. */
export function refuseEntered(actor: Actor): void {
  if (actor.impersonating) fail(403, 'FORBIDDEN');
}

/** A branch-only action: anyone else is 403 FORBIDDEN. */
export function assertBranch(actor: Who): void {
  if (!isBranch(actor)) fail(403, 'FORBIDDEN');
}
