import { uncoveredDebit } from '../rules/prices';
import { keepsHoldForHandler, requotedSettlement, taskCharge } from './task-charge.rules';

describe('how a completed task is charged', () => {
  it('captures a debit that the task holds exactly', () => {
    for (const action of ['activate', 'extend', 'charge', 'reactivate', 'esim', 'addon']) {
      expect([action, taskCharge({ action, posDelta: -3500, held: 3500 })]).toEqual([action, 'capture']);
    }
  });

  it('re-quotes a switch when it is completed and leaves a disconnect to post its own refund, whatever they carry', () => {
    for (const [posDelta, held] of [[0, 0], [-500, 500], [700, 0], [-500, 0]]) {
      expect(taskCharge({ action: 'switch', posDelta, held })).toBe('requote');
      expect(taskCharge({ action: 'disconnect', posDelta, held })).toBe('own');
    }
  });

  it('keeps the hold for the handler only where the handler or the capture settles against it', () => {
    expect(keepsHoldForHandler({ action: 'activate', posDelta: -3500, held: 3500 })).toBe(true);
    expect(keepsHoldForHandler({ action: 'switch', posDelta: -500, held: 500 })).toBe(true);
    expect(keepsHoldForHandler({ action: 'switch', posDelta: 700, held: 0 })).toBe(true);
    for (const task of [{ action: 'disconnect', posDelta: 0, held: 0 }, { action: 'freeze', posDelta: 0, held: 0 }, { action: 'activate', posDelta: -3500, held: 0 }, { action: 'activate', posDelta: 0, held: 300 }]) {
      expect(keepsHoldForHandler(task)).toBe(false);
    }
  });

  it('settles an amount worked out at completion against the hold taken at opening', () => {
    // Owed today: captured against the hold, whatever the two sizes are.
    expect(requotedSettlement(500, -300)).toEqual({ by: 'capture', held: 500, amount: -300 });
    expect(requotedSettlement(500, -500)).toEqual({ by: 'capture', held: 500, amount: -500 });
    expect(requotedSettlement(500, -800)).toEqual({ by: 'capture', held: 500, amount: -800 });
    expect(requotedSettlement(0, -800)).toEqual({ by: 'capture', held: 0, amount: -800 });
    expect(requotedSettlement(null, -800)).toEqual({ by: 'capture', held: 0, amount: -800 });
    // Nothing owed, or money back: the hold is given back whole and no debit is posted.
    expect(requotedSettlement(500, 0)).toEqual({ by: 'release', held: 500, credit: 0 });
    expect(requotedSettlement(500, 250)).toEqual({ by: 'release', held: 500, credit: 250 });
    expect(requotedSettlement(0, 250)).toEqual({ by: 'release', held: 0, credit: 250 });
  });

  it('counts as new money only the part of a debit its hold does not cover', () => {
    expect([uncoveredDebit(500, 300), uncoveredDebit(500, 500), uncoveredDebit(500, 800), uncoveredDebit(0, 800), uncoveredDebit(-5, 800), uncoveredDebit(500, 0)]).toEqual([0, 0, 300, 800, 800, 0]);
  });

  it('moves no money for a task that carries none', () => {
    for (const action of ['freeze', 'unfreeze', 'refresh', 'rename', 'sim', 'activate']) expect(taskCharge({ action, posDelta: 0, held: 0 })).toBe('none');
    // A hold with nothing to charge is only released.
    expect(taskCharge({ action: 'activate', posDelta: 0, held: 300 })).toBe('none');
  });

  it('debits with the ceiling check when no hold of that size stands behind the debit', () => {
    // A task opened before holds existed.
    expect(taskCharge({ action: 'activate', posDelta: -3500, held: 0 })).toBe('debit');
    expect(taskCharge({ action: 'activate', posDelta: -3500, held: null })).toBe('debit');
    // A hold of another size never stands in for the debit, smaller or larger.
    expect(taskCharge({ action: 'activate', posDelta: -3500, held: 3499 })).toBe('debit');
    expect(taskCharge({ action: 'activate', posDelta: -3500, held: 3501 })).toBe('debit');
    // A credit carried by a task is not a capture.
    expect(taskCharge({ action: 'addon', posDelta: 500, held: 0 })).toBe('debit');
    expect(taskCharge({ action: 'addon', posDelta: 500, held: 500 })).toBe('debit');
  });
});
