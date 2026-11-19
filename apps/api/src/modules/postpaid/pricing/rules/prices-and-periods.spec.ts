import { visibleAccountIds } from '../../../access/account-visibility';
import { daysOf, openPeriods, periodEnd, renewOnto, renewStay, lastWindow, settleDisconnect, switchOnto, switchOver } from '../../sales/rules/periods';
import { captureTerms, activationProviderCost, providerBranchCost, type PackageTerms } from './prices';
import { chainHolds, type PriceField, type Prices } from '../../catalog/rules/package-prices';
import { withinCeiling } from '../../../wallets/ceiling';

const trial = { branchCost: 25, mainPrice: 30, agentPrice: 35, posPrice: 38, subscriberPrice: 45 };

// Short ways into the rules for the cases below: one paid window, valued the way the services value it.
function disconnectSettlement(input: {
  now: Date;
  endsAt: Date;
  months: number;
  posPrice: number;
  branchCost: number;
}): { amount: number; providerCost: number; refundable: boolean } | null {
  return settleDisconnect(lastWindow(input.now, input.endsAt, daysOf(input.months), input.posPrice, false), () => input.branchCost);
}

/**
 * Value of the days still left on the new package, minus the same days on the current one.
 * A positive difference is a debit. The open window length is the denominator of the current price.
 */
function switchDifference(input: {
  now: Date;
  endsAt: Date;
  windowMonths: number;
  currentPrice: number;
  newPrice: number;
  newMonths: number;
}): { currentValue: number; newValue: number; difference: number } {
  const window = lastWindow(input.now, input.endsAt, daysOf(input.windowMonths), input.currentPrice, false);
  return switchOver(window, input.newPrice, daysOf(input.newMonths));
}

function withPrice(prices: Prices, field: PriceField, price: number): Prices {
  if (field === 'main') return { ...prices, mainPrice: price };
  if (field === 'agent') return { ...prices, agentPrice: price };
  if (field === 'pos') return { ...prices, posPrice: price };
  return { ...prices, subscriberPrice: price };
}

