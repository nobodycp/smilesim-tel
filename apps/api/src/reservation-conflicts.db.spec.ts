import { capturedOutput } from './modules/shared/testing/captured-output';
import { openConflicts, report } from './reservation-conflicts';

// PostgreSQL only (TEST_DATABASE_URL): the report's real query. Its name ends in `.db.spec.ts` so the CI job
// that has a database runs it; what the report prints, and what it never prints, is in reservation-conflicts.spec.ts.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('reservation conflict report (PostgreSQL)', () => {
  const previous = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  afterAll(() => {
    process.env.DATABASE_URL = previous;
  });

  it('reads the database and finds no group once the indexes exist', async () => {
    // With the reservation indexes in place two open activation tasks cannot share a serial or a number.
    expect(await openConflicts()).toEqual([]);
    let code = -1;
    const output = await capturedOutput(async () => {
      code = await report();
    });
    expect(code).toBe(0);
    expect(output).toContain('the reservation indexes can be created');
  });
});
