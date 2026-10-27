// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
// DBM_E2E_PORT overrides the default port when 4179 is taken by an unrelated process.
const port = Number(process.env.DBM_E2E_PORT ?? 4179);
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
