import { defineConfig } from '@playwright/test';

// The launch audit: the real API on a throw-away database, never a mock. See
// docs/superpowers/specs/2026-11-05-launch-audit-design.md.
const webPort = 3930;
const apiPort = 3931;
const database = 'postgresql://smilesim:smilesim@127.0.0.1:5432/smilesim_audit';
const doors = ['admin', 'main', 'agent', 'pos'].map((door) => `http://${door}.localhost:${webPort}`);

export default defineConfig({
  testDir: './audit',
  testMatch: /.*\.audit\.ts$/,
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: './audit-output/results',
  reporter: [['list']],
  use: {
    baseURL: doors[3],
    channel: 'chrome',
    locale: 'ar',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
  webServer: [
    {
      command: 'node audit/reset-db.mjs && node ../api/dist/main.js',
      port: apiPort,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        AUDIT_DATABASE_URL: database,
        DATABASE_URL: database,
        REDIS_URL: 'redis://127.0.0.1:6379',
        COOKIE_SECURE: 'false',
        WEB_ORIGIN: doors.join(','),
        TRIAL_SEED: 'true',
        PORT: String(apiPort),
      },
    },
    {
      command: `npx next dev -p ${webPort}`,
      url: `${doors[3]}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
        NEXT_DIST_DIR: '.next-audit',
      },
    },
  ],
});
