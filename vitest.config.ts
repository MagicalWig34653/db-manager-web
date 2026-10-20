// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
    conditions: ['browser'],
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
