import { isWebOrigin } from './origin.middleware';

// Review 2026-11-10, S8: a write is accepted from the web app's own doors, never from a neighbour host.
describe('isWebOrigin', () => {
  const allowed = ['https://admin.smilesim.example'];

  it('accepts a configured origin and the other doors of the same site', () => {
    expect(isWebOrigin('https://admin.smilesim.example', allowed)).toBe(true);
    expect(isWebOrigin('https://pos.smilesim.example', allowed)).toBe(true);
    expect(isWebOrigin('https://agent.smilesim.example', allowed)).toBe(true);
  });

  it('refuses a sibling subdomain, another site, another scheme and a malformed origin', () => {
    expect(isWebOrigin('https://evil.smilesim.example', allowed)).toBe(false);
    expect(isWebOrigin('https://admin.other.example', allowed)).toBe(false);
    expect(isWebOrigin('http://pos.smilesim.example', allowed)).toBe(false);
    expect(isWebOrigin('https://smilesim.example', allowed)).toBe(false);
    expect(isWebOrigin('not a url', allowed)).toBe(false);
  });

  it('accepts the doors in front of a configured site name, as the local copy runs', () => {
    expect(isWebOrigin('http://localhost:3000', ['http://localhost:3000'])).toBe(true);
    expect(isWebOrigin('http://admin.localhost:3000', ['http://localhost:3000'])).toBe(true);
    expect(isWebOrigin('http://pos.localhost:3000', ['http://localhost:3000'])).toBe(true);
    expect(isWebOrigin('http://evil.localhost:3000', ['http://localhost:3000'])).toBe(false);
    expect(isWebOrigin('http://admin.localhost:4000', ['http://localhost:3000'])).toBe(false);
  });
});
