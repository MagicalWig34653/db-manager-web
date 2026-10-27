// SPDX-License-Identifier: AGPL-3.0-only
// DBM_EMBEDDED=1 for scripts/test-real-*.py: instead of the Vite preview of this checkout, the browser talks to the
// user interface that is embedded in the Go backend build under test. This tiny pass-through gives the Playwright
// run its own free port while every request (page, assets, API) is served by DB_MANAGER_BACKEND_URL unchanged.
// Usage: DB_MANAGER_BACKEND_URL=http://127.0.0.1:PORT node scripts/embedded-proxy.mjs <listen-port>
import http from 'node:http';

const target = new URL(process.env.DB_MANAGER_BACKEND_URL ?? '');
const listen = Number(process.argv[2]);
if (!Number.isInteger(listen) || listen < 1024) throw new Error('A listen port is required');

http
  .createServer((request, response) => {
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  })
  .listen(listen, '127.0.0.1');
