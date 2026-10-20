// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(process.env.DBM_REAL_CONFIG!, 'utf8'));
export default defineConfig({
  testDir: './tests/real',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: config.outputDir,
  preserveOutput: 'never',
  use: {
    baseURL: config.baseURL,
    browserName: 'chromium',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
