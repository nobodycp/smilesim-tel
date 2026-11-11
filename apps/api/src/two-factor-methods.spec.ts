import { capturedOutput } from './modules/shared/testing/captured-output';
import { findingLines, report, type MethodFindings } from './two-factor-methods';

// Spec 2026-11-12-two-factor-available-methods: the read-only report of stored SMS / email settings.
const found: MethodFindings = {
  layers: [{ layer: 'agent', method: 'sms', required: true }],
  held: [{ id: 'user-held-1', layer: 'agent', method: 'sms', by: 'layer' }, { id: 'user-held-2', layer: 'pos', method: 'email', by: 'account' }],
  enrolled: [{ id: 'user-enrolled-1', layer: 'pos', method: 'email' }],
};

describe('two-step methods report', () => {
  it('names layers, methods and account ids, and what to do about each', () => {
    const lines = findingLines(found);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('layer agent: its method is sms (required)');
    expect(lines[1]).toContain('account user-held-1 (agent): has to enrol and is held to sms by its layer');
    expect(lines[2]).toContain('account user-held-2 (pos): has to enrol and is held to email by its own setting');
    expect(lines[3]).toContain('account user-enrolled-1 (pos): enrolled with email');
  });

  it('exits 0 with nothing found, 1 with findings, and says nothing was changed', async () => {
    let code = -1;
    const none = await capturedOutput(async () => {
      code = await report(async () => ({ layers: [], held: [], enrolled: [] }));
    });
    expect(code).toBe(0);
    expect(none).toContain('no layer and no account names SMS or email');
    const some = await capturedOutput(async () => {
      code = await report(async () => found);
    });
    expect(code).toBe(1);
    expect(some).toContain('1 layer(s), 2 account(s) held to a method, 1 account(s) enrolled with one. Nothing was changed.');
  });

  it('exits 2 by a code when the read fails, without the failure\'s own text', async () => {
    let code = -1;
    const output = await capturedOutput(async () => {
      code = await report(async () => {
        throw new Error('connect ECONNREFUSED postgresql://smilesim:secret-pass@db:5432/smilesim');
      });
    });
    expect(code).toBe(2);
    expect(output).toContain('the report could not be made (');
    for (const part of ['secret-pass', 'postgresql://', 'db:5432']) expect(output).not.toContain(part);
  });
});
