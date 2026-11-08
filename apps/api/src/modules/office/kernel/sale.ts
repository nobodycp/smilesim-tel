import type { Sale } from './types';

/** What a wallet entry records about the sale of a line: number, package, company, and the price paid. */
export function saleOf(
  line: { id: string; msisdn: string; package: { name: string; posPrice: number; company: { name: string } | null } },
  pkg?: { name: string; posPrice: number; company: { name: string } | null },
  price?: number,
): Sale {
  const chosen = pkg ?? line.package;
  return {
    msisdn: line.msisdn,
    lineId: line.id,
    companyName: chosen.company?.name ?? '',
    packageName: chosen.name,
    packagePrice: price ?? chosen.posPrice,
  };
}
