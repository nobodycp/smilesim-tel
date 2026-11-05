import type { SimRules } from './api';
import type { Copy } from './copy/ar';

export const OPEN_SIM: SimRules = { length: null, prefix: '', esim: true };

export function hasSimRules(rules: SimRules): boolean {
  return rules.length !== null || rules.prefix !== '';
}

/** Mirrors the server check; a company with no rules accepts anything here. */
export function simFits(rules: SimRules, iccid: string): boolean {
  if (!hasSimRules(rules)) return true;
  if (!/^\d+$/.test(iccid)) return false;
  if (rules.length !== null && iccid.length !== rules.length) return false;
  return iccid.startsWith(rules.prefix);
}

/** The accepted SIM drawn as the prefix and one dot per free digit. */
export function simShape(rules: SimRules): string {
  if (rules.length === null) return `${rules.prefix}…`;
  return rules.prefix + '•'.repeat(Math.max(rules.length - rules.prefix.length, 0));
}

export function simHint(t: Copy, rules: SimRules): string {
  const parts: string[] = [];
  if (rules.length !== null) parts.push(t.simRuleLength.replace('{n}', String(rules.length)));
  if (rules.prefix) parts.push(t.simRuleStarts.replace('{p}', rules.prefix));
  return parts.join(t.simRuleJoin);
}

/** Starts an empty field with the prefix; leaves anything the user typed alone. */
export function withPrefix(rules: SimRules, value: string): string {
  return value.trim() ? value : rules.prefix;
}