describe('office money and price rules', () => {
  it('counts a started day as a whole day and adds half a shekel', () => {
    const endsAt = new Date('2026-02-14T00:00:00.000Z');
    const started = new Date(endsAt.getTime() - 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
    const settled = disconnectSettlement({ now: started, endsAt, months: 1, posPrice: 3000, branchCost: 3000 });
    // P.6: the provider gives back the unused cost less the fee: 100 + 50 − 3000.
    expect(settled).toEqual({ amount: 2850, providerCost: 100 + 50 - 3000, refundable: true });
    const nextDay = new Date(started.getTime() + 24 * 60 * 60 * 1000);
    expect(disconnectSettlement({ now: nextDay, endsAt, months: 1, posPrice: 3000, branchCost: 3000 })).toEqual({ amount: 2750, providerCost: 200 + 50 - 3000, refundable: true });
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
        { days: 30, left: 30, value: 3500, renewal: true, cost: null },
        { days: 30, left: 29, value: 3190, renewal: false, cost: null },
      ]);
    });

    it('refunds every unused paid day on a disconnect, less the fee; the provider gives back every open period less the used share and the fee', () => {
      const periods = openPeriods(now, [extend, activate]);
      const settled = settleDisconnect(periods ?? [], (renewal) => (renewal ? 2800 : 2500));
      // The extension not yet started comes back whole (2800), the running activation less its used day (83).
      expect(settled).toEqual({ amount: 3500 + 3190 - 50, providerCost: 83 + 50 - (2800 + 2500), refundable: true });
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
      expect(openPeriods(now, [charge, before])).toEqual([{ days: 30, left: 29, value: 2900, renewal: true, cost: null }]);
    });

    it('falls back when a row in the run has no period', () => {
      expect(openPeriods(now, [extend, { ...activate, periodDays: null, periodEndsAt: null }])).toBeNull();
    });

    it('drops closed periods and settles nothing once all are closed', () => {
      expect(openPeriods(new Date(at(45).getTime() + 60 * 60 * 1000), [extend, activate])).toEqual([
        { days: 30, left: 14, value: 1633, renewal: true, cost: null },
      ]);
      expect(openPeriods(at(60), [extend, activate])).toEqual([]);
      expect(settleDisconnect([], () => 2500)).toBeNull();
    });

    it('switches over every day left in every open period', () => {
      const periods = openPeriods(now, [extend, activate]) ?? [];
      expect(switchOver(periods, 4100, 30)).toEqual({ currentValue: 6690, newValue: 8063, difference: 1373 });
      expect(switchOver([], 4100, 30)).toEqual({ currentValue: 0, newValue: 0, difference: 0 });
    });
  });

  // Slice D.1 of the package plan (spec 2026-11-15-package-durations-and-deals).
  describe('periods of any length, each at its own cost', () => {
    const day = 24 * 60 * 60 * 1000;
    const start = new Date('2026-11-05T08:00:00.000Z');
    const at = (days: number) => new Date(start.getTime() + days * day);
    const hourIn = (days: number) => new Date(at(days).getTime() + 60 * 60 * 1000);

    it('ends a period after its days, whatever its length', () => {
      expect(periodEnd(start, 5)).toEqual(at(5));
      expect(periodEnd(start, 15)).toEqual(at(15));
      expect(periodEnd(start, daysOf(3))).toEqual(at(90));
      expect(daysOf(0)).toBe(30);
    });

    it('values a five-day period and a month behind it by their own days', () => {
      const five = { kind: 'activate', packagePrice: 500, periodDays: 5, periodEndsAt: at(5), periodCost: 400 };
      const month = { kind: 'extend', packagePrice: 3000, periodDays: 30, periodEndsAt: at(35), periodCost: 2500 };
      expect(openPeriods(hourIn(1), [month, five])).toEqual([
        { days: 30, left: 30, value: 3000, renewal: true, cost: 2500 },
        { days: 5, left: 3, value: 300, renewal: false, cost: 400 },
      ]);
    });

    it('charges the running period at the cost its own row kept, not at the terms of a later renewal', () => {
      // A month at a branch cost of 2500, renewed early onto three months that cost 6600: the line's terms now
      // name the three-month cost, and the running month is still the one that cost 2500.
      const month = { kind: 'activate', packagePrice: 3000, periodDays: 30, periodEndsAt: at(30), periodCost: 2500 };
      const three = { kind: 'extend', packagePrice: 8000, periodDays: 90, periodEndsAt: at(120), periodCost: 6600 };
      const settled = settleDisconnect(openPeriods(hourIn(9), [three, month]) ?? [], () => 6600);
      expect(settled).toEqual({ amount: 8000 + 2000 - 50, providerCost: Math.round((2500 * 10) / 30) + 50 - (2500 + 6600), refundable: true });
    });

    it('the owner\'s example (ADR 0025 answer 3): a 30 ₪ period worked 10 days, the provider gives back 19.5 ₪', () => {
      const month = { kind: 'activate', packagePrice: 3500, periodDays: 30, periodEndsAt: at(30), periodCost: 3000 };
      const settled = settleDisconnect(openPeriods(hourIn(9), [month]) ?? [], () => 0);
      expect(settled?.providerCost).toBe(-1950);
      // What the books count for the line: the sale's 3000 and the disconnect's −1950.
      expect(3000 + (settled?.providerCost ?? 0)).toBe(1050);
    });

    it('falls back to the terms for a row written before the cost was kept', () => {
      const month = { kind: 'activate', packagePrice: 3000, periodDays: 30, periodEndsAt: at(30) };
      expect(settleDisconnect(openPeriods(hourIn(9), [month]) ?? [], () => 2400)?.providerCost).toBe(800 + 50 - 2400);
    });

    it('reprices the cost of older periods with the newest switch', () => {
      const month = { kind: 'activate', packagePrice: 3000, periodDays: 30, periodEndsAt: at(30), periodCost: 2500 };
      const switched = { kind: 'switch', packagePrice: 9000, periodDays: 90, periodEndsAt: null, periodCost: 6600 };
      expect(openPeriods(hourIn(0), [switched, month])).toEqual([{ days: 30, left: 29, value: 2900, renewal: false, cost: 2200 }]);
    });

    it('gives nothing back, and never takes, when the unused days are worth no more than the fee', () => {
      const five = { kind: 'activate', packagePrice: 500, periodDays: 5, periodEndsAt: at(5), periodCost: 400 };
      // The last day: no whole day is left. The provider gives back nothing and the fee is still owed (P.6): +50.
      expect(settleDisconnect(openPeriods(hourIn(4), [five]) ?? [], () => 0)).toEqual({ amount: 0, providerCost: 400 + 50 - 400, refundable: false });
      // A day worth exactly the fee is not a refund either.
      const cheap = { ...five, packagePrice: 250 };
      expect(settleDisconnect(openPeriods(hourIn(3), [cheap]) ?? [], () => 0)).toMatchObject({ amount: 0, refundable: false });
      // One agora above the fee is.
      const dearer = { ...five, packagePrice: 255 };
      expect(settleDisconnect(openPeriods(hourIn(3), [dearer]) ?? [], () => 0)).toMatchObject({ amount: 1, refundable: true });
      const month = { kind: 'activate', packagePrice: 3000, periodDays: 30, periodEndsAt: at(30) };
      expect(settleDisconnect(openPeriods(hourIn(29), [month]) ?? [], () => 2500)).toMatchObject({ amount: 0, refundable: false });
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

describe('activationProviderCost', () => {
  it('adds the eSIM fee to the branch cost for an eSIM and stays unset for a physical SIM', () => {
    expect(activationProviderCost(2000, true, 400)).toBe(2400);
    expect(activationProviderCost(2000, false, 400)).toBeUndefined();
  });
});
