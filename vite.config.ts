// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export default defineConfig(({ mode, command }) => {
  const repository = 'https://github.com/MagicalWig34653/db-manager-web';
  let sourceURL = repository;
  let buildID = 'dev';
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
    buildID = commit;
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
      {
        // Emits the service worker (sw.js, stable name, no source map) next to the built shell.
        name: 'pwa-service-worker',
        apply: 'build',
        writeBundle(options) {
          const out = options.dir ?? 'dist';
          const hashed = readdirSync(join(out, 'assets'))
            .filter((name) => /\.(js|css)$/.test(name))
            .sort()
            .map((name) => `assets/${name}`);
          const shell = [
            'index.html',
            'manifest.webmanifest',
            'icon.svg',
            'icon-192.png',
            'icon-512.png',
            'icon-maskable-512.png',
            'apple-touch-icon.png',
            'favicon-32.png',
            ...hashed,
          ];
          const template = readFileSync(
            new URL('./src/lib/pwa/sw.template.js', import.meta.url),
            'utf8',
          );
          writeFileSync(
            join(out, 'sw.js'),
            template
              .replace('__BUILD_ID__', buildID)
              .replace('__PRECACHE__', JSON.stringify(shell)),
          );
        },
      },
    ],
    resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
    server: {
      proxy: env.DB_MANAGER_BACKEND_URL
        ? { '/api': { target: env.DB_MANAGER_BACKEND_URL, changeOrigin: false } }
        : undefined,
    },
    preview: {
      proxy: env.DB_MANAGER_BACKEND_URL
        ? { '/api': { target: env.DB_MANAGER_BACKEND_URL, changeOrigin: false } }
        : undefined,
      headers: {
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    },
    build: { target: 'es2022' },
  };
});
