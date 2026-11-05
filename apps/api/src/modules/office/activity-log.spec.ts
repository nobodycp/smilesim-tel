import { activityActorFilter, clampActivityRange, purgeBefore } from './activity-log';

describe('activity log rules', () => {
  const now = new Date('2026-11-05T12:00:00Z');

  it('purges rows older than 90 days', () => {
    expect(purgeBefore(now).toISOString()).toBe('2026-08-07T12:00:00.000Z');
  });

  it('clamps a range into the retention window', () => {
    const range = clampActivityRange(new Date('2020-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z'), now);
    expect(range.gte.toISOString()).toBe('2026-08-07T12:00:00.000Z');
    expect(range.lte.toISOString()).toBe(now.toISOString());
  });

  it('lets the branch see unknown logins and limits everyone else to visible actors', () => {
    expect(activityActorFilter('branch', ['a'])).toEqual({});
    expect(activityActorFilter('agent', ['agent-1', 'pos-1'])).toEqual({ actorId: { in: ['agent-1', 'pos-1'] } });
  });
});
