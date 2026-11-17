import { STACK, behindOf, compareVersions, cycleOf, isNewer, newestOf, parseVersion, plainVersion, supportOf, type Cycle } from './versions.rules';

// The versions page's rules alone (system monitor M.11): how a version is read and compared, how far one is behind,
// which cycle it is of, and when its support ends.

describe('reading a version', () => {
  it('takes up to three numbers after a v, a pre-release tag right after them, and ignores a build or what follows a space', () => {
    expect(parseVersion('v24.21.0')).toEqual({ parts: [24, 21, 0], pre: false });
    expect(parseVersion('17.6')).toEqual({ parts: [17, 6], pre: false });
    expect(parseVersion('17.6 (Debian 17.6-1.pgdg120+1)')).toEqual({ parts: [17, 6], pre: false });
    expect(parseVersion('7.4.1')).toEqual({ parts: [7, 4, 1], pre: false });
    expect(parseVersion('19.0.0-rc.1')).toEqual({ parts: [19, 0, 0], pre: true });
    expect(parseVersion('19beta1')).toEqual({ parts: [19], pre: true });
    expect(parseVersion('1.2.3+build.5')).toEqual({ parts: [1, 2, 3], pre: false });
    expect([parseVersion('latest'), parseVersion(''), parseVersion(null)]).toEqual([null, null, null]);
    expect([plainVersion('17.6 (Debian 17.6-1.pgdg120+1)'), plainVersion('v24.21.0'), plainVersion('19.0.0-rc.1'), plainVersion('x')]).toEqual(['17.6', 'v24.21.0', '19.0.0-rc.1', null]);
  });
});

describe('comparing two versions', () => {
  it('by their numbers, a v prefix ignored, a pre-release older than its release', () => {
    expect(compareVersions('v24.21.0', '24.21.0')).toBe(0);
    expect(compareVersions('24.21.0', '26.13.1')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('19.0.0-rc.1', '19.0.0')).toBeLessThan(0);
    expect(compareVersions('19.0.0', '18.3.1')).toBeGreaterThan(0);
    expect(compareVersions('7.4', '7.4.0')).toBe(0);
    expect(compareVersions('x', '1.0.0')).toBeNull();
    expect([isNewer('5.1.0', '5.0.9'), isNewer('5.0.9', '5.1.0'), isNewer('5.0.0', '5.0.0'), isNewer('5.0.0', null)]).toEqual([true, false, false, false]);
  });
});

describe('how far a version is behind the newest', () => {
  it('semver: the first number that differs; none when the same or newer; unknown when either is missing', () => {
    expect(behindOf('12.3.2', '12.3.2')).toBe('none');
    expect(behindOf('12.3.2', '12.3.9')).toBe('patch');
    expect(behindOf('12.3.2', '12.5.1')).toBe('minor');
    expect(behindOf('12.3.2', '13.0.0')).toBe('major');
    expect(behindOf('13.0.0', '12.9.9')).toBe('none');
    expect(behindOf('v24.21.0', '26.13.1')).toBe('major');
    expect(behindOf('19.0.0-rc.1', '19.0.0')).toBe('patch');
    expect([behindOf(null, '1.0.0'), behindOf('1.0.0', null), behindOf('junk', '1.0.0')]).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('PostgreSQL\'s two-number versions are major and patch; Redis\'s three numbers are major, minor, patch', () => {
    expect(behindOf('17.2', '17.6')).toBe('patch');
    expect(behindOf('17.6', '18.1')).toBe('major');
    expect(behindOf('17.6 (Debian 17.6-1.pgdg120+1)', '17.6')).toBe('none');
    expect(behindOf('7.4.1', '7.4.6')).toBe('patch');
    expect(behindOf('7.4.1', '8.10.3')).toBe('major');
    expect(behindOf('8.8.4', '8.10.3')).toBe('minor');
  });
});

describe('a runtime\'s cycles', () => {
  const node: Cycle[] = [
    { cycle: '26', latest: '26.13.1', eol: '2029-04-30' },
    { cycle: '25', latest: '25.9.0', eol: '2026-06-01' },
    { cycle: '24', latest: '24.22.3', eol: '2028-04-30' },
    { cycle: '27', latest: '27.0.0-rc.2', eol: false },
  ];
  const redis: Cycle[] = [
    { cycle: '8.10', latest: '8.10.3', eol: false },
    { cycle: '7.4', latest: '7.4.6', eol: '2026-11-01' },
    { cycle: '7.2', latest: '7.2.9', eol: true },
  ];

  it('a version is of the longest cycle that is it or starts it before a dot', () => {
    expect(cycleOf('v24.21.0', node)?.cycle).toBe('24');
    expect(cycleOf('7.4.1', redis)?.cycle).toBe('7.4');
    expect(cycleOf('17.6 (Debian)', [{ cycle: '17', latest: '17.6', eol: '2029-11-08' }, { cycle: '1', latest: '1.0', eol: true }])?.cycle).toBe('17');
    expect(cycleOf('v2.1.0', node)).toBeNull();
    expect(cycleOf(null, node)).toBeNull();
  });

  it('the newest of all cycles leaves pre-releases out', () => {
    expect(newestOf(node)).toBe('26.13.1');
    expect(newestOf(redis)).toBe('8.10.3');
    expect(newestOf([{ cycle: '19', latest: '19beta1', eol: false }])).toBeNull();
  });

  it('support ends on the cycle\'s date, or as its undated mark says', () => {
    expect(supportOf(cycleOf('25.1.0', node), '2026-11-17')).toEqual({ supportEnds: '2026-06-01', supportEnded: true });
    expect(supportOf(cycleOf('24.1.0', node), '2026-11-17')).toEqual({ supportEnds: '2028-04-30', supportEnded: false });
    expect(supportOf(cycleOf('7.4.1', redis), '2026-11-01')).toEqual({ supportEnds: '2026-11-01', supportEnded: true });
    expect(supportOf(cycleOf('7.2.1', redis), '2026-11-17')).toEqual({ supportEnds: null, supportEnded: true });
    expect(supportOf(cycleOf('8.10.0', redis), '2026-11-17')).toEqual({ supportEnds: null, supportEnded: false });
    expect(supportOf(null, '2026-11-17')).toEqual({ supportEnds: null, supportEnded: false });
  });
});

it('the list holds the runtimes and libraries the spec names, the web\'s included, each once', () => {
  expect(STACK.map((component) => component.name)).toEqual(['nodejs', 'postgresql', 'redis', 'next', 'react', 'tailwindcss', '@nestjs/core', 'prisma', '@prisma/client', 'bullmq', 'typescript', 'zod', 'express', 'argon2']);
  expect(STACK.find((component) => component.name === 'nodejs')?.where).toEqual(['api', 'worker', 'web']);
});
