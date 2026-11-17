import type { Prisma } from '../../generated/prisma/client';
import type { SearchTerms } from '../platform';

// The finance list's search (spec 2026-11-17-scale-speed-cleanup, "Search (DB.6)"). Pure: the service reads what it
// needs first (the accounts it already holds, whether the catalog has a matching name) and hands it in, so the
// entries are filtered by the number's trigram index and an id list instead of a join to the accounts on `ILIKE`.

export type FinanceSearchInput = {
  /** The accounts whose login contains the text, case aside (from the tree the service read). */
  loginIds: string[];
  /** Whether a package in the catalog has a name containing the text: only then are the entries' package names read. */
  packageNamed: boolean;
  /** The same for a company's name. */
  companyNamed: boolean;
};

/**
 * A number query (`terms.digits`) matches the entry's number, the accounts whose login holds those digits, and the
 * stored package or company name when the catalog has a name holding them (so «100» still finds the sales of
 * «100 جيجا»). It does not read the free note. Any other query matches the number as typed, the note, the stored
 * package and company names and the logins, as before.
 */
export function financeSearch(terms: SearchTerms | null, found: FinanceSearchInput): Prisma.WalletEntryWhereInput {
  if (!terms) return {};
  const insensitive = (text: string) => ({ contains: text, mode: 'insensitive' as const });
  const logins = found.loginIds.length ? [{ userId: { in: found.loginIds } }] : [];
  const names = (field: 'packageName' | 'companyName') => terms.names.map((text) => ({ [field]: insensitive(text) }));
  if (terms.digits) {
    return {
      OR: [
        { msisdn: { contains: terms.digits } },
        ...logins,
        ...(found.packageNamed ? names('packageName') : []),
        ...(found.companyNamed ? names('companyName') : []),
      ],
    };
  }
  return {
    OR: [
      { msisdn: { contains: terms.number } },
      ...terms.names.map((text) => ({ note: insensitive(text) })),
      ...names('packageName'),
      ...names('companyName'),
      ...logins,
    ],
  };
}

/** The accounts whose login contains one of the texts, case aside (what `ILIKE` on the login answered). */
export function loginIdsContaining(accounts: { id: string; loginName: string }[], texts: string[]): string[] {
  const needles = texts.map((text) => text.toLowerCase());
  return accounts.filter((account) => needles.some((needle) => account.loginName.toLowerCase().includes(needle))).map((account) => account.id);
}
