// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
const port = Number(process.env.DBM_PW_PORT ?? 4180);
export default defineConfig({
  testDir: './tests/csp',
  workers: 1,
  outputDir: 'node_modules/.cache/playwright-csp-results',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', trace: 'off' },
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
