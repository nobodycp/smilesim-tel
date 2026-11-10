import { taskCharge } from './task-charge.rules';

describe('how a completed task is charged', () => {
  it('captures a debit that the task holds exactly', () => {
    for (const action of ['activate', 'extend', 'charge', 'reactivate', 'esim', 'addon']) {
      expect([action, taskCharge({ action, posDelta: -3500, held: 3500 })]).toEqual([action, 'capture']);
    }
  });

  it('leaves a disconnect and a switch to post their own amount, whatever they hold', () => {
    for (const action of ['disconnect', 'switch']) {
      for (const [posDelta, held] of [[0, 0], [-500, 500], [700, 0], [-500, 0]]) expect(taskCharge({ action, posDelta, held })).toBe('own');
    }
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
