import type { PathNode } from '../access';

/** What a wallet entry records about a sale (slice R.3: from the kernel's types, to the wallets that store it). */
export type Sale = {
  msisdn: string;
  lineId: string;
  companyName: string;
  packageName: string;
  packagePrice: number;
  /**
   * The provider of the package the operation was carried out on (the package `packageName` names), as the caller
   * read it. Stored on an operation's entry with its cost, fixed at the write (ADR 0025).
   */
  providerId: string;
  /**
   * What this operation adds to what the branch owes the provider, signed agorot. An operation priced at the
   * provider (`costsAtProvider`) that moves money must carry it; any other kind costs 0 when it is left out.
   */
  providerCost?: number;
  /**
   * Set only by the approval that gives the money back after the provider's success (`given_back`, spec DB.5 P.7):
   * the entry then records the operation the provider was paid for, moving 0. `priced_zero` is never passed: the
   * ledger works it out (`operationColumns`).
   */
  providerLoss?: 'given_back';
  /** The eSIM fee that is part of this entry's amount, so the finance row can explain amount − package price. */
  esimPrice?: number;
  /** The period a prepaid row bought. A switch has no end: it reprices the open periods. */
  period?: { days: number; endsAt: Date | null };
  /** What the branch pays the provider for that whole period, without the eSIM fee: a refund reads it back. */
  periodCost?: number;
  /**
   * The seller's path up the tree as the caller read it before its transaction, the one the sale was priced on.
   * Not stored: the ledger confirms it under the wallet lock and builds the entry's ladder on it (DB.9, ADR 0023).
   */
  path?: PathNode[];
  /**
   * Set only by the charge of a given-back operation (spec DB.5 P.9, ADR 0027): the marked row this sale charges
   * (stored as `chargesEntryId`, one charge per operation by the unique index `WalletEntry_charges_entry`) and the
   * package the ladder is built on, since no line was made. The ladder then counts the provider's cost at the branch
   * as 0: the provider was paid once, on the marked row.
   */
  charges?: { entryId: string; packageCode: string };
  /**
   * The package the sale's ladder is built on when the line's terms do not name it yet: set only by an immediate
   * renewal onto another package (`renewOnto`), which debits before it moves the line. Left out, the ladder is built
   * on the package the line's terms name, the package sold by every other sale.
   */
  packageCode?: string;
};

type SoldPackage = { name: string; posPrice: number; company: { name: string } | null; providerId: string };

/** What a wallet entry records about the sale of a line: number, package, its company and provider, and the price paid. */
export function saleOf(
  line: { id: string; msisdn: string; package: SoldPackage },
  pkg?: SoldPackage,
  price?: number,
): Sale {
  const chosen = pkg ?? line.package;
  return {
    msisdn: line.msisdn,
    lineId: line.id,
    companyName: chosen.company?.name ?? '',
    packageName: chosen.name,
    packagePrice: price ?? chosen.posPrice,
    providerId: chosen.providerId,
  };
}
