import { ladderOf, marginOf, refundLadder } from './profit-ladder';
import type { PathNode } from './user-terms';

const node = (id: string, layer: string): PathNode => ({ id, loginName: id, layer, deniedOps: '' });
const path = [node('pos', 'pos'), node('agent', 'agent'), node('main', 'main_agent'), node('branch', 'branch')];
const prices = {
  branchCost: 2500, mainPrice: 3000, agentPrice: 3500, posPrice: 3800, subscriberPrice: 4500,
  renewalBranchCost: 2200, renewalMainPrice: 2700, renewalAgentPrice: 3200, renewalPosPrice: 3500, renewalSubscriberPrice: 4000,
};

describe('profit ladder', () => {
  it('gives every layer the price it sold at minus the price it bought at', () => {
    const ladder = ladderOf(path, [], [], prices, 'subscription', 3800);
    expect(marginOf(ladder, 'branch')).toBe(500);
    expect(marginOf(ladder, 'main')).toBe(500);
    expect(marginOf(ladder, 'agent')).toBe(300);
    expect(marginOf(ladder, 'pos')).toBe(700);
    expect(marginOf(ladder, 'stranger')).toBeNull();
  });

  it('follows a parent sell price, a custom price, and the sell price of the point of sale', () => {
    const sells = [{ ownerId: 'agent', price: 3600, renewalPrice: null }, { ownerId: 'pos', price: 5000, renewalPrice: 4200 }];
    const terms = [{ userId: 'agent', hidden: false, price: 3400, renewalPrice: null }];
    const ladder = ladderOf(path, terms, sells, prices, 'subscription', 3600);
    expect(ladder.costs).toEqual({ pos: 3600, agent: 3400, main: 3000, branch: 2500 });
    expect(marginOf(ladder, 'agent')).toBe(200);
    expect(marginOf(ladder, 'main')).toBe(400);
    expect(marginOf(ladder, 'pos')).toBe(1400);
    expect(ladderOf(path, terms, sells, prices, 'renewal').posSell).toBe(4200);
  });

  it('takes back the refunded share of every margin', () => {
    const sale = ladderOf(path, [], [], prices, 'subscription', 3800);
    const refund = refundLadder(sale, 1900, 3800)!;
    expect(marginOf(refund, 'pos')).toBe(-350);
    expect(marginOf(refund, 'agent')).toBe(-150);
    expect(marginOf(refund, 'branch')).toBe(-250);
    expect(refundLadder(sale, 0, 3800)).toBeNull();
  });
});
