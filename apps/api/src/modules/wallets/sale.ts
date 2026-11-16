/** What a wallet entry records about a sale (slice R.3: from the kernel's types, to the wallets that store it). */
export type Sale = {
  msisdn: string;
  lineId: string;
  companyName: string;
  packageName: string;
  packagePrice: number;
  providerCost?: number;
  /** The eSIM fee that is part of this entry's amount, so the finance row can explain amount − package price. */
  esimPrice?: number;
  /** The period a prepaid row bought. A switch has no end: it reprices the open periods. */
  period?: { days: number; endsAt: Date | null };
  /** What the branch pays the provider for that whole period, without the eSIM fee: a refund reads it back. */
  periodCost?: number;
};

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
