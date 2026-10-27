// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
// Same variable as tests/pwa/serve.mjs (default stays 4181). DBM_E2E_PORT is the shared fallback.
const port = Number(process.env.PWA_TEST_PORT ?? process.env.DBM_E2E_PORT ?? 4181);
export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  outputDir: 'node_modules/.cache/playwright-pwa-results',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', trace: 'off' },
  webServer: {
    command: 'node tests/pwa/serve.mjs',
    env: { ...(process.env as Record<string, string>), PWA_TEST_PORT: String(port) },
    url: `http://127.0.0.1:${port}/manifest.webmanifest`,
    reuseExistingServer: false,
  },
});
