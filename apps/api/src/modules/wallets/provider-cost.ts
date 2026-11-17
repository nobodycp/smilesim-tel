import type { Prisma } from '../../generated/prisma/client';
import { costsAtProvider, providerBranchCost } from '../pricing';
import type { Sale } from './sale';

// What an operation in the ledger cost the branch at the provider, for the provider-operations report.

// The kinds are also listed in the CHECK `WalletEntry_operation_priced` (migration 20261117210000_provider_ledger_stored);
// provider-priced-entries.db.spec.ts compares the two lists.
export const PROVIDER_OPERATION_KINDS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer'];

const OPERATION_KINDS = new Set(PROVIDER_OPERATION_KINDS);

/**
 * The provider and the cost an entry of `kind` stores, written in the entry's own INSERT (ADR 0025, slice P.1):
 * no statement is added for them. An operation kind always carries both, fixed at the write and never updated
 * afterwards; the CHECK `WalletEntry_operation_priced` refuses an operation entry without them.
 *
 * - The provider is the sale's (`Sale.providerId`): the provider of the package the operation was carried out on.
 * - The cost is the sale's when it names one. Otherwise it is 0 for a kind the provider does not price, and for an
 *   operation recorded without money (`recorded`, `WalletLedger.recordOp`, which has always stored 0). A priced
 *   operation that moves money must name its cost: the caller works it out from the package and the terms it holds.
 * - Any other kind keeps what it stored before: the sale's cost or nothing, and no provider.
 */
export function operationColumns(kind: string, sale: Sale | undefined, recorded: boolean): { providerId: string | null; providerCost: number | null } {
  if (!OPERATION_KINDS.has(kind)) return { providerId: null, providerCost: recorded ? (sale?.providerCost ?? 0) : (sale?.providerCost ?? null) };
  if (!sale?.providerId) throw new Error(`a ${kind} entry is written without its provider (ADR 0025)`);
  if (sale.providerCost !== undefined) return { providerId: sale.providerId, providerCost: sale.providerCost };
  if (!recorded && costsAtProvider(kind)) throw new Error(`a ${kind} entry is written without its provider cost (ADR 0025)`);
  return { providerId: sale.providerId, providerCost: 0 };
}

export type PricedPackage = {
  id: string;
  name: string;
  dataGb: number | null;
  months: number;
  branchCost: number;
  renewalBranchCost: number;
  provider: { code: string; name: string };
  company: { name: string } | null;
};

function packageLabel(item: { name: string; dataGb: number | null; months: number }): string {
  if (item.dataGb == null) return item.name;
  return item.months === 1 ? `${item.dataGb} جيجا` : `${item.dataGb} جيجا · ${item.months} أشهر`;
}

function samePackage(item: PricedPackage, packageName: string, companyName: string): boolean {
  if ((item.company?.name ?? '') !== companyName) return false;
  return item.name === packageName || packageLabel(item) === packageName;
}

function savedTerms(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as { subscription?: { branchCost?: number }; renewal?: { branchCost?: number } };
}

export function pricedOp(
  kind: string,
  packageName: string,
  companyName: string,
  line: { terms: Prisma.JsonValue; package: PricedPackage } | undefined,
  packages: PricedPackage[],
) {
  const named = packages.find((item) => samePackage(item, packageName, companyName));
  const current = line?.package;
  const chosen = named ?? current ?? null;
  const same = chosen != null && current != null && chosen.id === current.id;
  return {
    cost: providerBranchCost(kind, same ? savedTerms(line?.terms) : null, chosen),
    providerCode: chosen?.provider.code ?? '',
    providerName: chosen?.provider.name ?? '',
  };
}
