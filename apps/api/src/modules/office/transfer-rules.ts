// Who may move what, and where.
//
// Plain data only: no database reads or writes. The service loads the actor and the accounts once per
// request, asks here, and performs the writes. See
// docs/superpowers/specs/2026-11-06-transfer-permissions-design.md.

import type { GrantCode } from './office-grants';
import type { OpKey } from './user-terms';

/** What moves: a number between points of sale, a point of sale between agents, an agent between main agents. */
export type TransferKind = 'line' | 'pos' | 'agent';

/** The kind of an account that is moved by changing its parent. A main agent has no parent to change but the branch. */
export function transferKind(layer: string): Exclude<TransferKind, 'line'> | null {
  if (layer === 'pos') return 'pos';
  if (layer === 'agent') return 'agent';
  return null;
}

/** The grant that says an account may move this kind. */
export const TRANSFER_GRANT: Record<TransferKind, GrantCode> = {
  line: 'transferLines',
  pos: 'transferPos',
  agent: 'transferAgents',
};

/** The layer the new parent must be: one step above what moves. */
export const DESTINATION_LAYER: Record<TransferKind, string> = {
  line: 'pos',
  pos: 'agent',
  agent: 'main_agent',
};

/**
 * Whether `actor` may move a thing of `kind` from its current parent to `destination`.
 *
 * The rules run in this order, and the first that fails answers:
 * 1. the actor is impersonating or lacks the grant of this kind: `FORBIDDEN`;
 * 2. `transfer` is stopped on the actor's own path: `FORBIDDEN`;
 * 3. the destination is missing, of the wrong layer, frozen, or the current parent: `INVALID`;
 * 4. the current parent or the destination is outside the actor's subtree: `FORBIDDEN`.
 *
 * `visible` is the actor's subtree, so an agent only reaches its own points of sale and a main agent
 * only its own chain; the branch sees everything and is never held back by rule 4.
 */
export function canTransfer(input: {
  kind: TransferKind;
  actor: { grants: readonly string[]; impersonating: boolean };
  actorStops: ReadonlySet<OpKey>;
  currentParentId: string;
  destination: { id: string; layer: string; frozen: boolean } | null;
  visible: ReadonlySet<string>;
}): null | 'FORBIDDEN' | 'INVALID' {
  const { kind, actor, actorStops, currentParentId, destination, visible } = input;
  if (actor.impersonating || !actor.grants.includes(TRANSFER_GRANT[kind])) return 'FORBIDDEN';
  if (actorStops.has('transfer')) return 'FORBIDDEN';
  if (!destination || destination.layer !== DESTINATION_LAYER[kind] || destination.frozen || destination.id === currentParentId) return 'INVALID';
  if (!visible.has(currentParentId) || !visible.has(destination.id)) return 'FORBIDDEN';
  return null;
}

/** What happens to a kind of terms that travels with the moved account. There is no default: the caller says. */
export function parseChoice(value: unknown): 'keep' | 'reset' | null {
  return value === 'keep' || value === 'reset' ? value : null;
}

/** What happens to the renewal prices carried by the moved numbers. There is no default: the caller says. */
export function parseLineChoice(value: unknown): 'keep' | 'recapture' | null {
  return value === 'keep' || value === 'recapture' ? value : null;
}
