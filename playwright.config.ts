// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
// DBM_PW_PORT lets parallel checkouts and shared machines pick a free port (default 4179).
const port = Number(process.env.DBM_PW_PORT ?? 4179);
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
