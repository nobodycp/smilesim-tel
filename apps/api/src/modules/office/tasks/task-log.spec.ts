import { parseTaskLogLine, stampTaskLog } from './task-log';

describe('task log stamps', () => {
  it('prefixes each line with an ISO time', () => {
    const at = new Date('2026-11-03T20:49:15.400Z');
    expect(stampTaskLog('', 'أخذها حمزه', at)).toBe('2026-11-03T20:49:15.400Z أخذها حمزه');
    expect(stampTaskLog('2026-11-03T20:49:15.400Z أخذها حمزه', 'أرجعها حمزه', new Date('2026-11-03T20:50:01.000Z'))).toBe(
      '2026-11-03T20:49:15.400Z أخذها حمزه\n2026-11-03T20:50:01.000Z أرجعها حمزه',
    );
  });

  it('parses stamped lines and keeps legacy lines on the fallback time', () => {
    expect(parseTaskLogLine('2026-11-03T20:49:15.400Z أخذها حمزه', '2026-01-01T00:00:00.000Z')).toEqual({
      at: '2026-11-03T20:49:15.400Z',
      body: 'أخذها حمزه',
    });
    expect(parseTaskLogLine('أخذها حمزه', '2026-01-01T00:00:00.000Z')).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      body: 'أخذها حمزه',
    });
  });
});
