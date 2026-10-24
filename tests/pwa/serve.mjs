// SPDX-License-Identifier: AGPL-3.0-only
// Test server for the PWA checks: serves dist/ with the header policy of the Go handler and a tiny
// /api mock whose answers change on every call and echo the Authorization header. Test-only control
// endpoint: POST /__test/release makes sw.js differ (simulates a new build).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist');
const port = Number(process.env.PWA_TEST_PORT ?? 4181);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};
const csp =
  "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
let release = 0;
let apiCalls = 0;

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/__test/release' && request.method === 'POST') {
    release += 1;
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === '/__test/stats') {
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ apiCalls }));
    return;
  }
  if (url.pathname === '/api/echo' || url.pathname === '/healthz') {
    apiCalls += 1;
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    });
    response.end(
      JSON.stringify({ call: apiCalls, authorization: request.headers.authorization ?? null }),
    );
    return;
  }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = normalize(join(root, name));
  const type = types[extname(name)];
  if (!file.startsWith(root) || !type) {
    response.writeHead(404).end('Nicht gefunden.');
    return;
  }
  try {
    let body = await readFile(file);
    if (name === 'sw.js' && release > 0) {
      body = Buffer.concat([body, Buffer.from(`\n// release ${release}\n`)]);
    }
    const hashed = /^assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(name);
    response.writeHead(200, {
      'content-type': type,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-store',
      'content-security-policy': csp,
      'x-content-type-options': 'nosniff',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Nicht gefunden.');
  }
}).listen(port, '127.0.0.1');
