import type { Prisma } from '../../../generated/prisma/client';
import { providerBranchCost } from '../rules/office-rules';

// What an operation in the ledger cost the branch at the provider, for the provider-operations report.

export const PROVIDER_OPERATION_KINDS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer'];

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
