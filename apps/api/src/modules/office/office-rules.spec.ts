import {
  ACTION_KEYS,
  type ActionKey,
  type ActionMode,
  captureTerms,
  chargeDebit,
  disconnectSettlement,
  ESIM_PRICE_DEFAULT,
  activationProviderCost,
  esimPriceOf,
  chainHolds,
  defaultActionModes,
  flagsForMode,
  normalizeActionModes,
  activateInputs,
  offeredOperations,
  openPeriods,
  packageFlagsFromModes,
  resolvePackageMode,
  repriceRenewal,
  renewOnto,
  renewStay,
  providerBranchCost,
  readSimRules,
  settleDisconnect,
  issueSerial,
  simRefusal,
  simRulesOf,
  subscriptionDebit,
  switchDifference,
  switchOnto,
  switchOver,
  visibleAccountIds,
  withinCeiling,
  withPrice,
  type PackageTerms,
} from './office-rules';

const trial = { branchCost: 25, mainPrice: 30, agentPrice: 35, posPrice: 38, subscriberPrice: 45 };

describe('office money and price rules', () => {
  it('counts a started day as a whole day and adds half a shekel', () => {
    const endsAt = new Date('2026-02-14T00:00:00.000Z');
    const started = new Date(endsAt.getTime() - 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
    const settled = disconnectSettlement({ now: started, endsAt, months: 1, posPrice: 3000, branchCost: 3000 });
    expect(settled).toEqual({ amount: 2850, providerCost: 150 });
    const nextDay = new Date(started.getTime() + 24 * 60 * 60 * 1000);
    expect(disconnectSettlement({ now: nextDay, endsAt, months: 1, posPrice: 3000, branchCost: 3000 })).toEqual({ amount: 2750, providerCost: 250 });
    expect(disconnectSettlement({ now: endsAt, endsAt, months: 1, posPrice: 3000, branchCost: 3000 })).toBeNull();
  });

  describe('stacked paid periods', () => {
    const day = 24 * 60 * 60 * 1000;
    const activatedAt = new Date('2026-11-05T08:00:00.000Z');
    const at = (days: number) => new Date(activatedAt.getTime() + days * day);
    const now = new Date(activatedAt.getTime() + 60 * 60 * 1000);
    const activate = { kind: 'activate', packagePrice: 3300, periodDays: 30, periodEndsAt: at(30) };
    const extend = { kind: 'extend', packagePrice: 3500, periodDays: 30, periodEndsAt: at(60) };

    it('keeps every day of a period that has not started and counts a started day as used', () => {
      expect(openPeriods(now, [extend, activate])).toEqual([
        { days: 30, left: 30, value: 3500, renewal: true },
        { days: 30, left: 29, value: 3190, renewal: false },
      ]);
    });

    it('refunds every unused paid day on a disconnect, less the fee, and charges only the running period', () => {
      const periods = openPeriods(now, [extend, activate]);
      const settled = settleDisconnect(periods ?? [], (renewal) => (renewal ? 2800 : 2500));
      expect(settled).toEqual({ amount: 3500 + 3190 - 50, providerCost: 83 + 50 });
    });

    it('values the open periods at the newest switch price, and a later period at its own', () => {
      const switched = { kind: 'switch', packagePrice: 4500, periodDays: 30, periodEndsAt: null };
      const later = { kind: 'extend', packagePrice: 3000, periodDays: 30, periodEndsAt: at(90) };
      const older = { kind: 'switch', packagePrice: 9000, periodDays: 30, periodEndsAt: null };
      expect(openPeriods(now, [later, switched, extend, older, activate])?.map((period) => period.value)).toEqual([3000, 4500, 4350]);
    });

    it('stops at the activation, charge, or reactivation that started the current run', () => {
      const charge = { kind: 'charge', packagePrice: 3000, periodDays: 30, periodEndsAt: at(30) };
      const before = { kind: 'extend', packagePrice: 3500, periodDays: 30, periodEndsAt: at(20) };
      expect(openPeriods(now, [charge, before])).toEqual([{ days: 30, left: 29, value: 2900, renewal: true }]);
    });

    it('falls back when a row in the run has no period', () => {
      expect(openPeriods(now, [extend, { ...activate, periodDays: null, periodEndsAt: null }])).toBeNull();
    });

    it('drops closed periods and settles nothing once all are closed', () => {
      expect(openPeriods(new Date(at(45).getTime() + 60 * 60 * 1000), [extend, activate])).toEqual([
        { days: 30, left: 14, value: 1633, renewal: true },
      ]);
      expect(openPeriods(at(60), [extend, activate])).toEqual([]);
      expect(settleDisconnect([], () => 2500)).toBeNull();
    });

    it('switches over every day left in every open period', () => {
      const periods = openPeriods(now, [extend, activate]) ?? [];
      expect(switchOver(periods, 4100, 1)).toEqual({ currentValue: 6690, newValue: 8063, difference: 1373 });
      expect(switchOver([], 4100, 1)).toEqual({ currentValue: 0, newValue: 0, difference: 0 });
    });
  });

  it('charges the branch the renewal cost of a top-up and nothing for a rename', () => {
    const terms = { subscription: { branchCost: 10 }, renewal: { branchCost: 18 } };
    const pkg = { branchCost: 12, renewalBranchCost: 20 };
    expect(providerBranchCost('charge', terms, pkg)).toBe(18);
    expect(providerBranchCost('activate', terms, pkg)).toBe(10);
    expect(providerBranchCost('rename', terms, pkg)).toBe(0);
    expect(providerBranchCost('charge', null, pkg)).toBe(20);
    expect(providerBranchCost('switch', null, pkg)).toBe(12);
    expect(providerBranchCost('activate', null, null)).toBe(0);
  });

  it('lets the branch wallet go negative without a ceiling', () => {
    expect(withinCeiling('branch', 0, 0, 30)).toBe(true);
  });

  it('stops a point of sale at its ceiling', () => {
    expect(withinCeiling('pos', 10, 0, 38)).toBe(false);
    expect(withinCeiling('pos', 10, 30, 38)).toBe(true);
    expect(withinCeiling('pos', 10, 30, 41)).toBe(false);
  });

  it('keeps each sell price at or above the buy price', () => {
    expect(chainHolds(trial)).toBe(true);
    expect(chainHolds(withPrice(trial, 'main', 24))).toBe(false);
    expect(chainHolds(withPrice(trial, 'agent', 30))).toBe(true);
    expect(chainHolds(withPrice(trial, 'agent', 29))).toBe(false);
    expect(chainHolds(withPrice(trial, 'pos', 40))).toBe(true);
    expect(chainHolds(withPrice(trial, 'pos', 34))).toBe(false);
    expect(chainHolds(withPrice(trial, 'subscriber', 38))).toBe(true);
  });

  it('shows a main agent its own accounts and the accounts under it', () => {
    const nodes = [
      { id: 'b', parentId: null, layer: 'branch' },
      { id: 'm', parentId: 'b', layer: 'main_agent' },
      { id: 'a', parentId: 'm', layer: 'agent' },
      { id: 'p', parentId: 'a', layer: 'pos' },
    ];
    expect([...visibleAccountIds('m', 'main_agent', nodes)].sort()).toEqual(['a', 'm', 'p']);
    expect(visibleAccountIds('b', 'branch', nodes).size).toBe(4);
    expect([...visibleAccountIds('p', 'pos', nodes)]).toEqual(['p']);
  });
});

const sub30 = { branchCost: 30, mainPrice: 30, agentPrice: 30, posPrice: 30, subscriberPrice: 30 };
const renew30 = { ...sub30 };
const sub25 = { ...sub30, branchCost: 25, mainPrice: 25, agentPrice: 25, posPrice: 25, subscriberPrice: 25 };
const renew80 = { branchCost: 80, mainPrice: 80, agentPrice: 80, posPrice: 80, subscriberPrice: 80 };
const sub70 = { ...renew80, branchCost: 70, mainPrice: 70, agentPrice: 70, posPrice: 70, subscriberPrice: 70 };

const month: PackageTerms = {
  code: 'lian-wecom-500',
  companyCode: 'wecom',
  providerCode: 'lian',
  months: 1,
  forSale: true,
  subscription: sub25,
  renewal: renew30,
};
const three: PackageTerms = {
  code: 'lian-wecom-500-3m',
  companyCode: 'wecom',
  providerCode: 'lian',
  months: 3,
  forSale: true,
  subscription: sub70,
  renewal: renew80,
};
const fiveG: PackageTerms = {
  code: 'lian-wecom-500-5g',
  companyCode: 'wecom',
  providerCode: 'lian',
  months: 1,
  forSale: true,
  subscription: { ...sub30, posPrice: 39, branchCost: 39, mainPrice: 39, agentPrice: 39, subscriberPrice: 39 },
  renewal: { ...sub30, posPrice: 39, branchCost: 39, mainPrice: 39, agentPrice: 39, subscriberPrice: 39 },
};

describe('subscription and renewal price rules', () => {
  it('charges a new number the subscription price and an existing line the saved renewal', () => {
    const line = captureTerms(month, [three]);
    expect(subscriptionDebit(month)).toBe(25);
    expect(chargeDebit(line)).toBe(30);
    expect(line.subscription.posPrice).toBe(25);
    expect(line.renewal.posPrice).toBe(30);
  });

  it('renews in place at the saved renewal price', () => {
    const line = captureTerms(month, [three]);
    const stayed = renewStay(line, new Date('2026-01-15T00:00:00Z'));
    expect(stayed.debit).toBe(30);
    expect(stayed.terms.packageCode).toBe('lian-wecom-500');
    expect(stayed.endsAt.toISOString()).toBe('2026-02-14T00:00:00.000Z');
  });

  it('moves onto an allowed package at that package renewal price, never its offer', () => {
    const line = captureTerms(month, [three]);
    const moved = renewOnto(line, three, new Date('2026-01-15T00:00:00Z'));
    expect('debit' in moved && moved.debit).toBe(80);
    expect('terms' in moved && moved.terms.packageCode).toBe('lian-wecom-500-3m');
    expect('terms' in moved && moved.terms.subscription.posPrice).toBe(80);
  });

  it('keeps the saved renewal when the catalog later changes', () => {
    const line = captureTerms(month, [three]);
    const catalogThree: PackageTerms = {
      ...three,
      months: 6,
      renewal: { ...three.renewal, posPrice: 90, branchCost: 90, mainPrice: 90, agentPrice: 90, subscriberPrice: 90 },
    };
    const moved = renewOnto(line, catalogThree, new Date('2026-01-15T00:00:00Z'));
    expect('debit' in moved && moved.debit).toBe(80);
    expect('endsAt' in moved && moved.endsAt.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  it('reprices a saved renewal without touching the catalog', () => {
    const line = captureTerms(month, [three]);
    const repriced = repriceRenewal(line, { kind: 'target', code: three.code }, 70);
    expect('renewalTargets' in repriced && repriced).toBeTruthy();
    if (!('renewalTargets' in repriced)) return;
    const moved = renewOnto(repriced, three, new Date('2026-01-15T00:00:00Z'));
    expect('debit' in moved && moved.debit).toBe(70);

    const stayRepriced = repriceRenewal(line, { kind: 'stay' }, 40);
    expect('renewal' in stayRepriced && chargeDebit(stayRepriced)).toBe(40);

    expect(repriceRenewal(line, { kind: 'target', code: 'missing' }, 1)).toEqual({ error: 'NO_TARGET' });
  });

  it('refuses a renewal target that was not saved on the line', () => {
    const line = captureTerms(fiveG, []);
    expect(renewOnto(line, three, new Date('2026-01-15T00:00:00Z'))).toEqual({ error: 'NOT_A_RENEWAL_TARGET' });
  });

  it('switches only inside the same shelf and keeps the open window', () => {
    const line = captureTerms(month, []);
    const ok = switchOnto(line, month, three, ['lian-wecom-500-3m']);
    expect('terms' in ok && ok.terms.months).toBe(3);
    expect('terms' in ok && ok.terms.windowMonths).toBe(1);
    expect('terms' in ok && ok.terms.renewal.posPrice).toBe(80);
    const again = switchOnto(
      { ...line, packageCode: three.code, months: 3, windowMonths: 1 },
      three,
      month,
      ['lian-wecom-500'],
    );
    expect('terms' in again && again.terms.windowMonths).toBe(1);
    expect('terms' in again && again.terms.months).toBe(1);
    expect(switchOnto(line, month, three, [])).toEqual({ error: 'NOT_ALLOWED' });
    expect(switchOnto(line, month, month, ['lian-wecom-500'])).toEqual({ error: 'SAME_PACKAGE' });
    const other = { ...three, providerCode: 'aren', code: 'aren-wecom-500' };
    expect(switchOnto(line, month, other, ['aren-wecom-500'])).toEqual({ error: 'OTHER_SHELF' });
  });

  it('charges the remaining-day difference and credits a cheaper package', () => {
    const endsAt = new Date('2026-03-17T00:00:00.000Z');
    const now = new Date('2026-03-12T00:00:00.000Z');
    const up = switchDifference({ now, endsAt, windowMonths: 1, currentPrice: 3000, newPrice: 4100, newMonths: 1 });
    expect(up).toEqual({ currentValue: 500, newValue: 683, difference: 183 });
    const down = switchDifference({ now, endsAt, windowMonths: 1, currentPrice: 3000, newPrice: 2000, newMonths: 1 });
    expect(down.difference).toBe(-167);
    const longer = switchDifference({ now, endsAt, windowMonths: 1, currentPrice: 3000, newPrice: 8000, newMonths: 3 });
    expect(longer).toEqual({ currentValue: 500, newValue: 444, difference: -56 });
    expect(switchDifference({ now: endsAt, endsAt, windowMonths: 1, currentPrice: 3000, newPrice: 4100, newMonths: 1 }).difference).toBe(0);
  });

  it('prices the branch side of a switch with the same remaining-day split', () => {
    const endsAt = new Date('2026-12-05T00:00:00.000Z');
    const now = new Date('2026-11-05T05:00:00.000Z');
    const up = switchDifference({ now, endsAt, windowMonths: 1, currentPrice: 3500, newPrice: 4100, newMonths: 1 });
    expect(up.difference).toBe(580);
    const down = switchDifference({ now, endsAt, windowMonths: 1, currentPrice: 4100, newPrice: 3500, newMonths: 1 });
    expect(down.difference).toBe(-580);
  });
});

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

describe('activationProviderCost', () => {
  it('adds the eSIM fee to the branch cost for an eSIM and stays unset for a physical SIM', () => {
    expect(activationProviderCost(2000, true, 400)).toBe(2400);
    expect(activationProviderCost(2000, false, 400)).toBeUndefined();
  });
});

describe('issueSerial', () => {
  it('starts with the company prefix, fills to its length with digits, and passes the same rules', () => {
    const rules = { length: 19, prefix: '8997202', esim: true };
    const serial = issueSerial(rules, () => 0.37);
    expect(serial).toBe('8997202333333333333');
    expect(simRefusal(rules, serial)).toBeNull();
  });

  it('uses 19 digits when the company sets no length', () => {
    const serial = issueSerial({ length: null, prefix: '', esim: true });
    expect(serial).toMatch(/^\d{19}$/);
  });
});
