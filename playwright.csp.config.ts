// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/csp',
  workers: 1,
  outputDir: 'node_modules/.cache/playwright-csp-results',
  use: { baseURL: 'http://127.0.0.1:4180', browserName: 'chromium', trace: 'off' },
  webServer: {
    command: 'npm run preview -- --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
  },
});
