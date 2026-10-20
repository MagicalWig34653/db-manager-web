// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'DB_MANAGER_');
  return {
    plugins: [
      tailwindcss(),
      svelte(),
      {
        name: 'distribution-notices',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'THIRD-PARTY-NOTICES.txt',
            source: readFileSync(new URL('./src/third-party-notices.txt', import.meta.url), 'utf8'),
          });
          this.emitFile({
            type: 'asset',
            fileName: 'LICENSE.txt',
            source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8'),
          });
        },
      },
    ],
    resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
    server: {
      proxy: env.DB_MANAGER_BACKEND_URL
        ? { '/api': { target: env.DB_MANAGER_BACKEND_URL, changeOrigin: false } }
        : undefined,
    },
    build: { target: 'es2022' },
  };
});
