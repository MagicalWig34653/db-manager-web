// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
// DBM_E2E_PORT moves the dev server away from a port that an unrelated process may occupy.
// DBM_TEST_PORT and DBM_PW_PORT are accepted as legacy aliases (default stays 4179).
const port = Number(process.env.DBM_E2E_PORT ?? process.env.DBM_TEST_PORT ?? process.env.DBM_PW_PORT ?? 4179);
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  outputDir: 'node_modules/.cache/playwright-results',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', trace: 'off' },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
