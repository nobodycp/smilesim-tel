import {
  ACTION_KEYS,
  captureTerms,
  chargeDebit,
  chainHolds,
  defaultActionModes,
  flagsForMode,
  normalizeActionModes,
  packageFlagsFromModes,
  repriceRenewal,
  renewOnto,
  renewStay,
  subscriptionDebit,
  switchOnto,
  visibleAccountIds,
  withinCeiling,
  withPrice,
  type PackageTerms,
} from './office-rules';

const trial = { branchCost: 25, mainPrice: 30, agentPrice: 35, posPrice: 38, subscriberPrice: 45 };

describe('office money and price rules', () => {
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
    expect(stayed.endsAt.toISOString()).toBe('2026-02-15T00:00:00.000Z');
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

  it('switches only inside the same shelf and charges the full renewal price', () => {
    const line = captureTerms(month, []);
    const from = new Date('2026-01-15T00:00:00Z');
    const ok = switchOnto(line, month, three, ['lian-wecom-500-3m'], from);
    expect('debit' in ok && ok.debit).toBe(80);
    expect(switchOnto(line, month, three, [], from)).toEqual({ error: 'NOT_ALLOWED' });
    expect(switchOnto(line, month, month, ['lian-wecom-500'], from)).toEqual({ error: 'SAME_PACKAGE' });
    const other = { ...three, providerCode: 'aren', code: 'aren-wecom-500' };
    expect(switchOnto(line, month, other, ['aren-wecom-500'], from)).toEqual({ error: 'OTHER_SHELF' });
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
