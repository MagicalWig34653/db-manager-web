// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  outputDir: 'node_modules/.cache/playwright-results',
  use: { baseURL: 'http://127.0.0.1:4199', browserName: 'chromium', trace: 'off' },
  webServer: {
    command: 'npm run dev -- --port 4199 --strictPort',
    url: 'http://127.0.0.1:4199',
    reuseExistingServer: false,
  },
});
