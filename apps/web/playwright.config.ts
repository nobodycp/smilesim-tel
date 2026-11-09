import { defineConfig } from '@playwright/test';

const webPort = 3910;
const apiPort = 3911;
const webOrigin = `http://pos.localhost:${webPort}`;

export default defineConfig({
  testDir: './tests',
  // A failed test keeps its trace (actions, DOM snapshots, console) in the CI report, so it can be read without
  // running Playwright on the owner's machine (.cursor/rules/machine-limits.mdc).
  use: { baseURL: webOrigin, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node tests/mock-api.mjs',
      // the mock answers every request with 401, so wait on the port rather than a status
      port: apiPort,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_API_PORT: String(apiPort), MOCK_WEB_ORIGIN: webOrigin },
    },
    {
      command: `npx next dev -p ${webPort}`,
      url: `${webOrigin}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}`,
        NEXT_DIST_DIR: '.next-e2e',
      },
    },
  ],
});
