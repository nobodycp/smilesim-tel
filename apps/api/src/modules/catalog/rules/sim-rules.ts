// A company's SIM rules: the serial's length and prefix, and whether it issues eSIMs. Pure: no Nest, no Prisma.

export type SimRules = { length: number | null; prefix: string; esim: boolean };
export type SimRefusal = 'SIM_DIGITS' | 'SIM_LENGTH' | 'SIM_PREFIX';

export const SIM_LENGTH_MIN = 10;
export const SIM_LENGTH_MAX = 22;
const SIM_PREFIX_MAX = 10;

/**
 * The SIM rules of a package's company. eSIM needs both the company and, when given, the package to allow it
 * (`Package.esimAvailable`, spec 2026-11-09-offers-tasks-addons-wallet-esim, 5).
 */
export function simRulesOf(company: { iccidLength?: number | null; iccidPrefix?: string | null; esim?: boolean } | null, pkg?: { esimAvailable?: boolean } | null): SimRules {
  const packageEsim = pkg?.esimAvailable ?? true;
  if (!company) return { length: null, prefix: '', esim: packageEsim };
  return { length: company.iccidLength ?? null, prefix: company.iccidPrefix ?? '', esim: (company.esim ?? true) && packageEsim };
}

/** A company with no length and no prefix checks nothing here; the caller keeps its own minimum. */
export function simRefusal(rules: SimRules, iccid: string): SimRefusal | null {
  if (rules.length === null && !rules.prefix) return null;
  if (!/^\d+$/.test(iccid)) return 'SIM_DIGITS';
  if (rules.length !== null && iccid.length !== rules.length) return 'SIM_LENGTH';
  if (rules.prefix && !iccid.startsWith(rules.prefix)) return 'SIM_PREFIX';
  return null;
}

/** Default serial length for a company that sets none: the usual 19-digit ICCID. */
export const SIM_LENGTH_DEFAULT = 19;

/**
 * A serial the simulated provider issues for a new eSIM: the company prefix followed by random
 * digits up to the company length. Always satisfies `simRefusal` for the same rules.
 */
export function issueSerial(rules: SimRules, random: () => number = Math.random): string {
  const length = rules.length ?? SIM_LENGTH_DEFAULT;
  let serial = rules.prefix;
  while (serial.length < length) serial += Math.floor(random() * 10).toString();
  return serial.slice(0, length);
}

/** SIM settings that fit together: the length in range, a numeric prefix shorter than the length. Null otherwise. */
export function readSimRules(given: { length?: unknown; prefix?: unknown; esim?: unknown }): SimRules | null {
  const length = given.length ?? null;
  if (length !== null && (!Number.isInteger(length) || (length as number) < SIM_LENGTH_MIN || (length as number) > SIM_LENGTH_MAX)) return null;
  if (typeof given.prefix !== 'string' || typeof given.esim !== 'boolean') return null;
  const prefix = given.prefix.trim();
  if (prefix && (!/^\d+$/.test(prefix) || prefix.length > SIM_PREFIX_MAX)) return null;
  if (length !== null && prefix.length >= (length as number)) return null;
  return { length: length as number | null, prefix, esim: given.esim };
}
