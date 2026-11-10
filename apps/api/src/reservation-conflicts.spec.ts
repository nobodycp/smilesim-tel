import { conflictLines, maskedTail, type ReservationConflict } from './modules/office/lines/reservation.rules';
import { capturedOutput } from './modules/shared/testing/captured-output';
import { openConflicts, report } from './reservation-conflicts';

const SERIAL = '8997201234567890123';
const NUMBER = '0507654321';
const conflicts: ReservationConflict[] = [
  { kind: 'number', value: NUMBER, taskIds: ['3f2a9c1e-task-b', '77d0e4aa-task-c'] },
  { kind: 'serial', value: SERIAL, taskIds: ['1b6c0d2f-task-a', '3f2a9c1e-task-b', '9e8d7c6b-task-d'] },
];

/** No part of a serial or a number longer than the four characters a log may show. */
const expectNoNumbers = (text: string) => {
  for (const whole of [SERIAL, NUMBER]) {
    expect(text).not.toContain(whole);
    for (let start = 0; start + 5 <= whole.length; start += 1) expect(text).not.toContain(whole.slice(start, start + 5));
  }
};

describe('reservation conflict report', () => {
  it('shows a serial or a number by its last four characters only', () => {
    expect(maskedTail(SERIAL)).toBe('ending 0123');
    expect(maskedTail(NUMBER)).toBe('ending 4321');
    expect(maskedTail('12')).toBe('ending 12');
    const lines = conflictLines(conflicts);
    expect(lines).toEqual([
      'number ending 4321 is named by 2 open activation tasks: 3f2a9c1e-task-b, 77d0e4aa-task-c',
      'serial ending 0123 is named by 3 open activation tasks: 1b6c0d2f-task-a, 3f2a9c1e-task-b, 9e8d7c6b-task-d',
    ]);
    expectNoNumbers(lines.join('\n'));
  });

  it('logs every task id of every group and no whole serial or number, and exits 1', async () => {
    let code = -1;
    const output = await capturedOutput(async () => {
      code = await report(async () => conflicts);
    });
    expect(code).toBe(1);
    // What the branch needs: each task, by id.
    for (const id of conflicts.flatMap((conflict) => conflict.taskIds)) expect(output).toContain(id);
    expect(output).toContain('number ending 4321');
    expect(output).toContain('serial ending 0123');
    expect(output).toContain('2 group(s)');
    expectNoNumbers(output);
  });

  it('says there is nothing to resolve and exits 0', async () => {
    let code = -1;
    const output = await capturedOutput(async () => {
      code = await report(async () => []);
    });
    expect(code).toBe(0);
    expect(output).toContain('the reservation indexes can be created');
  });

  it('logs a code, never the driver\'s words, when the database cannot be read, and exits 2', async () => {
    const secret = 'postgresql://smilesim:db-pass-456@db.internal:5432/smilesim';
    let codes: number[] = [];
    const output = await capturedOutput(async () => {
      codes = [
        await report(async () => { throw Object.assign(new Error(`Can't reach database server at ${secret}; last row had msisdn ${NUMBER}`), { code: 'P1001' }); }),
        await report(async () => { throw new Error(`password authentication failed for ${secret} (iccid ${SERIAL})`); }),
      ];
    });
    expect(codes).toEqual([2, 2]);
    expect(output).toContain('the report could not be made (P1001)');
    expect(output).toContain('the report could not be made (unclassified)');
    for (const part of [secret, 'db-pass-456', 'db.internal', 'password authentication']) expect(output).not.toContain(part);
    expectNoNumbers(output);
  });

  // The real query, where a database is given: with the indexes in place no group can exist.
  (process.env.TEST_DATABASE_URL ? it : it.skip)('reads the database and finds no group once the indexes exist (PostgreSQL)', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    try {
      expect(await openConflicts()).toEqual([]);
      let code = -1;
      await capturedOutput(async () => {
        code = await report();
      });
      expect(code).toBe(0);
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });

  it('exits 2 with a code when the database address is wrong (the real client, a closed port)', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://smilesim:wrong-pass-789@127.0.0.1:1/smilesim';
    let code = -1;
    try {
      const output = await capturedOutput(async () => {
        code = await report();
      });
      expect(code).toBe(2);
      expect(output).toContain('the report could not be made (');
      for (const part of ['wrong-pass-789', '127.0.0.1:1', 'postgresql://']) expect(output).not.toContain(part);
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });
});
