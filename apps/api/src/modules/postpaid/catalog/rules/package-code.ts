// A package's public code: what every layer sees in a link, on a number and on a task. Pure: no Nest, no Prisma.

/** How many characters of the package's id end its code. */
const SUFFIX = 5;

/**
 * The code a package is known by: its company, its size, its length when it is more than a month, and a few
 * characters of its own id to keep it unique — `cellcom-400gb-3f9a2`, `wecom-500gb-3m-b81c0`. Nothing in it
 * comes from the provider (rule 3.4): two providers that sell the same company's package differ only by the
 * suffix, and the id it is cut from is random. The provider's own product code stays in
 * `Package.providerProductCode`, which only the branch and the provider gateway read.
 */
export function publicPackageCode(input: { companyCode: string | null; dataGb: number | null; months: number; id: string }): string {
  const size = input.dataGb === null ? 'pkg' : `${input.dataGb}gb`;
  const span = input.months > 1 ? `-${input.months}m` : '';
  return `${input.companyCode ?? 'pkg'}-${size}${span}-${input.id.replace(/-/g, '').slice(0, SUFFIX)}`;
}
