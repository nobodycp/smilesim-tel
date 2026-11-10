import { queryText } from '../../shared/schemas';
import { z } from 'zod';

// The bodies of a move (backend-engineering.mdc 4.1). No choice has a default: a move that leaves one out, or
// words one in any other way, is refused before any account is read, so the refusal says nothing about what
// exists. The destination login may be absent here: the transfer rules answer for it, after the grant.

/** What happens to a kind of terms that travels with the moved account. */
const choice = z.enum(['keep', 'reset']);

/** What happens to the renewal prices carried by the moved numbers. */
const lineChoice = z.enum(['keep', 'recapture']);

const login = z.string().max(64).optional();

export const TransferAccountBody = z.object({
  parentLoginName: login,
  ownPrices: choice,
  ownStops: choice,
  // Only an agent has anything below it, so these may be left out; one that is stated has to be a word.
  childPrices: choice.optional(),
  childStops: choice.optional(),
  linePrices: lineChoice,
});
export type TransferAccountBody = z.input<typeof TransferAccountBody>;

export const TransferLineBody = z.object({ posLoginName: login, linePrices: lineChoice });
export type TransferLineBody = z.input<typeof TransferLineBody>;

/** GET users/:loginName/transfer-preview — the login of the new parent. The move's own rules judge it. */
export const TransferPreviewQuery = z.object({ parentLoginName: queryText(64) });
export type TransferPreviewQuery = z.input<typeof TransferPreviewQuery>;
