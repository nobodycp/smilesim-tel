import { ApiFailure } from '../../shared/api-failure';
import { tree } from '../testing/tree.fixture';

// Backend review 2026-11-10, M1–M8: a number's state is locked and checked again inside the transaction, so a
// refund is paid once, a stale task is refused, and a SIM serial belongs to one live number.
describe('line state under tasks and repeats', () => {
  const refusal = async (run: Promise<unknown>) => run.then(() => null, (error: unknown) => (error instanceof ApiFailure ? { status: error.status, code: error.code } : Promise.reject(error)));

  it('refuses a second open task for the same number and operation', async () => {
    const { service, gates, tasks } = await tree();
    await service.operate(gates.pos1, 'ln1', 'disconnect', { outcome: 'fail' });
    expect(await refusal(service.operate(gates.pos1, 'ln1', 'disconnect', { outcome: 'fail' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(tasks.filter((task) => task.action === 'disconnect')).toHaveLength(1);
  });

  it('does not refund a number twice: a disconnect task left open is refused once the number is disconnected', async () => {
    const { service, gates, tasks, entries, line } = await tree();
    await service.operate(gates.pos1, 'ln1', 'disconnect', { outcome: 'fail' });
    await service.operate(gates.pos1, 'ln1', 'disconnect', { outcome: 'success' });
    expect(line.status).toBe('disconnected');
    // One posting per disconnect: the fixture stores no paid periods, so the posting carries no amount here.
    const credits = () => entries.filter((entry) => entry.kind === 'disconnect').length;
    expect(credits()).toBe(1);
    expect(await refusal(service.completeTask(gates.branch, tasks[0].id, {}))).toEqual({ status: 400, code: 'INVALID' });
    expect(credits()).toBe(1);
    expect(tasks[0].status).toBe('working');
  });

  it('does not bring a disconnected number back through an old freeze task', async () => {
    const { service, gates, tasks, line } = await tree();
    await service.operate(gates.pos1, 'ln1', 'freeze', { outcome: 'fail' });
    await service.operate(gates.pos1, 'ln1', 'disconnect', { outcome: 'success' });
    expect(await refusal(service.completeTask(gates.branch, tasks[0].id, {}))).toEqual({ status: 400, code: 'INVALID' });
    expect(line.status).toBe('disconnected');
  });

  it('does not charge a restart task on a number that is already active', async () => {
    const { service, gates, tasks, entries, line, wallet } = await tree();
    Object.assign(line, { status: 'disconnected' });
    await service.operate(gates.pos1, 'ln1', 'charge', { outcome: 'fail' });
    await service.operate(gates.pos1, 'ln1', 'charge', { outcome: 'success' });
    const balance = wallet.balance;
    expect(await refusal(service.completeTask(gates.branch, tasks[0].id, {}))).toEqual({ status: 400, code: 'INVALID' });
    expect(wallet.balance).toBe(balance);
    expect(entries.filter((entry) => entry.kind === 'charge' && (entry.amount as number) < 0)).toHaveLength(1);
  });

  it('refuses a SIM serial that a live number already holds, and takes it once that number is disconnected', async () => {
    const { service, gates, line } = await tree();
    const body = { packageCode: 'alloha-150', posLoginName: 'pos1', iccid: line.iccid, outcome: 'success' };
    expect(await refusal(service.activate(gates.pos1, body))).toEqual({ status: 409, code: 'SIM_TAKEN' });
    Object.assign(line, { status: 'disconnected' });
    await expect(service.activate(gates.pos1, body)).resolves.toMatchObject({ applied: true });
  });

  it('records on an activation task the price it was opened at, whatever the price is at completion', async () => {
    const { service, gates, tasks, entries, pkgA } = await tree();
    await service.activate(gates.pos1, { packageCode: 'alloha-150', posLoginName: 'pos1', iccid: '8997202000000000777', outcome: 'fail' });
    expect(tasks[0]).toMatchObject({ posDelta: -3500, unitPrice: 3500, held: 3500 });
    Object.assign(pkgA, { posPrice: 6000 });
    await service.completeTask(gates.branch, tasks[0].id, {});
    expect(entries.find((entry) => entry.kind === 'activate')).toMatchObject({ amount: -3500, packagePrice: 3500 });
  });
});
