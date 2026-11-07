// Who may move what, and where.
//
// Plain data only: no database reads or writes. The service loads the actor and the accounts once per
// request, asks here, and performs the writes. See
// docs/superpowers/specs/2026-11-06-transfer-permissions-design.md.

import type { GrantCode } from './office-grants';
import { floorFor, parseOps, type LayerPrices, type OpKey, type PathNode, type PriceKind, type SellRow, type TermRow } from './user-terms';

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

/** What a move would carry, counted before anything is written. */
export type TransferPreview = {
  /** The moved account's own rows and stops. `belowNewFloor` counts its rows with a price the new parent could not honour. */
  own: { customPrices: number; hidden: number; stops: number; belowNewFloor: number };
  /** What sits below a moved agent, and the agent's own sell prices. `null` when nothing sits below it. */
  child: { customPrices: number; hidden: number; stops: number; sellPrices: number } | null;
};

type PackageTerm = TermRow & { packageId: string };
type PackageSell = SellRow & { packageId: string };

/** A row sets a custom price when it sets either of its two. */
const setsPrice = (row: TermRow) => row.price !== null || row.renewalPrice !== null;

function byPackage<T extends { packageId: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.packageId);
    if (group) group.push(row);
    else groups.set(row.packageId, [row]);
  }
  return groups;
}

/**
 * Counts what moving `moved` along `nextPath` would carry or put at risk.
 *
 * Paths run from the account up to the root, so `moved[0]` is the account itself and `nextPath` is the same
 * account under its new parent. `children` are the points of sale below a moved agent, each on the path it
 * would have after the move; only their first node is read.
 *
 * A price is below the new floor when it is under what the new parent pays for the same package, judged
 * apart for the subscription and the renewal price. A row on a package that is not in `packages` cannot be
 * judged and is not counted.
 *
 * `terms` and `sells` are the rows of the moved account, of its children, and of the new chain. The moved
 * account's rows are what is counted; the new parent's own price and the sell price above it set the floor.
 */
export function previewOf(input: {
  moved: PathNode[];
  nextPath: PathNode[];
  children: PathNode[][];
  terms: PackageTerm[];
  sells: PackageSell[];
  packages: ({ id: string } & LayerPrices)[];
}): TransferPreview {
  const { moved, nextPath, children, terms, sells, packages } = input;
  const account = moved[0];
  const termsOf = byPackage(terms);
  const sellsOf = byPackage(sells);
  const columns = new Map(packages.map((pkg) => [pkg.id, pkg]));

  const underFloor = (row: PackageTerm) => {
    const pkg = columns.get(row.packageId);
    if (!pkg) return false;
    const under = (price: number | null, kind: PriceKind) =>
      price !== null && price < floorFor(nextPath, termsOf.get(row.packageId) ?? [], sellsOf.get(row.packageId) ?? [], pkg, kind);
    return under(row.price, 'subscription') || under(row.renewalPrice, 'renewal');
  };

  const ownRows = terms.filter((row) => row.userId === account.id);
  const kids = new Set(children.map((path) => path[0].id));
  const childRows = terms.filter((row) => kids.has(row.userId));
  return {
    own: {
      customPrices: ownRows.filter(setsPrice).length,
      hidden: ownRows.filter((row) => row.hidden).length,
      stops: parseOps(account.deniedOps).length,
      belowNewFloor: ownRows.filter(underFloor).length,
    },
    child:
      children.length === 0
        ? null
        : {
            customPrices: childRows.filter(setsPrice).length,
            hidden: childRows.filter((row) => row.hidden).length,
            stops: children.reduce((sum, path) => sum + parseOps(path[0].deniedOps).length, 0),
            sellPrices: sells.filter((row) => row.ownerId === account.id).length,
          },
  };
}
