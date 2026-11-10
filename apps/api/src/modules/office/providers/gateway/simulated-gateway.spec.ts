import { OfficeFailure } from '../../../shared/office-failure';
import { tree } from '../../testing/tree.fixture';
import { BRANCH_TASK_NOTE, PROVIDER_FAILED_NOTE } from '../../stored-text';
import { NOT_CONNECTED, type ProviderRequest } from './provider-gateway';
import { SimulatedProviderGateway } from './simulated-gateway';

const request = (hint: unknown): ProviderRequest => ({ action: 'activate', providerCode: 'p', packageCode: 'x', msisdn: null, hint });

/** Runs with the given environment and puts the old one back. */
async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const put = (source: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(source)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  put(values);
  try {
    return await run();
  } finally {
    put(before);
  }
}

describe('SimulatedProviderGateway', () => {
  it('answers the hint in the test environment', async () => {
    const gateway = new SimulatedProviderGateway();
    expect(gateway.simulated).toBe(true);
    expect(await gateway.run(request('success'))).toEqual({ ok: true });
    expect(await gateway.run(request('fail'))).toEqual({ ok: false, reason: 'simulated-failure' });
    expect(() => gateway.accept('maybe')).toThrow(OfficeFailure);
  });

  it.each([
    ['production, simulation not mentioned', { NODE_ENV: 'production', PROVIDER_SIMULATION: undefined }],
    ['production, simulation asked for', { NODE_ENV: 'production', PROVIDER_SIMULATION: '1' }],
    ['any environment with PROVIDER_SIMULATION=0', { PROVIDER_SIMULATION: '0' }],
  ])('never reports success from the hint: %s', async (_name, values) => {
    await withEnv(values, async () => {
      const gateway = new SimulatedProviderGateway();
      expect(gateway.simulated).toBe(false);
      expect(await gateway.run(request('success'))).toEqual({ ok: false, reason: NOT_CONNECTED });
      // The web still sends the field; with the simulation off it is not read, so it is not refused either.
      expect(() => gateway.accept('success')).not.toThrow();
      expect(() => gateway.accept(undefined)).not.toThrow();
    });
  });
});

describe('line operations and the gateway', () => {
  it('in the test environment the hint decides: success applies now, fail opens a provider-failure task', async () => {
    const { service, gates, tasks, line } = await tree();
    await expect(service.operate(gates.pos1, 'ln1', 'freeze', { outcome: 'success' })).resolves.toMatchObject({ applied: true });
    expect(line.status).toBe('frozen');
    await expect(service.operate(gates.pos1, 'ln1', 'unfreeze', { outcome: 'fail' })).resolves.toMatchObject({ applied: false });
    expect(tasks.map((task) => task.note)).toEqual([PROVIDER_FAILED_NOTE]);
  });

  it('in production "success" from the client changes nothing: the operation becomes a plain branch task', async () => {
    await withEnv({ NODE_ENV: 'production', PROVIDER_SIMULATION: '1' }, async () => {
      const { service, gates, tasks, line, entries } = await tree();
      const status = line.status;
      const postings = entries.length;
      const answer = await service.operate(gates.pos1, 'ln1', 'freeze', { outcome: 'success' });
      expect(answer).toMatchObject({ applied: false, taskId: tasks[0].id });
      expect(line.status).toBe(status);
      expect(entries).toHaveLength(postings);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ action: 'freeze', status: 'working', note: BRANCH_TASK_NOTE });
    });
  });

  it('in production the client cannot mark a provider failure either, and the branch still completes the task by hand', async () => {
    await withEnv({ NODE_ENV: 'production', PROVIDER_SIMULATION: undefined }, async () => {
      const { service, gates, tasks, line } = await tree();
      await service.operate(gates.pos1, 'ln1', 'freeze', { outcome: 'fail' });
      expect(tasks[0].note).toBe(BRANCH_TASK_NOTE);
      await service.completeTask(gates.branch, tasks[0].id, {});
      expect(line.status).toBe('frozen');
      // An activation with no outcome at all is accepted and waits for the branch.
      await expect(service.activate(gates.pos1, { packageCode: 'alloha-150', posLoginName: 'pos1', iccid: '8997202000000000777' })).resolves.toMatchObject({ applied: false });
    });
  });
});
