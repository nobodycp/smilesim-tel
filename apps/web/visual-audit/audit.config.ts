import { defineConfig } from '@playwright/test';

// The visual audit (docs/reviews/2026-11-11-visual-audit.md). It drives the ONE running copy on port 3000 and starts
// no server of its own. Run from apps/web:  npx playwright test -c visual-audit/audit.config.ts
// Env: WIDTHS (390,768,1280), COMBOS (ar-dark,en-light), ONLY (substring of a route), DOOR/USER_LOGIN.
export default defineConfig({
  testDir: __dirname,
  testMatch: /audit\.visual\.ts/,
  outputDir: '../audit-output/visual-audit/results',
  workers: 1,
  timeout: 3_600_000,
});
