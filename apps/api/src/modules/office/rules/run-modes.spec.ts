import { ESIM_PRICE_DEFAULT, esimPriceOf } from './prices';
import { ACTION_KEYS, type ActionKey, type ActionMode, defaultActionModes, flagsForMode, normalizeActionModes, activateInputs, offeredOperations, packageFlagsFromModes, resolvePackageMode } from './run-modes';
import { readSimRules, simRefusal, simRulesOf } from './sim-rules';

describe('provider action mode defaults', () => {
  it('fills every catalog action as manual when the map is empty', () => {
    expect(normalizeActionModes({})).toEqual(defaultActionModes());
    expect(normalizeActionModes(null)).toEqual(defaultActionModes());
  });

  it('keeps known modes and fills missing keys as manual', () => {
    expect(normalizeActionModes({ activate: 'auto', switch: 'off', junk: 'auto' })).toEqual({
      ...defaultActionModes(),
      activate: 'auto',
      switch: 'off',
    });
  });

  it('stores a company switch with no run button and resolves a package mode from its own map', () => {
    expect(defaultActionModes().companySwitch).toBe('manual');
    const flags = { autoCharge: true, allowCharge: true, autoFreeze: false, allowFreeze: true };
    expect(resolvePackageMode({ charge: 'off' }, flags, 'charge')).toBe('off');
    expect(resolvePackageMode({}, flags, 'charge')).toBe('auto');
    expect(resolvePackageMode({}, {}, 'rename')).toBe('manual');
    expect(resolvePackageMode({ freeze: 'off' }, {}, 'unfreeze')).toBe('off');
  });

  it('offers an operation only when the line status allows it and the package has not stopped it', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const mode = (action: ActionKey | 'unfreeze'): ActionMode => (action === 'disconnect' ? 'off' : 'manual');
    const active = offeredOperations({ status: 'active', endsAt: new Date('2026-07-01T00:00:00.000Z'), opsLocked: false }, mode, now);
    expect(active).toContain('extend');
    expect(active).not.toContain('charge');
    expect(active).not.toContain('disconnect');
    expect(active).not.toContain('companySwitch');
    const lapsed = offeredOperations({ status: 'active', endsAt: new Date('2026-05-01T00:00:00.000Z'), opsLocked: false }, () => 'auto', now);
    expect(lapsed).not.toContain('extend');
    expect(offeredOperations({ status: 'disconnected', endsAt: now, opsLocked: false }, () => 'manual', now)).toEqual(['charge']);
    expect(offeredOperations({ status: 'frozen', endsAt: now, opsLocked: false }, () => 'manual', now)).toEqual(['unfreeze']);
    expect(offeredOperations({ status: 'suspended', endsAt: now, opsLocked: false }, () => 'manual', now)).toEqual([]);
    expect(offeredOperations({ status: 'active', endsAt: now, opsLocked: true }, () => 'auto', now)).toEqual(['switch']);
  });

  it('prices an eSIM from the package, then the provider, then the company', () => {
    expect(esimPriceOf({ pkg: { esimPrice: 700 }, provider: { esimPrice: 600 }, company: { esimPrice: 400 } })).toEqual({ price: 700, source: 'package' });
    expect(esimPriceOf({ pkg: { esimPrice: null }, provider: { esimPrice: 600 }, company: { esimPrice: 400 } })).toEqual({ price: 600, source: 'provider' });
    expect(esimPriceOf({ pkg: { esimPrice: null }, provider: { esimPrice: null }, company: { esimPrice: 400 } })).toEqual({ price: 400, source: 'company' });
    expect(esimPriceOf({ pkg: null, provider: null, company: null })).toEqual({ price: ESIM_PRICE_DEFAULT, source: 'company' });
    expect(esimPriceOf({ pkg: { esimPrice: 0 }, provider: { esimPrice: 600 }, company: { esimPrice: 400 } })).toEqual({ price: 0, source: 'package' });
  });

  it('offers eSIM only when both the company and the package allow it', () => {
    expect(simRulesOf({ esim: true }, { esimAvailable: false }).esim).toBe(false);
    expect(simRulesOf({ esim: false }, { esimAvailable: true }).esim).toBe(false);
    expect(simRulesOf({ esim: true }, { esimAvailable: true }).esim).toBe(true);
    expect(simRulesOf({ esim: true }).esim).toBe(true);
    expect(simRulesOf(null, { esimAvailable: false }).esim).toBe(false);
  });

  it('checks a SIM against its company rules', () => {
    const open = simRulesOf(null);
    expect(open).toEqual({ length: null, prefix: '', esim: true });
    expect(simRefusal(open, 'any-sim-1')).toBeNull();
    const rules = simRulesOf({ iccidLength: 19, iccidPrefix: '8997202', esim: false });
    expect(rules).toEqual({ length: 19, prefix: '8997202', esim: false });
    expect(simRefusal(rules, '8997202000000000001')).toBeNull();
    expect(simRefusal(rules, '899720200000000000A')).toBe('SIM_DIGITS');
    expect(simRefusal(rules, '89972020000000001')).toBe('SIM_LENGTH');
    expect(simRefusal(rules, '8997201000000000001')).toBe('SIM_PREFIX');
    expect(simRefusal({ length: null, prefix: '8997', esim: true }, '89971')).toBeNull();
    expect(simRefusal({ length: 12, prefix: '', esim: true }, '123456789012')).toBeNull();
  });

  it('reads company SIM settings only when they fit together', () => {
    expect(readSimRules({ length: 19, prefix: '8997202', esim: false })).toEqual({ length: 19, prefix: '8997202', esim: false });
    expect(readSimRules({ length: null, prefix: '', esim: true })).toEqual({ length: null, prefix: '', esim: true });
    expect(readSimRules({ length: null, prefix: ' 8997 ', esim: true })).toEqual({ length: null, prefix: '8997', esim: true });
    expect(readSimRules({ length: 9, prefix: '', esim: true })).toBeNull();
    expect(readSimRules({ length: 23, prefix: '', esim: true })).toBeNull();
    expect(readSimRules({ length: 19.5, prefix: '', esim: true })).toBeNull();
    expect(readSimRules({ length: 12, prefix: '899720200000', esim: true })).toBeNull();
    expect(readSimRules({ length: null, prefix: '89a', esim: true })).toBeNull();
    expect(readSimRules({ length: null, prefix: '12345678901', esim: true })).toBeNull();
    expect(readSimRules({ length: null, prefix: '', esim: 'yes' })).toBeNull();
  });

  it('asks Neod for the current number details and Tokman for the number', () => {
    expect(activateInputs('neod')).toBe('current-details');
    expect(activateInputs('tokman')).toBe('number-and-sim');
    expect(activateInputs('sky')).toBe('generated');
  });

  it('maps modes to package auto/allow flags', () => {
    const modes = normalizeActionModes({ activate: 'auto', charge: 'manual', disconnect: 'off' });
    const flags = packageFlagsFromModes(modes);
    expect(flags.autoActivate).toBe(true);
    expect(flags.allowActivate).toBe(true);
    expect(flags.autoCharge).toBe(false);
    expect(flags.allowCharge).toBe(true);
    expect(flags.autoDisconnect).toBe(false);
    expect(flags.allowDisconnect).toBe(false);
    for (const key of ACTION_KEYS) {
      const pair = flagsForMode(modes[key]);
      if (key === 'activate') {
        expect(flags.autoActivate).toBe(pair.auto);
        expect(flags.allowActivate).toBe(pair.allow);
      }
    }
  });
});
