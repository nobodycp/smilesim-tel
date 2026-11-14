import { claimKeys, completionClaim, refusalOf, reserves, settlementClaim } from './reservation.rules';

const free = { serialOnLine: false, serialOnTask: false, numberOnLine: false, numberOnTask: false };

describe('reservation rules', () => {
  it('locks the serial before the number, and nothing for an empty part', () => {
    expect(claimKeys({ iccid: '8997', msisdn: '0501' })).toEqual(['iccid:8997', 'msisdn:0501']);
    expect(claimKeys({ msisdn: '0501', iccid: '8997' })).toEqual(['iccid:8997', 'msisdn:0501']);
    expect(claimKeys({ iccid: '8997' })).toEqual(['iccid:8997']);
    expect(claimKeys({ msisdn: '0501', iccid: null })).toEqual(['msisdn:0501']);
    expect(claimKeys({ iccid: '', msisdn: undefined })).toEqual([]);
    expect(claimKeys({})).toEqual([]);
  });

  it('counts only an open activation task as a reservation', () => {
    expect(reserves({ action: 'activate', status: 'working' })).toBe(true);
    for (const status of ['done', 'cancelled', 'rejected', 'pending']) expect(reserves({ action: 'activate', status })).toBe(false);
    for (const action of ['sim', 'esim', 'rename', 'extend', 'addon']) expect(reserves({ action, status: 'working' })).toBe(false);
  });

  it('refuses a held serial as SIM_TAKEN and a held number as NUMBER_TAKEN, the serial first', () => {
    expect(refusalOf(free)).toBeNull();
    expect(refusalOf({ ...free, serialOnLine: true })).toBe('SIM_TAKEN');
    expect(refusalOf({ ...free, serialOnTask: true })).toBe('SIM_TAKEN');
    expect(refusalOf({ ...free, numberOnLine: true })).toBe('NUMBER_TAKEN');
    expect(refusalOf({ ...free, numberOnTask: true })).toBe('NUMBER_TAKEN');
    expect(refusalOf({ serialOnLine: false, serialOnTask: true, numberOnLine: true, numberOnTask: true })).toBe('SIM_TAKEN');
  });

  it('names what completing a task puts on a line', () => {
    const task = (action: string, over: Partial<{ esim: boolean; iccid: string | null; msisdn: string | null }> = {}) => ({ action, esim: false, iccid: 'CARD', msisdn: '0501', ...over });
    expect(completionClaim(task('activate'), {})).toEqual({ iccid: 'CARD', msisdn: '0501' });
    // An eSIM activation takes the serial handed back, not the one it was opened with.
    expect(completionClaim(task('activate', { esim: true, iccid: null }), { iccid: 'HANDED' })).toEqual({ iccid: 'HANDED', msisdn: '0501' });
    expect(completionClaim(task('activate', { esim: true, iccid: null }), {})).toEqual({ iccid: null, msisdn: '0501' });
    expect(completionClaim(task('sim'), { iccid: 'IGNORED' })).toEqual({ iccid: 'CARD' });
    expect(completionClaim(task('esim', { iccid: null }), { iccid: 'HANDED' })).toEqual({ iccid: 'HANDED' });
    expect(completionClaim(task('rename'), { msisdn: '0502' })).toEqual({ msisdn: '0502' });
    expect(completionClaim(task('rename'), {})).toEqual({ msisdn: null });
    // Operations that put neither on a line lock nothing.
    for (const action of ['extend', 'freeze', 'unfreeze', 'disconnect', 'switch', 'charge', 'reactivate', 'refresh', 'addon']) expect(completionClaim(task(action), { iccid: 'X', msisdn: 'Y' })).toEqual({});
  });
});

describe('what a provider\'s confirmed activation puts on the line (ADR 0019, D11)', () => {
  const task = { iccid: '8997202000000000011', msisdn: '0500000001' };

  it('takes the part the provider chose, and the task\'s own part where the provider gave none', () => {
    expect(settlementClaim(task, { iccid: null, msisdn: null })).toEqual(task);
    expect(settlementClaim(task, { iccid: null, msisdn: '0500000009' })).toEqual({ iccid: task.iccid, msisdn: '0500000009' });
    expect(settlementClaim(task, { iccid: '8997202000000000099', msisdn: null })).toEqual({ iccid: '8997202000000000099', msisdn: task.msisdn });
    // An eSIM the provider generates: the task has no serial until the provider issues one.
    expect(settlementClaim({ iccid: null, msisdn: '0500000001' }, { iccid: '8997202000000000099', msisdn: null })).toEqual({ iccid: '8997202000000000099', msisdn: '0500000001' });
    expect(settlementClaim({ iccid: null, msisdn: null }, { iccid: null, msisdn: null })).toEqual({ iccid: null, msisdn: null });
  });
});

