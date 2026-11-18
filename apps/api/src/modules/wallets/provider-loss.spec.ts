import { isOpenLoss, lossWhere, operationColumns } from './provider-cost';
import type { Sale } from './sale';
import { lossMargins, marginBreaks } from './stored-margins';

// The loss mark's rules (spec DB.5 P.7), without a database: which operation `operationColumns` marks, what a marked
// row stores as its margins, and how the invariant of ADR 0026 reads one.
const sale = (over: Partial<Sale> = {}): Sale => ({ msisdn: '0500000001', lineId: 'l1', companyName: 'c', packageName: 'p', packagePrice: 0, providerId: 'prov', ...over });

describe('the loss mark (P.7)', () => {
  it('marks an activation or renewal that moves 0 and costs the branch more than 0', () => {
    for (const kind of ['activate', 'charge', 'extend', 'reactivate']) {
      expect(operationColumns(kind, sale({ providerCost: 2000 }), true, 0)).toEqual({ providerId: 'prov', providerCost: 2000, providerLoss: 'priced_zero' });
      expect(operationColumns(kind, sale({ providerCost: 2000 }), false, 0)).toEqual({ providerId: 'prov', providerCost: 2000, providerLoss: 'priced_zero' });
      expect(operationColumns(kind, sale({ providerCost: 2000 }), false, -3500).providerLoss).toBeNull();
      expect(operationColumns(kind, sale({ providerCost: 0 }), true, 0).providerLoss).toBeNull();
    }
  });

  it('never marks a switch, a disconnect or a kind the provider does not price; a kind that is no operation has no provider', () => {
    expect(operationColumns('switch', sale({ providerCost: 300 }), true, 0).providerLoss).toBeNull();
    expect(operationColumns('disconnect', sale({ providerCost: 50 }), true, 0).providerLoss).toBeNull();
    expect(operationColumns('freeze', sale(), true, 0)).toEqual({ providerId: 'prov', providerCost: 0, providerLoss: null });
    expect(operationColumns('addon', sale(), true, 0)).toEqual({ providerId: null, providerCost: 0, providerLoss: null });
  });

  it('keeps the mark the caller names (given back), and refuses it on a row that moves money', () => {
    expect(operationColumns('activate', sale({ providerCost: 2500, providerLoss: 'given_back' }), true, 0)).toEqual({ providerId: 'prov', providerCost: 2500, providerLoss: 'given_back' });
    expect(() => operationColumns('activate', sale({ providerCost: 2500, providerLoss: 'given_back' }), false, -100)).toThrow(/given_back/);
  });

  it('a marked row stores only the branch\'s loss; the invariant accepts that and nothing else', () => {
    expect(lossMargins(2000)).toEqual({ chainPosId: null, chainAgentId: null, chainMainAgentId: null, posMargin: null, agentMargin: null, mainAgentMargin: null, branchMargin: -2000 });
    const row = { id: 'e1', ladder: null, providerLoss: 'priced_zero', providerCost: 2000, ...lossMargins(2000) };
    expect(marginBreaks([row], () => '')).toEqual([]);
    expect(marginBreaks([{ ...row, branchMargin: -1999 }], () => '')).toEqual([{ id: 'e1', reason: 'marked priced_zero: branchMargin -1999 (expected -2000)' }]);
    expect(marginBreaks([{ ...row, posMargin: 0 }], () => '')).toEqual([{ id: 'e1', reason: 'marked priced_zero: branchMargin -2000 (expected -2000), yet posMargin stored' }]);
    // Without the mark, a row with no ladder still stores none of the seven.
    expect(marginBreaks([{ ...row, providerLoss: null }], () => '')).toEqual([{ id: 'e1', reason: 'no ladder, yet branchMargin stored' }]);
  });

  it('the filter: every open mark (a given-back operation charged later is no longer one, P.9), one reason, or none', () => {
    expect(lossWhere(undefined)).toEqual({});
    expect(lossWhere('any')).toEqual({ providerLoss: { not: null, in: ['given_back', 'priced_zero'] } });
    expect(lossWhere('given_back')).toEqual({ providerLoss: 'given_back' });
    expect(lossWhere('charged_later')).toEqual({ providerLoss: 'charged_later' });
    expect([isOpenLoss('given_back'), isOpenLoss('priced_zero'), isOpenLoss('charged_later'), isOpenLoss(null)]).toEqual([true, true, false, false]);
  });

  it('a row charged later keeps the marked row\'s margin: only branchMargin, minus its cost', () => {
    const row = { id: 'e2', ladder: null, providerLoss: 'charged_later', providerCost: 2000, chainPosId: null, chainAgentId: null, chainMainAgentId: null, posMargin: null, agentMargin: null, mainAgentMargin: null, branchMargin: -2000 };
    expect(marginBreaks([row], () => '')).toEqual([]);
  });
});
