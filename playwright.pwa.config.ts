// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  outputDir: 'node_modules/.cache/playwright-pwa-results',
  use: { baseURL: 'http://127.0.0.1:4181', browserName: 'chromium', trace: 'off' },
  webServer: {
    command: 'node tests/pwa/serve.mjs',
    url: 'http://127.0.0.1:4181/manifest.webmanifest',
    reuseExistingServer: false,
  },
});
