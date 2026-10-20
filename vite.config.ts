// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export default defineConfig(({ mode, command }) => {
  const repository = 'https://github.com/MagicalWig34653/db-manager-web';
  let sourceURL = repository;
  if (command === 'build') {
    const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const modified = execFileSync(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        'src',
        'public',
        'LICENSE',
        'package.json',
        'package-lock.json',
        'vite.config.*',
        'index.html',
        'svelte.config.*',
        'tsconfig*.json',
      ],
      { encoding: 'utf8' },
    ).trim();
    if (!/^[a-f0-9]{40}$/.test(commit) || modified) {
      throw new Error(
        'Production source provenance requires committed product and build files. Commit changes before building.',
      );
    }
    sourceURL = `${repository}/tree/${commit}`;
  }
  const env = loadEnv(mode, process.cwd(), 'DB_MANAGER_');
  return {
    define: { __WEB_SOURCE_URL__: JSON.stringify(sourceURL) },
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
